
import { getProjectById } from "../../storage/localStorage.js";

export const command = "project <projectId>";

export const describe = "Display a saved project profile";

export const builder = (yargs) =>
  yargs.positional("projectId", {
    describe: "ID of the analyzed project",
    type: "string"
  });

export const handler = ({ projectId }) => {
  try {
    const project = getProjectById(projectId);

    if (!project) {
      console.error(`Project not found: ${projectId}`);
      process.exitCode = 1;
      return;
    }

    const showList = (label, values) => {
      console.log(`\n${label}:`);
      console.log(
        Array.isArray(values) && values.length > 0
          ? values.map((value) => `  - ${value}`).join("\n")
          : "  None detected"
      );
    };

    console.log("\nProject Profile");
    console.log("========================================");
    console.log(`Name:          ${project.name || "Unknown"}`);
    console.log(`ID:            ${project.id}`);
    console.log(`Path:          ${project.path || "Unknown"}`);
    console.log(`Analyzed at:   ${project.analyzedAt || "Unknown"}`);
    console.log(`Package mgr:   ${project.packageManager || "Unknown"}`);
    console.log(`Files scanned: ${project.fileCount ?? "Unknown"}`);
    console.log(`Directories:   ${project.directoryCount ?? "Unknown"}`);
    console.log(
  `Dependencies:  ${
    Array.isArray(project.dependencies)
      ? project.dependencies.length
      : "Unknown"
  }`
);

    showList("Languages", project.languages);
    showList("Technologies", project.technologies);
    showList("Frameworks", project.frameworks);
    showList(
  "Dependencies",
  Array.isArray(project.dependencies)
    ? project.dependencies.map(
        (dependency) =>
          `${dependency.name}@${dependency.version}`
      )
    : []
);
    showList("Architecture indicators", project.architecture);
    showList("Databases", project.databases);
    showList(
  "Authentication libraries",
  project.authenticationLibraries
);
    showList("Warnings", project.warnings);

    console.log("\nSummary:");
    console.log(`  ${project.summary || "No summary available."}`);
  } catch (error) {
    console.error(`Unable to load project: ${error.message}`);
    process.exitCode = 1;
  }
};
