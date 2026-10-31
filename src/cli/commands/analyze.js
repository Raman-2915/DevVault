
import { analyzeProject } from "../../analyzer/projectAnalyzer.js";
import { extractProjectKnowledge } from "../../analyzer/knowledgeExtractor.js";
import { autoSync } from "../syncCore.js";

export const command = "analyze <path>";

export const describe =
  "Analyze a project (stack, databases, models, architecture) and teach DevVault about it";

export const builder = (yargs) =>
  yargs
    .positional("path", { type: "string", describe: "Project folder, e.g. . or ../my-app" })
    .option("extract", {
      type: "boolean",
      default: true,
      describe: "Also extract knowledge right away (use --no-extract for the profile only)"
    });

export const handler = async (argv) => {
  try {
    console.log("\nAnalyzing project...\n");

    const project = analyzeProject(argv.path);

    console.log("Project analyzed successfully.\n");
    console.log(`Name:         ${project.name}`);
    console.log(`ID:           ${project.id}`);
    console.log(`Path:         ${project.path}`);
    console.log(`Languages:    ${project.languages.join(", ") || "None detected"}`);
    console.log(`Technologies: ${project.technologies.join(", ") || "None detected"}`);
    console.log(`Frameworks:   ${project.frameworks.join(", ") || "None detected"}`);
    console.log(`Package mgr:  ${project.packageManager}`);
    console.log(`Files:        ${project.fileCount}`);
    console.log(`Directories:  ${project.directoryCount}`);
    console.log(`Dependencies: ${project.dependencies.length}`);

    console.log("\nArchitecture indicators:");
    if (project.architecture.length) {
      project.architecture.forEach((item) => {
        console.log(`  - ${item}`);
      });
    } else {
      console.log("  No common patterns detected.");
    }

    console.log("\nDatabases:");
    console.log(`  ${project.databases.join(", ") || "None detected"}`);

    console.log("\nAuthentication libraries:");
    console.log(
      `  ${project.authenticationLibraries.join(", ") || "None detected"}`
    );

    console.log("\nSummary:");
    console.log(`  ${project.summary}`);

    if (project.warnings.length) {
      console.log("\nWarnings:");
      project.warnings.forEach((warning) => {
        console.log(`  - ${warning}`);
      });
    }

    console.log("\nProfile saved to your vault.");

    if (argv.extract) {
      console.log("\nExtracting knowledge (technologies, databases, data models, routes)...");
      const result = extractProjectKnowledge(project.id);
      const fp = result.fingerprint;

      console.log(`New entries: ${result.added}${result.updated ? `  Refreshed: ${result.updated}` : ""}  Unchanged: ${result.duplicates}`);

      if (fp) {
        console.log("\nWhat DevVault found:");
        console.log(`  Databases:  ${fp.databases.map((d) => `${d.name}${d.via[0] ? ` (via ${d.via[0]})` : ""}`).join(", ") || "none detected"}`);
        console.log(`  Models:     ${fp.models.length ? fp.models.slice(0, 8).map((m) => m.name).join(", ") + (fp.models.length > 8 ? ", …" : "") : "none detected"}`);
        console.log(`  Auth:       ${fp.auth.join(", ") || "none detected"}`);
        console.log(`  API:        ${fp.api.styles.join(", ") || "none detected"}${fp.api.routeCount ? ` (${fp.api.routeCount} endpoints)` : ""}`);
      }

      const synced = await autoSync();
      console.log(
        synced
          ? `\n✔ Synced to your account (${synced.uploaded} uploaded). It is now in your dashboard and available to \`devvault ask\`.`
          : "\nNext: run `devvault sync` to back it up and make it available to `devvault ask` and the dashboard."
      );
    } else {
      console.log(`\nNext: devvault extract ${project.id}`);
    }
  } catch (error) {
    console.error(`\nAnalysis failed: ${error.message}`);
    process.exitCode = 1;
  }
};
