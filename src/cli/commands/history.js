import { readData } from "../../storage/localStorage.js";

export const command = "history";
export const describe = "Show recent activity (analyze, search, ask, sync, ...)";

export const builder = (yargs) =>
  yargs
    .option("limit", { alias: "n", type: "number", default: 20, describe: "Number of events" })
    .option("action", { alias: "a", type: "string", describe: "Only show this action" });

export const handler = (argv) => {
  try {
    const limit = Math.min(Math.max(Math.trunc(argv.limit) || 20, 1), 500);
    let events = readData("history");

    if (argv.action) events = events.filter((event) => event.action === argv.action);

    const shown = events.slice(-limit).reverse();

    if (!shown.length) {
      console.log("No activity recorded yet.");
      return;
    }

    console.log("\nRecent activity");
    console.log("---------------");

    for (const event of shown) {
      const detail =
        event.query ?? event.projectPath ?? event.entryId ?? (event.uploaded !== undefined ? `uploaded ${event.uploaded}` : "");
      console.log(`${event.createdAt}  ${String(event.action).padEnd(14)} ${detail}`);
    }
  } catch (error) {
    console.error(`History failed: ${error.message}`);
    process.exitCode = 1;
  }
};
