import fs from "node:fs";
import path from "node:path";
import { addKnowledge, getAllKnowledge, getAllProjects, upsertProject, getDevVaultPath, isInitialized, initializeStorage } from "../../storage/localStorage.js";
import { getGlobalVaultPath } from "../../storage/vault.js";

export const command = "vault <action>";
export const describe = "Vault tools: `migrate` merges an old per-folder vault into your personal one; `where` shows its path";

export const builder = (yargs) =>
  yargs
    .positional("action", { choices: ["migrate", "where"] })
    .option("from", { type: "string", describe: "Folder containing the old .devvault (default: current folder)" });

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export const handler = (argv) => {
  try {
    if (argv.action === "where") {
      console.log(getDevVaultPath());
      return;
    }

    const source = path.join(path.resolve(argv.from || process.cwd()), ".devvault");
    const globalPath = getGlobalVaultPath();

    if (!fs.existsSync(path.join(source, "config.json"))) throw new Error(`No old vault found at ${source}`);
    if (path.resolve(source) === path.resolve(globalPath)) throw new Error("That already is your personal vault.");

    // Switch to the personal vault for the merge.
    process.env.DEVVAULT_VAULT_DIR = globalPath;
    if (!isInitialized()) initializeStorage();

    const oldKnowledge = readJson(path.join(source, "knowledge.json"));
    const oldProjects = fs.existsSync(path.join(source, "projects.json")) ? readJson(path.join(source, "projects.json")) : [];

    const haveIds = new Set(getAllKnowledge().map((e) => e.id));
    const haveFingerprints = new Set(getAllKnowledge().map((e) => e.fingerprint).filter(Boolean));
    let added = 0;

    for (const entry of oldKnowledge) {
      if (haveIds.has(entry.id) || (entry.fingerprint && haveFingerprints.has(entry.fingerprint))) continue;
      const { syncedHash, syncedAt, ...rest } = entry; // re-upload under the new vault
      addKnowledge(rest);
      added += 1;
    }

    const havePaths = new Set(getAllProjects().map((p) => p.path));
    let projectsAdded = 0;
    for (const project of oldProjects) {
      if (!havePaths.has(project.path)) { upsertProject(project); projectsAdded += 1; }
    }

    fs.renameSync(source, `${source}.migrated`);
    console.log(`Merged ${added} entries and ${projectsAdded} projects into ${globalPath}`);
    console.log(`The old folder was renamed to ${path.basename(source)}.migrated (delete it when you're happy).`);
  } catch (error) {
    console.error(`Vault failed: ${error.message}`);
    process.exitCode = 1;
  }
};
