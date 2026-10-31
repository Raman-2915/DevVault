import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  initializeStorage,
  addKnowledge,
  getAllKnowledge,
  addHistory,
  upsertProject,
  writeData
} from "../src/storage/localStorage.js";

import {
  previewKnowledgeMaintenance,
  maintainProjectKnowledge
} from "../src/analyzer/knowledgeMaintenance.js";

let originalCwd;
let workspace;
let projectPath;
let project;

function writeProjectFile(relativePath, content = "") {
  const fullPath = path.join(projectPath, relativePath);

  fs.mkdirSync(path.dirname(fullPath), {
    recursive: true
  });

  fs.writeFileSync(fullPath, content);
}

function addExtractedEntry(overrides = {}) {
  const entry = {
    id: `extract-${Math.random().toString(36).slice(2)}`,
    title: "Old extracted entry",
    content: "Old extracted content",
    type: "api-route",
    sourceFile: "routes/old.js",
    sourceType: "express-route",
    source: "extractor",
    project: project.name,
    projectId: project.id,
    ...overrides
  };

  addKnowledge(entry);
  return entry;
}

function addManualEntry(overrides = {}) {
  const entry = {
    id: `manual-${Math.random().toString(36).slice(2)}`,
    title: "Manual developer note",
    content: "Keep this manual note.",
    type: "note",
    source: "manual",
    project: project.name,
    projectId: project.id,
    ...overrides
  };

  addKnowledge(entry);
  return entry;
}

beforeEach(() => {
  originalCwd = process.cwd();

  workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "devvault-maintenance-security-")
  );

  process.chdir(workspace);
  initializeStorage();

  projectPath = path.join(workspace, "sample-project");
  fs.mkdirSync(projectPath, { recursive: true });

  project = {
    id: "maintenance-security-project",
    name: "Maintenance Security Fixture",
    path: projectPath
  };

  upsertProject(project);
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(workspace, { recursive: true, force: true });
});

// 1. Traversal paths must be classified as uncertain.
test("maintenance preserves entries referencing paths outside the project", () => {
  const outsidePath = path.join(workspace, "outside.js");
  fs.writeFileSync(outsidePath, "outside project file");

  const entry = addExtractedEntry({
    sourceFile: "../outside.js"
  });

  const preview = previewKnowledgeMaintenance(project.id);

  assert.ok(
    preview.uncertain.some((item) => item.id === entry.id),
    "Outside-project source paths should be uncertain"
  );

  assert.ok(
    !preview.stale.some((item) => item.id === entry.id),
    "Outside-project entries must not be classified as stale"
  );
});

// 2. Applying maintenance must not delete traversal entries.
test("maintenance apply preserves outside-project entries", () => {
  const outsidePath = path.join(workspace, "outside.js");
  fs.writeFileSync(outsidePath, "outside project file");

  const entry = addExtractedEntry({
    sourceFile: "../outside.js"
  });

  const result = maintainProjectKnowledge(project.id, {
    apply: true
  });

  assert.ok(result.uncertain.some((item) => item.id === entry.id));
  assert.equal(
    getAllKnowledge().some((item) => item.id === entry.id),
    true,
    "The uncertain entry should remain stored"
  );
});

// 3. Stale entries inside the project should still be removable.
test("maintenance removes genuinely stale extracted entries", () => {
  writeProjectFile("routes/old.js", "export const oldRoute = true;");

  const entry = addExtractedEntry({
    sourceFile: "routes/old.js"
  });

  // Remove the source after creating the entry.
  fs.rmSync(path.join(projectPath, "routes/old.js"));

  const result = maintainProjectKnowledge(project.id, {
    apply: true
  });

  assert.ok(result.stale.some((item) => item.id === entry.id));
  assert.equal(result.removed, 1);
  assert.equal(
    getAllKnowledge().some((item) => item.id === entry.id),
    false
  );
});

// 4. Manual entries should survive even when maintenance is applied.
test("maintenance never removes manual knowledge entries", () => {
  const manual = addManualEntry();

  addExtractedEntry({
    sourceFile: "routes/missing.js"
  });

  maintainProjectKnowledge(project.id, {
    apply: true
  });

  const storedManual = getAllKnowledge().find(
    (entry) => entry.id === manual.id
  );

  assert.ok(storedManual);
  assert.equal(storedManual.content, "Keep this manual note.");
  assert.equal(storedManual.source, "manual");
});

// 5. A missing source path should remain uncertain.
test("maintenance preserves entries with missing source metadata", () => {
  const entry = addExtractedEntry({
    sourceFile: ""
  });

  const result = maintainProjectKnowledge(project.id, {
    apply: true
  });

  assert.ok(result.uncertain.some((item) => item.id === entry.id));
  assert.ok(
    getAllKnowledge().some((item) => item.id === entry.id)
  );
});

// 6. A directory used as a source file should remain uncertain.
test("maintenance preserves entries whose source path is a directory", () => {
  fs.mkdirSync(path.join(projectPath, "routes"), {
    recursive: true
  });

  const entry = addExtractedEntry({
    sourceFile: "routes"
  });

  const result = maintainProjectKnowledge(project.id, {
    apply: true
  });

  assert.ok(result.uncertain.some((item) => item.id === entry.id));
  assert.ok(
    getAllKnowledge().some((item) => item.id === entry.id)
  );
});

// 7. Maintenance preview must not modify knowledge or write history.
test("maintenance preview leaves stored knowledge and history unchanged", () => {
  addExtractedEntry({
    sourceFile: "routes/missing.js"
  });

  const beforeKnowledge = getAllKnowledge();
  const beforeHistory = JSON.parse(
    fs.readFileSync(
      path.join(workspace, ".devvault", "history.json"),
      "utf8"
    )
  );

  const result = maintainProjectKnowledge(project.id, {
    apply: false
  });

  const afterKnowledge = getAllKnowledge();
  const afterHistory = JSON.parse(
    fs.readFileSync(
      path.join(workspace, ".devvault", "history.json"),
      "utf8"
    )
  );

  assert.equal(result.applied, false);
  assert.equal(result.removed, 0);
  assert.deepEqual(afterKnowledge, beforeKnowledge);
  assert.deepEqual(afterHistory, beforeHistory);
});

// 8. Applying maintenance should record its action.
test("maintenance apply records history", () => {
  addExtractedEntry({
    sourceFile: "routes/missing.js"
  });

  maintainProjectKnowledge(project.id, {
    apply: true
  });

  const history = JSON.parse(
    fs.readFileSync(
      path.join(workspace, ".devvault", "history.json"),
      "utf8"
    )
  );

  assert.ok(
    history.some(
      (item) =>
        item.action === "maintain" &&
        item.projectId === project.id &&
        item.applied === true
    )
  );
});
