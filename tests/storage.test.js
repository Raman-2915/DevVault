
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getDevVaultPath,
  isInitialized,
  initializeStorage,
  readData,
  writeData,
  addKnowledge,
  getAllKnowledge,
  getKnowledgeById,
  updateKnowledge,
  deleteKnowledge,
  addHistory,
  upsertProject,
  getAllProjects,
  getProjectById
} from "../src/storage/localStorage.js";

let tempDir;
let originalCwd;

before(() => {
  originalCwd = process.cwd();
  tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "devvault-tests-")
  );

  process.chdir(tempDir);
});

after(() => {
  process.chdir(originalCwd);

  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("storage starts uninitialized", () => {
  assert.equal(isInitialized(), false);
  assert.equal(
    getDevVaultPath(),
    path.join(tempDir, ".devvault")
  );
});

test("initialization creates storage files and preserves existing data", () => {
  initializeStorage();

  assert.equal(isInitialized(), true);
  assert.deepEqual(readData("knowledge"), []);
  assert.deepEqual(readData("projects"), []);
  assert.deepEqual(readData("history"), []);

  const configBefore = readData("config");

  writeData("knowledge", [{ id: "preserved", title: "Existing" }]);
  initializeStorage();

  assert.deepEqual(getAllKnowledge(), [
    { id: "preserved", title: "Existing" }
  ]);
  assert.deepEqual(readData("config"), configBefore);
});

test("readData and writeData reject unknown storage types", () => {
  assert.throws(
    () => readData("unknown"),
    /Unknown storage type/
  );

  assert.throws(
    () => writeData("unknown", []),
    /Unknown storage type/
  );
});

test("knowledge can be added and retrieved by ID", () => {
  const entry = addKnowledge({
    title: "Express routing",
    content: "Express uses routes to handle HTTP requests.",
    type: "note"
  });

  assert.ok(entry.id);
  assert.equal(entry.title, "Express routing");
  assert.equal(getKnowledgeById(entry.id).content,
    "Express uses routes to handle HTTP requests.");

  assert.equal(getAllKnowledge().length, 2);
});

test("knowledge can be updated without losing existing fields", () => {
  const entry = addKnowledge({
    id: "update-test",
    title: "Old title",
    content: "Original content",
    type: "note"
  });

  const updated = updateKnowledge(entry.id, {
    title: "Updated title"
  });

  assert.equal(updated.title, "Updated title");
  assert.equal(updated.content, "Original content");
  assert.ok(updated.updatedAt);
  assert.equal(getKnowledgeById(entry.id).title, "Updated title");
});

test("updating or deleting a nonexistent knowledge item returns null", () => {
  assert.equal(updateKnowledge("missing-id", { title: "Nope" }), null);
  assert.equal(deleteKnowledge("missing-id"), null);
  assert.equal(getKnowledgeById("missing-id"), undefined);
});

test("knowledge can be deleted", () => {
  const entry = addKnowledge({
    id: "delete-test",
    title: "Temporary note",
    content: "This note will be deleted."
  });

  const deleted = deleteKnowledge(entry.id);

  assert.equal(deleted.id, entry.id);
  assert.equal(getKnowledgeById(entry.id), undefined);
});

test("history entries receive timestamps and persist", () => {
  addHistory({
    action: "test",
    details: "Storage test"
  });

  const history = readData("history");
  const lastEntry = history.at(-1);

  assert.equal(lastEntry.action, "test");
  assert.equal(lastEntry.details, "Storage test");
  assert.ok(!Number.isNaN(Date.parse(lastEntry.createdAt)));
});

test("projects can be added and retrieved by ID", () => {
  const project = upsertProject({
    id: "project-test",
    name: "Sample Project",
    path: path.join(tempDir, "sample-project")
  });

  assert.equal(project.id, "project-test");
  assert.ok(project.createdAt);
  assert.ok(project.updatedAt);
  assert.equal(getProjectById("project-test").name, "Sample Project");
  assert.equal(getAllProjects().length, 1);
});

test("upserting the same project path updates the existing record", () => {
  const projectPath = path.join(tempDir, "same-project");

  const first = upsertProject({
    id: "same-project-id",
    name: "Original Name",
    path: projectPath
  });

  const second = upsertProject({
    id: "same-project-id",
    name: "Updated Name",
    path: projectPath
  });

  assert.equal(second.name, "Updated Name");
  assert.equal(getAllProjects().length, 2);
  assert.equal(
    getAllProjects().filter((item) => item.path === projectPath).length,
    1
  );
  assert.equal(second.createdAt, first.createdAt);
  assert.ok(Date.parse(second.updatedAt) >= Date.parse(first.updatedAt));
});
