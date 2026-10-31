
import {
  getProjectById,
  getAllKnowledge
} from "../../storage/localStorage.js";

export const command = "architecture <projectId>";

export const describe =
  "Explore a project's detected architecture and API routes";

export const builder = (yargs) =>
  yargs.positional("projectId", {
    describe: "ID of a project saved by the analyze command",
    type: "string"
  });

function getRouteDetails(entry) {
  const titleMatch = entry.title?.match(
    /^API route:\s+([A-Z]+)\s+(.+)$/
  );

  const methodMatch = entry.content?.match(
    /^HTTP method:\s*(.+)$/m
  );

  const pathMatch = entry.content?.match(
    /^Route path:\s*(.+)$/m
  );

  return {
    method: methodMatch?.[1]?.trim() || titleMatch?.[1] || "OTHER",
    routePath: pathMatch?.[1]?.trim() || titleMatch?.[2] || "Unknown",
    sourceFile: entry.sourceFile || "Unknown",
    sourceLine: entry.sourceLine
  };
}

export const handler = ({ projectId }) => {
  try {
    const project = getProjectById(projectId);

    if (!project) {
      console.error(`Project not found: ${projectId}`);
      process.exitCode = 1;
      return;
    }

    const entries = getAllKnowledge().filter(
      (entry) =>
        entry.projectId === project.id &&
        entry.type === "api-route"
    );

    const routes = entries
      .map((entry) => getRouteDetails(entry))
      .sort((a, b) =>
        a.method.localeCompare(b.method) ||
        a.routePath.localeCompare(b.routePath) ||
        a.sourceFile.localeCompare(b.sourceFile)
      );

    console.log("\nDevVault Architecture Explorer");
    console.log("========================================");
    console.log(`Project: ${project.name || "Unknown"}`);
    console.log(`Project ID: ${project.id}`);
    console.log(`Path: ${project.path || "Unknown"}`);

    console.log("\nArchitecture indicators:");
    if (project.architecture?.length) {
      for (const indicator of project.architecture) {
        console.log(`  - ${indicator}`);
      }
    } else {
      console.log("  None detected");
    }

    console.log("\nDetected API routes:");
    console.log(`Total saved route entries: ${routes.length}`);

    if (routes.length === 0) {
      console.log(
        '  No saved routes found. Run "extract <projectId>" to collect route findings.'
      );
    } else {
      let currentMethod = "";

      for (const route of routes) {
        if (route.method !== currentMethod) {
          currentMethod = route.method;
          console.log(`\n${currentMethod}:`);
        }

        const line =
          Number.isInteger(route.sourceLine) && route.sourceLine > 0
            ? `:${route.sourceLine}`
            : "";

        console.log(`  ${route.routePath}`);
        console.log(`    Source: ${route.sourceFile}${line}`);
      }
    }

    console.log(
      "\nNote: routes are heuristic findings saved by the extractor, not a guarantee of every runtime endpoint."
    );
  } catch (error) {
    console.error(`Architecture inspection failed: ${error.message}`);
    process.exitCode = 1;
  }
};
