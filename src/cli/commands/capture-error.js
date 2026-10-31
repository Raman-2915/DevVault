import fs from "node:fs";
import { apiRequest } from "../../api/client.js";
import { resolveProject } from "../../storage/projectContext.js";
import { saveIncident, manualStructure, readLastError, clean } from "../incident.js";
import { autoSync } from "../syncCore.js";
import { ask, confirm, readAllStdin } from "../prompt.js";

export const command = "capture-error";
export const describe = "Save an error and its fix as reusable knowledge (AI-structured when available)";

export const builder = (yargs) =>
  yargs
    .option("message", { alias: "m", type: "string", describe: "The error text" })
    .option("file", { alias: "f", type: "string", describe: "Read the error/stack trace from a file" })
    .option("stdin", { type: "boolean", default: false, describe: "Read the error from standard input" })
    .option("last", { alias: "l", type: "boolean", default: false, describe: "Use the error from your last failed `devvault run`" })
    .option("solution", { alias: "s", type: "string", describe: "What fixed it (saved as-is; no AI needed)" })
    .option("cause", { type: "string", describe: "Why it happened" })
    .option("project", { alias: "p", type: "string", describe: "Project (default: detected from the current folder)" })
    .option("notes", { type: "string", describe: "Extra context for the AI" })
    .option("ai", { type: "boolean", default: true, describe: "Use AI to structure (use --no-ai to skip)" })
    .option("yes", { alias: "y", type: "boolean", default: false, describe: "Save without asking for confirmation" });

export const handler = async (argv) => {
  try {
    let error = argv.message;
    let projectName = argv.project;
    const last = argv.last ? readLastError() : null;

    if (argv.last && !last) throw new Error("No failed `devvault run` is remembered. Pass the error with -m, --file or --stdin.");
    if (!error && last) { error = last.error; projectName = projectName || last.project; }
    if (!error && argv.file) error = fs.readFileSync(argv.file, "utf8");
    if (!error && argv.stdin) error = await readAllStdin();
    if (!error) error = await ask("Paste the error (single line) or re-run with --last / --file / --stdin:\n> ");

    error = clean(error);
    if (!error) throw new Error("No error text provided.");

    const project = projectName ? resolveProject(projectName, { create: true }) : resolveProject(undefined, { create: true });
    const manual = argv.solution !== undefined || argv.ai === false;
    let structured = null;

    if (!manual) {
      console.log("\nAsking the AI to structure this error (secrets are redacted before sending)...");
      try {
        ({ structured } = await apiRequest("POST", "/api/debug/structure", {
          error: error.slice(0, 6000),
          notes: argv.notes ?? "",
          project: project?.name
        }));
      } catch (aiError) {
        console.log(`AI unavailable (${aiError.message}). Saving it manually instead.`);
      }
    }

    if (!structured) {
      let solution = argv.solution;
      if (solution === undefined && process.stdin.isTTY) solution = await ask("What fixed it? (one line, Enter to skip): ");
      structured = manualStructure({ error, cause: argv.cause, solution: clean(solution) });
    } else if (argv.solution) {
      structured.solution = clean(argv.solution);
    }

    console.log(`\nTitle:    ${structured.title}`);
    console.log(`Problem:  ${structured.problem}`);
    console.log(`Cause:    ${structured.cause}`);
    console.log(`Solution: ${structured.solution}`);
    if (structured.tags.length) console.log(`Tags:     ${structured.tags.join(", ")}`);
    console.log(`Project:  ${project?.name || "(none)"}`);

    if (!argv.yes && !manual && !(await confirm("\nSave this to your knowledge base?"))) {
      console.log("Not saved.");
      return;
    }

    const entry = saveIncident({ error, structured, project });
    console.log(`\nSaved as ${entry.id.slice(0, 8)}. Next time, \`devvault fix\` or \`devvault run\` will find it.`);
    await autoSync();
  } catch (error) {
    console.error(`\nCapture failed: ${error.message}`);
    process.exitCode = 1;
  }
};
