
import path from "node:path";
import { randomUUID } from "node:crypto";

import { scanProject } from "./scanner.js";
import { detectProjectDetails } from "./detector.js";

import {
  upsertProject,
  getAllProjects,
  addHistory
} from "../storage/localStorage.js";

export function analyzeProject(inputPath) {
  const absolutePath = path.resolve(inputPath);

  const scan = scanProject(absolutePath);
  const details = detectProjectDetails(scan);

  const existing = getAllProjects().find(
    (project) => project.path === absolutePath
  );

  const profile = {
    id: existing?.id || randomUUID(),
    path: absolutePath,
    ...details,
    analyzedAt: new Date().toISOString()
  };

  const saved = upsertProject(profile);

  addHistory({
    action: "analyze",
    projectId: saved.id,
    projectPath: absolutePath
  });

  return saved;
}
