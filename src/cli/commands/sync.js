import path from "node:path";
import { apiRequest } from "../../api/client.js";
import { confirm } from "../prompt.js";
import {
  getAllProjects,
  getPendingSync,
  hashForSync,
  markSynced,
  addKnowledge,
  getAllKnowledge,
  addHistory
} from "../../storage/localStorage.js";

export const command = "sync";
export const describe = "Upload new/changed knowledge to your cloud account";

export const builder = (yargs) =>
  yargs
    .option("dry-run", { type: "boolean", default: false, describe: "Show what would be sent, send nothing" })
    .option("prune", { type: "boolean", default: false, describe: "Delete cloud entries that no longer exist locally (makes the cloud mirror this folder)" })
    .option("yes", { alias: "y", type: "boolean", default: false, describe: "Skip the confirmation for --prune" })
    .option("pull", { type: "boolean", default: false, describe: "Also download cloud entries missing locally" });

const BATCH = 100;

function projectForCloud(project) {
  // Absolute paths can reveal usernames/folder layout, so only the folder name leaves the machine.
  const { path: fullPath, ...rest } = project;
  return { ...rest, name: project.name || path.basename(fullPath || "project") };
}

export const handler = async (argv) => {
  try {
    const pending = getPendingSync();
    const projects = getAllProjects().map(projectForCloud);

    console.log("\nDevVault Sync");
    console.log("-------------");
    console.log(`Projects:               ${projects.length}`);
    console.log(`Entries to upload:      ${pending.length}`);
    console.log("Sent: titles, extracted text, tags, project profile (no file paths, no source files).");

    if (argv.dryRun) {
      pending.slice(0, 20).forEach((entry) => console.log(`  - [${entry.type}] ${entry.title}`));
      console.log("\nDry run: nothing was sent.");
      return;
    }

    const totals = { created: 0, updated: 0, unchanged: 0, embedded: 0, embeddingFailed: 0 };
    let lastEmbeddingError = null;
    const batches = Math.max(1, Math.ceil(pending.length / BATCH));

    for (let i = 0; i < batches; i++) {
      const slice = pending.slice(i * BATCH, (i + 1) * BATCH);
      const result = await apiRequest("POST", "/api/sync", {
        projects: i === 0 ? projects : [],
        knowledge: slice
      });

      for (const key of Object.keys(totals)) totals[key] += result[key] || 0;
      if (result.embeddingError) lastEmbeddingError = result.embeddingError;

      markSynced(Object.fromEntries(slice.map((entry) => [entry.id, hashForSync(entry)])));
    }

    console.log(`\nCreated: ${totals.created}  Updated: ${totals.updated}  Unchanged: ${totals.unchanged}`);
    console.log(`Embedded for semantic search: ${totals.embedded}`);

    if (totals.embeddingFailed) {
      console.warn(
        `Warning: ${totals.embeddingFailed} entries were saved but not embedded (${lastEmbeddingError}). ` +
          "Run `devvault sync` again later to retry."
      );
    }

    let pulled = 0;

    if (argv.pull) {
      const { knowledge } = await apiRequest("GET", "/api/sync/pull");
      const have = new Set(getAllKnowledge().map((entry) => entry.id));

      for (const entry of knowledge) {
        if (have.has(entry.id)) continue;
        const saved = addKnowledge({ ...entry, source: entry.source || "cloud" });
        markSynced({ [saved.id]: hashForSync(saved) });
        pulled += 1;
      }

      console.log(`Pulled from cloud: ${pulled}`);
    }

    if (argv.prune) {
      const keepIds = getAllKnowledge().map((entry) => entry.id);

      if (keepIds.length === 0) {
        console.log("\nSkipping --prune: there are no local entries (this would delete everything in the cloud).");
      } else if (argv.yes || (await confirm(`\nDelete cloud entries not present locally (keeping ${keepIds.length})?`))) {
        const { deleted } = await apiRequest("POST", "/api/sync/prune", { keepIds });
        console.log(`Pruned from cloud: ${deleted}`);
      } else {
        console.log("Prune cancelled.");
      }
    }

    addHistory({ action: "sync", uploaded: pending.length, pulled });
  } catch (error) {
    console.error(`\nSync failed: ${error.message}`);
    process.exitCode = 1;
  }
};
