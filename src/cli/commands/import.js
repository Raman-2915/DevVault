import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { addKnowledge, getAllKnowledge, getAllProjects, upsertProject, addHistory } from "../../storage/localStorage.js";
import { sanitizeSensitiveText } from "../../analyzer/secretSanitizer.js";

export const command = "import <file>";
export const describe = "Import knowledge from a DevVault JSON export";

export const builder = (yargs) =>
  yargs.positional("file", { type: "string", describe: "Export file created by `devvault export`" });

export const handler = (argv) => {
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(argv.file), "utf8"));

    if (raw?.format !== "devvault-export" || !Array.isArray(raw.knowledge)) {
      throw new Error("This is not a DevVault JSON export.");
    }

    const existing = getAllKnowledge();
    const ids = new Set(existing.map((entry) => entry.id));
    const fingerprints = new Set(existing.map((entry) => entry.fingerprint).filter(Boolean));

    let added = 0;
    let skipped = 0;

    for (const item of raw.knowledge) {
      const valid = item && typeof item.title === "string" && typeof item.content === "string";

      if (!valid || ids.has(item.id) || (item.fingerprint && fingerprints.has(item.fingerprint))) {
        skipped += 1;
        continue;
      }

      const now = new Date().toISOString();
      addKnowledge({
        ...item,
        id: item.id || randomUUID(),
        title: sanitizeSensitiveText(item.title),
        content: sanitizeSensitiveText(item.content),
        type: item.type || "general",
        tags: Array.isArray(item.tags) ? item.tags : [],
        createdAt: item.createdAt || now,
        updatedAt: now
      });
      added += 1;
    }

    const knownPaths = new Set(getAllProjects().map((project) => project.path));
    let projectsAdded = 0;

    for (const project of Array.isArray(raw.projects) ? raw.projects : []) {
      if (project?.path && !knownPaths.has(project.path)) {
        upsertProject(project);
        projectsAdded += 1;
      }
    }

    addHistory({ action: "import", added, skipped });
    console.log(`Imported ${added} entries (${skipped} skipped as duplicates/invalid) and ${projectsAdded} projects.`);
  } catch (error) {
    console.error(`Import failed: ${error.message}`);
    process.exitCode = 1;
  }
};
