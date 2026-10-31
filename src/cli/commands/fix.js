import fs from "node:fs";
import { findSimilar, printSimilar } from "../similar.js";
import { readAllStdin } from "../prompt.js";
import { addHistory } from "../../storage/localStorage.js";

export const command = "fix [error..]";
export const describe = "Stuck on an error? Search your past projects for how you solved it before";

export const builder = (yargs) =>
  yargs
    .positional("error", { type: "string", array: true, describe: "The error text (quoted)" })
    .option("file", { alias: "f", type: "string", describe: "Read the error from a file" })
    .option("stdin", { type: "boolean", default: false, describe: "Read from standard input (npm start 2>&1 | devvault fix --stdin)" })
    .option("local", { type: "boolean", default: false, describe: "Only search this computer (skip cloud semantic search)" })
    .option("limit", { alias: "n", type: "number", default: 5 });

export const handler = async (argv) => {
  try {
    let text = (argv.error || []).join(" ").trim();
    if (!text && argv.file) text = fs.readFileSync(argv.file, "utf8");
    if (!text && argv.stdin) text = await readAllStdin();
    if (!text.trim()) throw new Error('Give me the error. Example: devvault fix "MongooseServerSelectionError: connection timed out"');

    const found = await findSimilar(text, { limit: Math.min(Math.max(argv.limit || 5, 1), 15), cloud: !argv.local });
    printSimilar(found, { heading: "How you handled this before" });

    try { addHistory({ action: "fix", query: found.query.slice(0, 120) }); } catch { /* history is best effort */ }

    if (!found.results.length) {
      console.log("\nAfter you solve it, save the lesson:  devvault capture-error --solution \"what fixed it\"");
    }
  } catch (error) {
    console.error(`Fix failed: ${error.message}`);
    process.exitCode = 1;
  }
};
