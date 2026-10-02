
import { extractProjectKnowledge } from "../../analyzer/knowledgeExtractor.js";

export const command = "extract <projectId>";

export const describe =
  "Extract searchable knowledge from an analyzed project";

export const builder = (yargs) => {
  return yargs.positional("projectId", {
    describe: "ID of the project saved by the analyze command",
    type: "string"
  });
};

export const handler = (argv) => {
  try {
    const result = extractProjectKnowledge(argv.projectId);

    console.log("\nDevVault Knowledge Extraction");
    console.log("-----------------------------");
    console.log(`Project: ${result.project.name || "Unnamed project"}`);
    console.log(`Project ID: ${result.project.id}`);
    console.log(`Source files scanned: ${result.scannedSourceFiles}`);
    console.log(`Findings discovered: ${result.candidatesFound}`);
    console.log(`New knowledge entries: ${result.added}`);
    console.log(`Duplicates skipped: ${result.duplicates}`);

    if (result.added === 0 && result.duplicates === 0) {
      console.log(
        "\nNo findings were extracted. Check that the project contains a README, package.json, or supported Express route declarations."
      );
    }

    console.log(
      "\nExtracted knowledge is stored in .devvault/knowledge.json."
    );
  } catch (error) {
    console.error(`\nExtraction failed: ${error.message}`);
    process.exitCode = 1;
  }
};
