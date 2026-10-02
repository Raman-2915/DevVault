
import { buildRelationshipMap } from "../../analyzer/relationshipMapper.js";

export const command = "map <projectId>";
export const describe = "Map source-file relationships in an analyzed project";

export const builder = (yargs) =>
  yargs.positional("projectId", {
    describe: "ID of the project saved by the analyze command",
    type: "string"
  });

export const handler = (argv) => {
  try {
    const result = buildRelationshipMap(argv.projectId);

    console.log("\nDevVault Relationship Map");
    console.log("=========================");
    console.log(`Project: ${result.project.name}`);
    console.log(`Project ID: ${result.project.id}`);
    console.log(`Path: ${result.project.path}`);
    console.log(`Project files scanned: ${result.scannedFiles}`);
    console.log(`Source files found: ${result.sourceFiles}`);
    console.log(`Relationships found: ${result.edges.length}`);

    console.log("\nFile roles");
    console.log("----------");

    const roles = Object.entries(result.roleCounts);

    if (roles.length === 0) {
      console.log("No recognized source-file roles found.");
    } else {
      for (const [role, count] of roles.sort(([a], [b]) =>
        a.localeCompare(b)
      )) {
        console.log(`${role}: ${count}`);
      }
    }

    console.log("\nRelationships");
    console.log("-------------");

    if (result.edges.length === 0) {
      console.log(
        "No resolvable relative-import relationships were found."
      );
    } else {
      for (const edge of result.edges) {
        console.log(`${edge.from}`);
        console.log(`  -> ${edge.to}`);
        console.log(`     Relationship: ${edge.relationship}`);
      }
    }

    console.log("\nNotes");
    console.log("-----");
    console.log("- Relationships are based on resolvable relative imports.");
    console.log("- An import does not prove that a function is executed at runtime.");
    console.log("- Package imports and unresolved paths are not mapped.");

    if (result.truncated) {
      console.log("- Warning: the project scan reached a configured limit.");
    }

    if (result.unreadableFiles > 0) {
      console.log(
        `- Warning: ${result.unreadableFiles} source files could not be read.`
      );
    }

    console.log("");
  } catch (error) {
    console.error(`\nRelationship mapping failed: ${error.message}`);
    process.exitCode = 1;
  }
};
