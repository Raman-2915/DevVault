import fs from "node:fs";
import path from "node:path";

import {
  getAllKnowledge,
  deleteKnowledge,
  addHistory
} from "../storage/localStorage.js";

import {
  getCurrentKnowledgeSnapshot,
  createKnowledgeFingerprint
} from "./knowledgeExtractor.js";

const ROOT_METADATA_FILES = new Set([
  "readme.md",
  "readme.mdx",
  "readme.txt",
  "package.json"
]);

function normalizeSourcePath(value) {
  return String(value || "").split(path.sep).join("/");
}

function getSourceStatus(entry, snapshot, currentFingerprints) {
  if (!entry.sourceFile) {
    return "uncertain";
  }

  const relativePath = normalizeSourcePath(entry.sourceFile);
  const absolutePath = path.resolve(snapshot.projectPath, entry.sourceFile);
  const relativeCheck = path.relative(snapshot.projectPath, absolutePath);

  // Never inspect or delete based on a path outside the analyzed project.
  if (
    relativeCheck === ".." ||
    relativeCheck.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeCheck)
  ) {
    return "uncertain";
  }

  if (!fs.existsSync(absolutePath)) {
    return "stale";
  }

  let stats;

  try {
    stats = fs.statSync(absolutePath);
  } catch {
    return "uncertain";
  }

  if (!stats.isFile()) {
    return "uncertain";
  }

  const isMetadataFile = ROOT_METADATA_FILES.has(
    relativePath.toLowerCase()
  );

  const wasScanned =
    snapshot.scannedSourcePaths.has(relativePath) || isMetadataFile;

  if (!wasScanned) {
    // The file may have been skipped because of scan limits or exclusions.
    return "uncertain";
  }

  if (snapshot.scanLimited) {
    // Avoid false stale results if the scan may have been truncated.
    return "uncertain";
  }

  const fingerprint = entry.fingerprint || createKnowledgeFingerprint(entry);

  if (currentFingerprints.has(fingerprint)) {
    return "current";
  }

  return "stale";
}

export function previewKnowledgeMaintenance(projectId) {
  const snapshot = getCurrentKnowledgeSnapshot(projectId);
  const allKnowledge = getAllKnowledge();

  const extractedEntries = allKnowledge.filter(
    (entry) =>
      entry.projectId === snapshot.project.id &&
      entry.source === "extractor"
  );

  const currentFingerprints = new Set(
    snapshot.candidates.map((candidate) =>
      createKnowledgeFingerprint({
        ...candidate,
        projectId: snapshot.project.id
      })
    )
  );

  const stale = [];
  const current = [];
  const uncertain = [];

  for (const entry of extractedEntries) {
    const status = getSourceStatus(
      entry,
      snapshot,
      currentFingerprints
    );

    const summary = {
      id: entry.id,
      title: entry.title || "(untitled entry)",
      type: entry.type || "unknown",
      sourceFile: entry.sourceFile || "(unknown source)"
    };

    if (status === "stale") {
      stale.push(summary);
    } else if (status === "current") {
      current.push(summary);
    } else {
      uncertain.push(summary);
    }
  }

  return {
    project: snapshot.project,
    scannedSourceFiles: snapshot.scannedSourceFiles,
    scanLimited: snapshot.scanLimited,
    extractedEntries: extractedEntries.length,
    current,
    stale,
    uncertain,
    manualEntriesPreserved: allKnowledge.filter(
      (entry) =>
        entry.projectId === snapshot.project.id &&
        entry.source !== "extractor"
    ).length
  };
}

export function maintainProjectKnowledge(projectId, { apply = false } = {}) {
  const preview = previewKnowledgeMaintenance(projectId);

  if (!apply) {
    return {
      ...preview,
      applied: false,
      removed: 0
    };
  }

  let removed = 0;

  for (const entry of preview.stale) {
    const deleted = deleteKnowledge(entry.id);

    if (deleted) {
      removed += 1;
    }
  }

  addHistory({
    action: "maintain",
    projectId: preview.project.id,
    projectPath: preview.project.path,
    applied: true,
    staleFound: preview.stale.length,
    removed,
    uncertainPreserved: preview.uncertain.length
  });

  return {
    ...preview,
    applied: true,
    removed
  };
}