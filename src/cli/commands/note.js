import { randomUUID } from "node:crypto";
import { addKnowledge, addHistory } from "../../storage/localStorage.js";
import { resolveProject } from "../../storage/projectContext.js";
import { sanitizeSensitiveText } from "../../analyzer/secretSanitizer.js";
import { autoSync } from "../syncCore.js";
import { ask, readAllStdin } from "../prompt.js";

export const command = "note [text..]";
export const describe = "Save a quick note for the project you are working in";

export const builder = (yargs) =>
  yargs
    .positional("text", { type: "string", array: true, describe: "The note (quote it if it contains dashes)" })
    .option("type", { alias: "t", type: "string", default: "note", describe: "note, decision, tip, todo, snippet, learning, bug ..." })
    .option("tags", { alias: "g", type: "string", describe: "Comma-separated tags" })
    .option("title", { type: "string", describe: "Custom title (default: first line of the note)" })
    .option("project", { alias: "p", type: "string", describe: "Project name/id (default: detected from the current folder)" })
    .option("general", { type: "boolean", default: false, describe: "Don't attach to any project" })
    .option("stdin", { type: "boolean", default: false, describe: "Read the note from standard input" });

export function makeTitle(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim())?.trim() || "Note";
  if (line.length <= 80) return line;
  const cut = line.slice(0, 77);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : 77)}…`;
}

export const handler = async (argv) => {
  try {
    let text = (argv.text || []).join(" ").trim();
    if (!text && argv.stdin) text = (await readAllStdin()).trim();
    if (!text && process.stdin.isTTY) text = (await ask("Note: ")).trim();
    if (!text) throw new Error('Nothing to save. Example: devvault note "CORS needed the frontend origin in cors()"');

    const type = String(argv.type).toLowerCase();
    if (!/^[a-z0-9-]{1,30}$/.test(type)) throw new Error("--type must be 1-30 letters, digits or dashes.");

    const project = argv.general ? null : resolveProject(argv.project, { create: true });
    const now = new Date().toISOString();

    const entry = addKnowledge({
      id: randomUUID(),
      title: sanitizeSensitiveText(argv.title || makeTitle(text)),
      content: sanitizeSensitiveText(text),
      type,
      project: project?.name || null,
      projectId: project?.id || null,
      tags: argv.tags ? argv.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) : [],
      source: "manual",
      createdAt: now,
      updatedAt: now
    });

    addHistory({ action: "note", entryId: entry.id });

    console.log(`Saved ${type} ${project ? `for "${project.name}"` : "(general, no project detected here)"} · id ${entry.id.slice(0, 8)}`);
    if (!project && !argv.general) console.log('Tip: run it inside a project folder, or pass --project "name".');

    if ((await autoSync()) === null) console.log("Tip: `devvault sync` backs this up and makes it searchable with `devvault ask`.");
  } catch (error) {
    console.error(`Note failed: ${error.message}`);
    process.exitCode = 1;
  }
};
