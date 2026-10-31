
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";

const DEVVAULT_DIR = ".devvault";

const FILES = {
  config: "config.json",
  knowledge: "knowledge.json",
  projects: "projects.json",
  history: "history.json"
};

// The vault is a single per-user folder. The CLI entry point points DEVVAULT_VAULT_DIR at ~/.devvault
// (see selectVault); when it is unset (library use, tests) the vault lives in ./.devvault.
export function getDevVaultPath() {
  return process.env.DEVVAULT_VAULT_DIR || path.join(process.cwd(), DEVVAULT_DIR);
}

export function isInitialized() {
  return fs.existsSync(
    path.join(getDevVaultPath(), FILES.config)
  );
}

export function initializeStorage() {
  const basePath = getDevVaultPath();
  fs.mkdirSync(basePath, { recursive: true });

  const defaults = {
    "config.json": {
      version: 1,
      createdAt: new Date().toISOString()
    },
    "knowledge.json": [],
    "projects.json": [],
    "history.json": []
  };

  for (const [name, value] of Object.entries(defaults)) {
    const filePath = path.join(basePath, name);

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(
        filePath,
        JSON.stringify(value, null, 2),
        "utf8"
      );
    }
  }
}

function ensureInitialized() {
  if (!isInitialized()) {
    throw new Error(
      "DevVault is not set up yet. Run `devvault init` once; it creates your personal vault " +
      "that is shared by all your projects."
    );
  }
}

export function readData(type) {
  ensureInitialized();

  const fileName = FILES[type];
  if (!fileName) {
    throw new Error(`Unknown storage type: ${type}`);
  }

  const filePath = path.join(getDevVaultPath(), fileName);

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read ${fileName}: ${error.message}`
    );
  }
}

export function writeData(type, data) {
  ensureInitialized();

  const fileName = FILES[type];
  if (!fileName) {
    throw new Error(`Unknown storage type: ${type}`);
  }

  const filePath = path.join(getDevVaultPath(), fileName);
  const temporaryPath = `${filePath}.tmp`;

  try {
    fs.writeFileSync(
      temporaryPath,
      JSON.stringify(data, null, 2),
      "utf8"
    );

    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) {
      fs.rmSync(temporaryPath, { force: true });
    }

    throw new Error(
      `Could not write ${fileName}: ${error.message}`
    );
  }
}


export function addKnowledge(entry) {
  const knowledge = readData("knowledge");

  const entryWithId = {
    ...entry,
    id: entry.id || randomUUID()
  };

  knowledge.push(entryWithId);
  writeData("knowledge", knowledge);

  return entryWithId;
}

export function getAllKnowledge() {
  return readData("knowledge");
}

export function getKnowledgeById(id) {
  return getAllKnowledge().find((entry) => entry.id === id);
}


export function updateKnowledge(id, updates) {
  const knowledge = getAllKnowledge();
  const index = knowledge.findIndex((entry) => entry.id === id);

  if (index === -1) return null;

  knowledge[index] = {
    ...knowledge[index],
    ...updates,
    updatedAt: new Date().toISOString()
  };

  writeData("knowledge", knowledge);
  return knowledge[index];
}

export function deleteKnowledge(id) {
  const knowledge = getAllKnowledge();
  const index = knowledge.findIndex((entry) => entry.id === id);

  if (index === -1) return null;

  const [deleted] = knowledge.splice(index, 1);
  writeData("knowledge", knowledge);
  return deleted;
}

export function addHistory(entry) {
  const history = readData("history");

  history.push({
    ...entry,
    createdAt: new Date().toISOString()
  });

  writeData("history", history);
}

export function upsertProject(project) {
  const projects = readData("projects");

  const existingIndex = projects.findIndex(
    (item) => item.path === project.path
  );

  if (existingIndex >= 0) {
    projects[existingIndex] = {
      ...projects[existingIndex],
      ...project,
      updatedAt: new Date().toISOString()
    };
  } else {
    projects.push({
      ...project,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  writeData("projects", projects);

  return projects.find((item) => item.path === project.path);
}

export function getAllProjects() {
  return readData("projects");
}

export function getProjectById(id) {
  return getAllProjects().find((project) => project.id === id);
}

// ---- Sync / import helpers ----

export function hashForSync(entry) {
  return createHash("sha256")
    .update(
      [
        entry.title,
        entry.type,
        entry.project || undefined,
        entry.content,
        (entry.tags || []).join(",")
      ].join("|")
    )
    .digest("hex");
}

export function markSynced(hashesById) {
  const knowledge = readData("knowledge");
  const syncedAt = new Date().toISOString();

  for (const entry of knowledge) {
    if (hashesById[entry.id]) {
      entry.syncedHash = hashesById[entry.id];
      entry.syncedAt = syncedAt;
    }
  }

  writeData("knowledge", knowledge);
}

export function getPendingSync() {
  return readData("knowledge").filter((entry) => entry.syncedHash !== hashForSync(entry));
}
