import { maintainProjectKnowledge } from "../../analyzer/knowledgeMaintenance.js";

export const command = "maintain <projectId>";

export const describe =
  "Preview or remove stale extracted knowledge for a project";

export const builder = (yargs) =>
  yargs.option("apply", {
    type: "boolean",
    default: false,
    describe: "Remove confirmed-stale extracted entries"
  });

export const handler = (argv) => {
  try {
    const result = maintainProjectKnowledge(argv.projectId, {
      apply: argv.apply
    });

    console.log(`\nKnowledge maintenance: ${result.project.name}`);
    console.log(`Project ID: ${result.project.id}`);
    console.log(`Source files scanned: ${result.scannedSourceFiles}`);
    console.log(`Extracted entries: ${result.extractedEntries}`);
    console.log(`Current entries: ${result.current.length}`);
    console.log(`Stale entries: ${result.stale.length}`);
    console.log(`Uncertain entries preserved: ${result.uncertain.length}`);
    console.log(
      `Manual entries preserved: ${result.manualEntriesPreserved}`
    );

    if (result.scanLimited) {
      console.log(
        "\nWarning: the source scan reached its file limit. " +
        "Potentially affected entries were preserved as uncertain."
      );
    }

    if (result.stale.length > 0) {
      console.log("\nStale entries:");

      for (const entry of result.stale) {
        console.log(`- [${entry.id}] ${entry.title}`);
        console.log(`  Source: ${entry.sourceFile}`);
      }
    } else {
      console.log("\nNo confirmed-stale entries found.");
    }

    if (result.applied) {
      console.log(`\nRemoved: ${result.removed}`);

      if (result.removed === 0) {
        console.log("No entries were removed.");
      }
    } else {
      console.log("\nPreview only. No entries were deleted.");

      if (result.stale.length > 0) {
        console.log(
          `To apply this cleanup, run: node src/index.js maintain ${argv.projectId} --apply`
        );
      }
    }
  } catch (error) {
    console.error(`Knowledge maintenance failed: ${error.message}`);
    process.exitCode = 1;
  }
};