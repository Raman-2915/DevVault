import { getAllKnowledge, getAllProjects } from "../../storage/localStorage.js";

export const command = "projects";
export const describe = "List the projects DevVault knows about, with their ids";

export const handler = () => {
  const projects = getAllProjects();
  const knowledge = getAllKnowledge();

  if (!projects.length) {
    console.log("No projects yet. Teach DevVault about one with: devvault analyze <folder>");
    return;
  }

  console.log("\nYour projects");
  console.log("-------------");

  for (const project of projects) {
    const entries = knowledge.filter((e) => e.projectId === project.id || (e.project || "").toLowerCase() === project.name.toLowerCase()).length;
    const dbs = (project.databases || []).map((d) => String(d).replace(/\s*\(.*\)$/, "")).join(", ");
    console.log(`${project.name.padEnd(24)} ${String(entries).padStart(3)} entries  ${dbs ? `[${dbs}]  ` : ""}id: ${project.id.slice(0, 8)}`);
  }

  console.log("\nRemove one with: devvault forget <name or id>");
};
