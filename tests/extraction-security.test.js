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
  upsertProject
} from "../src/storage/localStorage.js";

import {
  extractProjectKnowledge,
  getCurrentKnowledgeSnapshot
} from "../src/analyzer/knowledgeExtractor.js";

let originalCwd;
let workspace;
let projectPath;
let project;

function writeFile(relativePath, content) {
  const fullPath = path.join(projectPath, relativePath);

  fs.mkdirSync(path.dirname(fullPath), {
    recursive: true
  });

  fs.writeFileSync(fullPath, content);
}

function makeProject() {
  projectPath = path.join(workspace, "sample-project");
  fs.mkdirSync(projectPath, { recursive: true });

  project = {
    id: "extraction-security-project",
    name: "Extraction Security Fixture",
    path: projectPath,
    languages: ["JavaScript"]
  };

  upsertProject(project);
}

beforeEach(() => {
  originalCwd = process.cwd();
  workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "devvault-extraction-security-")
  );

  process.chdir(workspace);
  initializeStorage();
  makeProject();
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(workspace, { recursive: true, force: true });
});

// 1. Oversized source files should be ignored safely.
test("extractor skips source files larger than 256 KB", () => {
  writeFile(
    "src/large.js",
    "const value = '" + "x".repeat(256 * 1024) + "';"
  );

  writeFile(
    "src/small.js",
    'app.get("/safe", (req, res) => res.send("ok"));'
  );

  const snapshot = getCurrentKnowledgeSnapshot(project.id);

  assert.ok(
    snapshot.scannedSourcePaths.has("src/large.js"),
    "The scanner may discover the file even though extraction skips reading it"
  );

  const result = extractProjectKnowledge(project.id);
  const entries = getAllKnowledge();

  assert.ok(result.candidatesFound >= 1);
  assert.ok(
    entries.some((entry) => entry.title === "API route: GET /safe")
  );

  assert.ok(
    !entries.some((entry) => entry.content.includes("x".repeat(1000))),
    "Oversized source content should not be stored"
  );
});

// 2. README lines with obvious key-value credentials should be removed.
test("README extraction removes obvious credential lines", () => {
  writeFile(
    "README.md",
    [
      "# Example Project",
      "This is ordinary documentation.",
      "API_KEY = example-secret-value",
      "password: example-password",
      "access_token: example-access-token",
      "A safe sentence remains here."
    ].join("\n")
  );

  extractProjectKnowledge(project.id);

  const readmeEntry = getAllKnowledge().find(
    (entry) => entry.sourceType === "readme"
  );

  assert.ok(readmeEntry, "Expected README knowledge to be extracted");
  assert.match(readmeEntry.content, /ordinary documentation/);
  assert.match(readmeEntry.content, /safe sentence remains here/);
  assert.doesNotMatch(readmeEntry.content, /example-secret-value/);
  assert.doesNotMatch(readmeEntry.content, /example-password/);
  assert.doesNotMatch(readmeEntry.content, /example-access-token/);
});

// 3. Recognized token-like strings should cause their lines to be removed.
test("README extraction removes recognized token-like strings", () => {
  writeFile(
    "README.md",
    [
      "# Token Test",
      "sk-abcdefghijklmnop",
      "ghp_abcdefghijklmnopqrst",
      "Documentation remains available."
    ].join("\n")
  );

  extractProjectKnowledge(project.id);

  const readmeEntry = getAllKnowledge().find(
    (entry) => entry.sourceType === "readme"
  );

  assert.ok(readmeEntry);
  assert.doesNotMatch(readmeEntry.content, /sk-abcdefghijklmnop/);
  assert.doesNotMatch(readmeEntry.content, /ghp_abcdefghijklmnopqrst/);
  assert.match(readmeEntry.content, /Documentation remains available/);
});

// 4. README extraction must enforce its 2,500-character output limit.
test("README extraction limits stored content length", () => {
  writeFile("README.md", "A".repeat(5000));

  extractProjectKnowledge(project.id);

  const readmeEntry = getAllKnowledge().find(
    (entry) => entry.sourceType === "readme"
  );

  assert.ok(readmeEntry);
  assert.equal(readmeEntry.content.length, 2500);
});

// 5. Manual knowledge must not be overwritten by extraction.
test("extraction preserves existing manual knowledge", () => {
  const manualEntry = {
    id: "manual-security-entry",
    title: "My Manual Note",
    content: "Keep this manual content unchanged.",
    type: "note",
    project: project.name,
    projectId: project.id,
    source: "manual"
  };

  addKnowledge(manualEntry);
  writeFile("README.md", "# Safe Project\nOrdinary documentation.");

  extractProjectKnowledge(project.id);

  const entries = getAllKnowledge();
  const preserved = entries.find(
    (entry) => entry.id === manualEntry.id
  );

  assert.deepEqual(preserved, manualEntry);
});

// 6. Extractor should not follow a source-file symlink.
test("extractor does not extract source through a symbolic link", (context) => {
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "devvault-extraction-outside-")
  );

  try {
    const outsideFile = path.join(outside, "secret.js");
    fs.writeFileSync(
      outsideFile,
      'app.get("/outside-secret", (req, res) => res.send("secret"));'
    );

    const linkPath = path.join(projectPath, "linked.js");

    try {
      fs.symlinkSync(outsideFile, linkPath, "file");
    } catch (error) {
      if (
        error.code === "EPERM" ||
        error.code === "EACCES" ||
        error.code === "ENOTSUP"
      ) {
        context.skip(
          "Symbolic link creation is not permitted in this environment"
        );
        return;
      }

      throw error;
    }

    extractProjectKnowledge(project.id);

    const entries = getAllKnowledge();

    assert.ok(
      !entries.some((entry) => entry.content.includes("/outside-secret")),
      "Linked source should not be extracted"
    );
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
