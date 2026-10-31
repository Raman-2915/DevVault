import fs from "node:fs";
import path from "node:path";
import { getAllKnowledge, getAllProjects } from "../../storage/localStorage.js";

export const command = "export <file>";
export const describe = "Export knowledge and project profiles to a JSON or Markdown file";

export const builder = (yargs) =>
  yargs
    .positional("file", { type: "string", describe: "Output file (.json or .md)" })
    .option("force", { type: "boolean", default: false, describe: "Overwrite an existing file" });

export function toMarkdown(knowledge) {
  const lines = ["# DevVault export", ""];

  for (const entry of knowledge) {
    lines.push(`## ${entry.title}`);
    lines.push(`*${entry.type}${entry.project ? ` · ${entry.project}` : ""}${entry.tags?.length ? ` · ${entry.tags.join(", ")}` : ""}*`, "");
    lines.push(entry.content, "");
  }

  return lines.join("\n");
}

export const handler = (argv) => {
  try {
    const target = path.resolve(argv.file);

    if (fs.existsSync(target) && !argv.force) {
      throw new Error(`${target} already exists. Use --force to overwrite.`);
    }

    const knowledge = getAllKnowledge().map(({ syncedHash, syncedAt, ...entry }) => entry);
    const projects = getAllProjects();

    const output = target.toLowerCase().endsWith(".md")
      ? toMarkdown(knowledge)
      : JSON.stringify({ format: "devvault-export", version: 1, exportedAt: new Date().toISOString(), projects, knowledge }, null, 2);

    fs.writeFileSync(target, output, "utf8");
    console.log(`Exported ${knowledge.length} entries and ${projects.length} projects to ${target}`);
  } catch (error) {
    console.error(`Export failed: ${error.message}`);
    process.exitCode = 1;
  }
};
