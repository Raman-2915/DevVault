
import {
  getAllKnowledge,
  getAllProjects,
  getProjectById
} from "../../storage/localStorage.js";

export const command = "stats";
export const describe = "Display DevVault knowledge and project statistics";

export const builder = (yargs) =>
  yargs.option("project", {
    alias: "p",
    type: "string",
    describe: "Limit statistics to a saved project ID"
  });

function countBy(items, getKey) {
  const counts = new Map();

  for (const item of items) {
    const key = getKey(item) || "unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return [...counts.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  );
}

function printCounts(title, entries, getKey) {
  console.log(`\n${title}:`);

  const counts = countBy(entries, getKey);

  if (counts.length === 0) {
    console.log("  None");
    return;
  }

  for (const [name, count] of counts) {
    console.log(`  ${name}: ${count}`);
  }
}

export const handler = ({ project: projectId }) => {
  try {
    const allProjects = getAllProjects();
    const allKnowledge = getAllKnowledge();

    let projects = allProjects;
    let knowledge = allKnowledge;
    let selectedProject = null;

    if (projectId) {
      selectedProject = getProjectById(projectId);

      if (!selectedProject) {
        throw new Error(`Project not found: ${projectId}`);
      }

      projects = [selectedProject];
      knowledge = allKnowledge.filter(
        (entry) => entry.projectId === selectedProject.id
      );
    }

    const manualEntries = knowledge.filter(
      (entry) => entry.source !== "extractor"
    );

    const extractedEntries = knowledge.filter(
      (entry) => entry.source === "extractor"
    );

    console.log("\nDevVault Statistics");
    console.log("========================================");

    if (selectedProject) {
      console.log(`Scope: ${selectedProject.name || selectedProject.id}`);
      console.log(`Project ID: ${selectedProject.id}`);
    } else {
      console.log("Scope: All saved projects");
    }

    console.log(`Projects: ${projects.length}`);
    console.log(`Knowledge entries: ${knowledge.length}`);
    console.log(`Manual / non-extractor entries: ${manualEntries.length}`);
    console.log(`Extractor entries: ${extractedEntries.length}`);

    printCounts("Knowledge by type", knowledge, (entry) => entry.type);
    printCounts("Knowledge by source", knowledge, (entry) => entry.source);

    if (!selectedProject) {
      printCounts(
        "Knowledge by project",
        knowledge,
        (entry) => {
          const project = allProjects.find(
            (item) => item.id === entry.projectId
          );

          return project?.name || entry.project || entry.projectId;
        }
      );
    }
  } catch (error) {
    console.error(`Unable to display statistics: ${error.message}`);
    process.exitCode = 1;
  }
};
