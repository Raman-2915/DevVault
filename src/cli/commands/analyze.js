
import { analyzeProject } from "../../analyzer/projectAnalyzer.js";

export const command = "analyze <path>";

export const describe =
  "Analyze a project and save its profile to the DevVault workspace";



export const handler = (argv) => {
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

    console.log("\nProfile saved to .devvault/projects.json");
  } catch (error) {
    console.error(`\nAnalysis failed: ${error.message}`);
    process.exitCode = 1;
  }
};
