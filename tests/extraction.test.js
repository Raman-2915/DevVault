
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  initializeStorage,
  writeData,
  readData,
  upsertProject,
  addKnowledge,
  getAllKnowledge,
  getAllProjects,
} from "../src/storage/localStorage.js";

import {
  createKnowledgeFingerprint,
  extractProjectKnowledge,
} from "../src/analyzer/knowledgeExtractor.js";

import {
  previewKnowledgeMaintenance,
  maintainProjectKnowledge,
} from "../src/analyzer/knowledgeMaintenance.js";

let originalCwd;
let tempDir;
let projectDir;
let projectId;

before(() => {
  originalCwd = process.cwd();
  tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "devvault-extraction-tests-")
  );

  process.chdir(tempDir);
  initializeStorage();
});

after(() => {
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  writeData("knowledge", []);
  writeData("projects", []);
  writeData("history", []);

  projectId = randomUUID();
  projectDir = path.join(tempDir, "sample-project");

  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(projectDir, "routes"), { recursive: true });

  fs.writeFileSync(
    path.join(projectDir, "README.md"),
    "# Sample Project\n\nA test project for DevVault."
  );

  fs.writeFileSync(
    path.join(projectDir, "package.json"),
    JSON.stringify(
      {
        name: "sample-project",
        description: "A test project",
        version: "1.0.0",
        scripts: { start: "node server.js" },
        dependencies: { express: "^4.0.0" },
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    path.join(projectDir, "routes", "health.js"),
    [
      'import express from "express";',
      'app.get("/health", (req, res) => res.send("OK"));',
    ].join("\n")
  );

  upsertProject({
    id: projectId,
    name: "sample-project",
    path: projectDir,
    languages: ["JavaScript"],
    technologies: ["Express"],
  });
});

test("extracts README, package metadata, and Express routes", () => {
  const result = extractProjectKnowledge(projectId);
  const entries = getAllKnowledge();

  assert.equal(result.added, 3);
  assert.equal(result.duplicates, 0);

  assert.ok(
    entries.some(
      (entry) =>
        entry.type === "project-documentation" &&
        entry.sourceFile.toLowerCase() === "readme.md"
    )
  );

  assert.ok(
    entries.some(
      (entry) =>
        entry.type === "project-metadata" &&
        entry.sourceFile === "package.json" &&
        entry.content.includes("sample-project")
    )
  );

  assert.ok(
    entries.some(
      (entry) =>
        entry.type === "api-route" &&
        entry.title.includes("GET /health")
    )
  );

  assert.ok(entries.every((entry) => entry.source === "extractor"));
});

test("repeated extraction does not create duplicates", () => {
  const first = extractProjectKnowledge(projectId);
  const second = extractProjectKnowledge(projectId);

  assert.equal(first.added, 3);
  assert.equal(second.added, 0);
  assert.equal(second.duplicates, 3);
  assert.equal(getAllKnowledge().length, 3);
});

test("identical entries produce stable fingerprints", () => {
  const entry = {
    projectId,
    sourceFile: "routes/health.js",
    type: "api-route",
    title: "API route: GET /health",
    content: "HTTP method: GET",
  };

  assert.equal(
    createKnowledgeFingerprint(entry),
    createKnowledgeFingerprint({ ...entry })
  );

  assert.notEqual(
    createKnowledgeFingerprint(entry),
    createKnowledgeFingerprint({
      ...entry,
      content: "HTTP method: POST",
    })
  );
});

test("maintenance preview identifies current extracted entries", () => {
  extractProjectKnowledge(projectId);

  const preview = previewKnowledgeMaintenance(projectId);

  assert.equal(preview.extractedEntries, 3);
  assert.equal(preview.current.length, 3);
  assert.equal(preview.stale.length, 0);
  assert.equal(preview.uncertain.length, 0);
});

test("preview mode does not delete stale entries", () => {
  extractProjectKnowledge(projectId);

  const routePath = path.join(projectDir, "routes", "health.js");
  fs.writeFileSync(routePath, 'export const message = "No route";');

  const beforeCount = getAllKnowledge().length;
  const result = maintainProjectKnowledge(projectId);

  assert.equal(result.applied, false);
  assert.equal(result.removed, 0);
  assert.ok(result.stale.length >= 1);
  assert.equal(getAllKnowledge().length, beforeCount);
});

test("applying maintenance removes stale entries and preserves manual knowledge", () => {
  extractProjectKnowledge(projectId);

  const manualEntry = {
    id: randomUUID(),
    title: "Manual debugging note",
    content: "Keep this user-created note.",
    type: "debugging",
    sourceFile: "routes/health.js",
    project: "sample-project",
    projectId,
    source: "manual",
  };

  addKnowledge(manualEntry);

  const routePath = path.join(projectDir, "routes", "health.js");
  fs.writeFileSync(routePath, 'export const message = "No route";');

  const result = maintainProjectKnowledge(projectId, { apply: true });
  const remaining = getAllKnowledge();

  assert.equal(result.applied, true);
  assert.ok(result.removed >= 1);

  assert.ok(
    remaining.some((entry) => entry.id === manualEntry.id),
    "Manual knowledge must not be deleted"
  );

  assert.ok(
    remaining.some(
      (entry) =>
        entry.source === "extractor" &&
        entry.type === "project-documentation"
    ),
    "Current README knowledge should remain"
  );

  assert.ok(
    remaining.some(
      (entry) =>
        entry.source === "extractor" &&
        entry.type === "project-metadata"
    ),
    "Current package metadata should remain"
  );

  assert.ok(
    !remaining.some(
      (entry) =>
        entry.source === "extractor" &&
        entry.type === "api-route"
    ),
    "The stale API route should be removed"
  );
});

test("unknown project IDs are rejected", () => {
  assert.throws(
    () => extractProjectKnowledge("unknown-project-id"),
    /was not found/i
  );

  assert.throws(
    () => previewKnowledgeMaintenance("unknown-project-id"),
    /was not found/i
  );
});


test("missing project directories are rejected safely", () => {
  const projects = getAllProjects();
  const project = projects.find((item) => item.id === projectId);

  assert.ok(project, "Test project should exist");

  const missingPath = path.join(
    tempDir,
    "directory-that-does-not-exist"
  );

  assert.equal(fs.existsSync(missingPath), false);

  writeData(
    "projects",
    projects.map((item) =>
      item.id === projectId
        ? { ...item, path: missingPath }
        : item
    )
  );

  assert.throws(
    () => extractProjectKnowledge(projectId),
    /missing|does not exist|not a directory/i
  );

  assert.throws(
    () => previewKnowledgeMaintenance(projectId),
    /missing|does not exist|not a directory/i
  );
});


test("maintenance preserves uncertain entries", () => {
  extractProjectKnowledge(projectId);

  const uncertainEntry = {
    id: randomUUID(),
    title: "Knowledge with unknown source",
    content: "Do not delete unless its status is certain.",
    type: "project-note",
    project: "sample-project",
    projectId,
    source: "extractor",
    // Intentionally no sourceFile.
  };

  addKnowledge(uncertainEntry);

  const preview = previewKnowledgeMaintenance(projectId);

  assert.ok(
    preview.uncertain.some((entry) => entry.id === uncertainEntry.id)
  );

  const result = maintainProjectKnowledge(projectId, { apply: true });

  assert.ok(
    getAllKnowledge().some((entry) => entry.id === uncertainEntry.id),
    "Entries with uncertain status must remain"
  );

  assert.equal(result.uncertain.length, 1);
});

test("extraction records history", () => {
  extractProjectKnowledge(projectId);

  const history = readData("history");

  assert.ok(
    history.some(
      (entry) =>
        entry.action === "extract" &&
        entry.projectId === projectId
    )
  );
});
