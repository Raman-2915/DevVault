import { apiRequest } from "../api/client.js";
import { readUserConfig } from "../config/userConfig.js";
import { getAllKnowledge } from "../storage/localStorage.js";
import { errorSignature, rankEntries } from "../search/localRank.js";

function solutionFrom(entry) {
  if (entry.debug?.solution) return entry.debug.solution;
  const match = /Solution:\s*([\s\S]*)$/i.exec(entry.content || "");
  return match ? match[1].trim() : null;
}

// Finds earlier incidents/notes that look like this error: local keyword match (offline) plus
// cloud semantic search when you are logged in. Never throws; cloud problems are reported as `notice`.
export async function findSimilar(errorText, { limit = 5, cloud = true } = {}) {
  const query = errorSignature(errorText) || String(errorText).slice(0, 300);
  const found = new Map();
  let notice = null;

  for (const { entry, coverage } of rankEntries(getAllKnowledge(), query, { limit: limit * 2, boostTypes: ["debug-incident", "bug"] })) {
    found.set(entry.id, { id: entry.id, title: entry.title, project: entry.project, type: entry.type, solution: solutionFrom(entry), content: entry.content, score: coverage, origin: "local" });
  }

  if (cloud && readUserConfig().token) {
    try {
      const { results, notice: serverNotice } = await apiRequest("POST", "/api/search", { query, limit }, { timeoutMs: 15_000 });
      if (serverNotice) notice = serverNotice;

      for (const r of results) {
        const existing = found.get(r.id);
        if (existing) {
          existing.score = Math.max(existing.score, r.score);
          existing.origin = "local+cloud";
        } else {
          found.set(r.id, { id: r.id, title: r.title, project: r.project, type: r.type, solution: solutionFrom(r), content: r.content, score: r.score, origin: "cloud" });
        }
      }
    } catch (error) {
      notice = `Cloud search skipped (${error.message})`;
    }
  }

  const ranked = [...found.values()]
    .sort((a, b) => (b.solution ? 0.15 : 0) + b.score - ((a.solution ? 0.15 : 0) + a.score))
    .slice(0, limit);

  return { query, results: ranked, notice };
}

export function printSimilar({ results, notice }, { heading = "Possibly related past entries" } = {}) {
  if (!results.length) {
    console.log("\nNo similar past errors found in your vault.");
    if (notice) console.log(`(${notice})`);
    return;
  }

  console.log(`\n${heading}:`);
  console.log("-".repeat(heading.length + 1));

  results.forEach((r, index) => {
    console.log(`\n${index + 1}. ${r.title}`);
    console.log(`   project: ${r.project || "(none)"} · type: ${r.type} · match: ${Math.round(r.score * 100)}% · id: ${String(r.id).slice(0, 8)}`);

    if (r.solution) {
      console.log(`   ✔ Solution: ${r.solution.replace(/\s+/g, " ").slice(0, 400)}`);
    } else {
      console.log(`   ${String(r.content).replace(/\s+/g, " ").slice(0, 220)}`);
    }
  });

  console.log("\nOpen one fully with: devvault show <id>");
  if (notice) console.log(`(${notice})`);
}
