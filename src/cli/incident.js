import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { addKnowledge, addHistory, getDevVaultPath } from "../storage/localStorage.js";
import { sanitizeSensitiveText } from "../analyzer/secretSanitizer.js";

export function saveIncident({ error, structured, project }) {
  const now = new Date().toISOString();
  const entry = addKnowledge({
    id: randomUUID(),
    title: structured.title,
    type: "debug-incident",
    project: project?.name || null,
    projectId: project?.id || null,
    tags: ["debugging", ...structured.tags.filter((tag) => tag !== "debugging")],
    content: `Problem: ${structured.problem}\nCause: ${structured.cause}\nSolution: ${structured.solution}`,
    debug: { error: error.slice(0, 6000), cause: structured.cause, solution: structured.solution },
    source: "capture-error",
    createdAt: now,
    updatedAt: now
  });

  addHistory({ action: "capture-error", entryId: entry.id });
  return entry;
}

// Builds the structured note ourselves when the AI is unavailable.
export function manualStructure({ error, cause, solution }) {
  const firstLine = (error.split(/\r?\n/).find((l) => l.trim()) || "Error").trim();
  const title = firstLine.length > 90 ? `${firstLine.slice(0, 87)}…` : firstLine;
  return {
    title,
    problem: firstLine,
    cause: cause || "Not recorded",
    solution: solution || "Not recorded yet",
    tags: []
  };
}

// ---- "last error" slot, written by `devvault run` so the fix can be captured later ----
const lastErrorFile = () => path.join(getDevVaultPath(), "last-error.json");

export function rememberLastError(data) {
  try {
    fs.writeFileSync(lastErrorFile(), JSON.stringify({ ...data, savedAt: new Date().toISOString() }), "utf8");
  } catch {
    // best effort
  }
}

export function readLastError() {
  try {
    return JSON.parse(fs.readFileSync(lastErrorFile(), "utf8"));
  } catch {
    return null;
  }
}

export const clean = (text) => sanitizeSensitiveText(String(text ?? "")).trim();
