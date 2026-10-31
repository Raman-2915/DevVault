import { getAllKnowledge } from "../../storage/localStorage.js";
import { resolveProject } from "../../storage/projectContext.js";

export const command = "notes";
export const describe = "Show recent notes for the current project (or all projects)";

export const builder = (yargs) =>
  yargs
    .option("project", { alias: "p", type: "string", describe: "Project name/id" })
    .option("all", { alias: "a", type: "boolean", default: false, describe: "Every project" })
    .option("type", { alias: "t", type: "string", describe: "Only this type (note, decision, debug-incident ...)" })
    .option("limit", { alias: "n", type: "number", default: 20 });

export const handler = (argv) => {
  try {
    const project = argv.all ? null : resolveProject(argv.project);
    let entries = getAllKnowledge().filter((e) => e.source !== "extract" && e.sourceType === undefined);

    if (!argv.all) {
      if (!project) throw new Error("No project detected here. Use --project NAME or --all.");
      entries = entries.filter((e) => (e.project || "").toLowerCase() === project.name.toLowerCase());
    }
    if (argv.type) entries = entries.filter((e) => e.type === argv.type);

    entries.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const shown = entries.slice(0, Math.min(Math.max(argv.limit || 20, 1), 200));

    console.log(`\n${argv.all ? "All projects" : project.name}: ${entries.length} note(s)\n`);
    if (!shown.length) return console.log('Nothing yet. Add one with: devvault note "what I learned"');

    for (const e of shown) {
      console.log(`${String(e.createdAt).slice(0, 10)}  [${e.type}] ${e.title}${argv.all && e.project ? `  (${e.project})` : ""}  · ${e.id.slice(0, 8)}`);
    }
  } catch (error) {
    console.error(`Notes failed: ${error.message}`);
    process.exitCode = 1;
  }
};
