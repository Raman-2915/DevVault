import { apiRequest } from "../../api/client.js";
import { addHistory } from "../../storage/localStorage.js";

export const command = "ask <question>";
export const describe = "Ask a question answered from your own stored knowledge (RAG)";

export const builder = (yargs) =>
  yargs
    .positional("question", { type: "string", describe: "Your question, in natural language" })
    .option("project", { alias: "p", type: "string", describe: "Only use knowledge from this project name" })
    .option("type", { alias: "t", type: "string", describe: "Only use this knowledge type" })
    .option("limit", { alias: "n", type: "number", default: 6, describe: "Max sources to retrieve (1-20)" });

export function printSources(sources) {
  console.log("\nSources used:");

  sources.forEach((source, index) => {
    const file = source.sourceFile
      ? ` — ${source.sourceFile}${source.sourceLine ? `:${source.sourceLine}` : ""}`
      : "";
    console.log(`  [${source.ref ?? index + 1}] ${source.title} (${source.project || "no project"}, ${source.type})${file}  score ${source.score}`);
  });
}

export const handler = async (argv) => {
  try {
    const result = await apiRequest("POST", "/api/ask", {
      question: argv.question,
      project: argv.project,
      type: argv.type,
      limit: argv.limit
    });

    console.log(`\n${result.answer}`);

    if (result.sources.length) {
      printSources(result.sources);
    }

    try {
      addHistory({ action: "ask", query: argv.question, sources: result.sources.length });
    } catch {
      // history is best-effort when the workspace is not initialized
    }
  } catch (error) {
    console.error(`\nAsk failed: ${error.message}`);
    process.exitCode = 1;
  }
};
