import path from "node:path";
import { apiRequest } from "../api/client.js";
import { readUserConfig } from "../config/userConfig.js";
import { getAllProjects, getPendingSync, hashForSync, markSynced } from "../storage/localStorage.js";

const BATCH = 100;

export const projectForCloud = (project) => {
  // Absolute paths can reveal usernames/folder layout, so only the folder name leaves the machine.
  const { path: fullPath, ...rest } = project;
  return { ...rest, name: project.name || path.basename(fullPath || "project") };
};

export async function pushPending({ timeoutMs = 20_000 } = {}) {
  const pending = getPendingSync();
  const projects = getAllProjects().map(projectForCloud);
  const totals = { uploaded: 0, embedded: 0, embeddingFailed: 0 };

  for (let i = 0; i < Math.max(1, Math.ceil(pending.length / BATCH)); i++) {
    const slice = pending.slice(i * BATCH, (i + 1) * BATCH);
    const result = await apiRequest("POST", "/api/sync", { projects: i === 0 ? projects : [], knowledge: slice }, { timeoutMs });
    totals.uploaded += slice.length;
    totals.embedded += result.embedded || 0;
    totals.embeddingFailed += result.embeddingFailed || 0;
    markSynced(Object.fromEntries(slice.map((entry) => [entry.id, hashForSync(entry)])));
  }

  return totals;
}

// Background-friendly: never throws. Enabled with `devvault config set auto-sync on`.
export async function autoSync() {
  const config = readUserConfig();
  if (!config.autoSync || !config.token) return null;

  try {
    return await pushPending({ timeoutMs: 8_000 });
  } catch {
    return null; // offline is fine; the next `devvault sync` catches up
  }
}
