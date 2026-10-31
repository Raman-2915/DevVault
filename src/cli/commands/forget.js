import { apiRequest } from "../../api/client.js";
import { readUserConfig } from "../../config/userConfig.js";
import { deleteKnowledge, getAllKnowledge, getAllProjects, readData, writeData } from "../../storage/localStorage.js";
import { confirm } from "../prompt.js";

export const command = "forget <project>";
export const describe = "Remove a project and all its knowledge (here and in your cloud account)";

export const builder = (yargs) =>
  yargs
    .positional("project", { type: "string", describe: "Project name or id (see: devvault projects)" })
    .option("yes", { alias: "y", type: "boolean", default: false, describe: "Skip the confirmation" });

export const handler = async (argv) => {
  try {
    const needle = String(argv.project).toLowerCase();
    const matches = getAllProjects().filter((p) => p.id === argv.project || p.id.startsWith(needle) || p.name.toLowerCase() === needle);

    if (matches.length === 0) throw new Error(`No project matches "${argv.project}". See: devvault projects`);
    if (matches.length > 1) throw new Error(`"${argv.project}" matches ${matches.length} projects. Use the id from: devvault projects`);

    const [project] = matches;
    const entries = getAllKnowledge().filter((e) => e.projectId === project.id || (e.project || "").toLowerCase() === project.name.toLowerCase());

    console.log(`This removes "${project.name}" and ${entries.length} knowledge entr${entries.length === 1 ? "y" : "ies"} from this computer and your account.`);
    console.log("Your actual project files are never touched.");

    if (!argv.yes && !(await confirm("Remove it?"))) return console.log("Cancelled.");

    for (const entry of entries) deleteKnowledge(entry.id);
    writeData("projects", readData("projects").filter((p) => p.id !== project.id));
    console.log(`Removed "${project.name}" locally.`);

    if (readUserConfig().token) {
      try {
        await apiRequest("DELETE", `/api/projects/${encodeURIComponent(project.id)}`);
        console.log("Removed from your cloud account too.");
      } catch (error) {
        // Never synced, or offline: the local removal still stands.
        console.log(error.status === 404 ? "(It was never synced to your account.)" : `(Could not reach your account: ${error.message}. Run \`devvault sync --prune\` later.)`);
      }
    }
  } catch (error) {
    console.error(`Forget failed: ${error.message}`);
    process.exitCode = 1;
  }
};
