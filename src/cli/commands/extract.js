
import { extractProjectKnowledge } from "../../analyzer/knowledgeExtractor.js";
import { autoSync } from "../syncCore.js";

export const command = "extract <projectId>";

export const describe =
  "Extract searchable knowledge from an analyzed project";

export const builder = (yargs) => {
  return yargs.positional("projectId", {
    describe: "ID of the project saved by the analyze command",
    type: "string"
  });
};

export const handler = async (argv) => {
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
    if (result.updated) console.log(`Refreshed (changed since last time): ${result.updated}`);

    const fp = result.fingerprint;
    if (fp) {
      console.log("\nWhat DevVault found in this project:");
      console.log(`  Languages:  ${fp.languages.map((l) => l.name).join(", ") || "none"}`);
      console.log(`  Frameworks: ${fp.frameworks.join(", ") || "none"}`);
      console.log(`  Databases:  ${fp.databases.map((d) => `${d.name}${d.via[0] ? ` (via ${d.via[0]})` : ""}`).join(", ") || "none detected"}`);
      console.log(`  Models:     ${fp.models.length ? fp.models.slice(0, 8).map((m) => m.name).join(", ") + (fp.models.length > 8 ? ", …" : "") : "none detected"}`);
      console.log(`  Auth:       ${fp.auth.join(", ") || "none detected"}`);
    }

    if (result.added === 0 && result.duplicates === 0) {
      console.log(
        "\nNo findings were extracted. Check that the project contains a README, package.json, or supported Express route declarations."
      );
    }

    const synced = await autoSync();
    console.log(
      synced
        ? `\nSaved to your vault and synced to your account (${synced.uploaded} uploaded).`
        : "\nSaved to your vault. Run `devvault sync` to back it up and make it available to `devvault ask` and the dashboard."
    );
  } catch (error) {
    console.error(`\nExtraction failed: ${error.message}`);
    process.exitCode = 1;
  }
};
