
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(
  new URL("../src/index.js", import.meta.url)
);

let workspace;

function runCli(args, cwd = workspace) {
  return spawnSync(
    process.execPath,
    [cliPath, ...args],
    {
      cwd,
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    }
  );
}

function storagePath(name) {
  return path.join(workspace, ".devvault", name);
}

function writeStorage(name, data) {
  fs.writeFileSync(
    storagePath(name),
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

function readStorage(name) {
  return JSON.parse(
    fs.readFileSync(storagePath(name), "utf8")
  );
}

beforeEach(() => {
  workspace = fs.mkdtempSync(
    path.join(os.tmpdir(), "devvault-cli-tests-")
  );
});

afterEach(() => {
  if (workspace) {
    fs.rmSync(workspace, { recursive: true, force: true });
    workspace = undefined;
  }
});

function initializeWorkspace() {
  const result = runCli(["init"]);

  assert.equal(
    result.status,
    0,
    `Initialization failed:\n${result.stdout}\n${result.stderr}`
  );

  assert.ok(fs.existsSync(storagePath("config.json")));
  assert.ok(fs.existsSync(storagePath("knowledge.json")));
  assert.ok(fs.existsSync(storagePath("projects.json")));
  assert.ok(fs.existsSync(storagePath("history.json")));
}

test("init initializes an isolated workspace", () => {
  initializeWorkspace();

  assert.deepEqual(readStorage("knowledge.json"), []);
  assert.deepEqual(readStorage("projects.json"), []);
  assert.deepEqual(readStorage("history.json"), []);
});

test("help displays the CLI command interface", () => {
  const result = runCli(["--help"]);

  assert.equal(
    result.status,
    0,
    `Help command failed:\n${result.stderr}`
  );

  const output = result.stdout + result.stderr;

  for (const command of [
    "init",
    "list",
    "search",
    "analyze",
    "extract",
    "maintain",
    "report",
    "stats",
  ]) {
    assert.ok(
      output.includes(command),
      `Help output should include "${command}"`
    );
  }
});

test("running without a command reports the missing command", () => {
  const result = runCli([]);

  assert.notEqual(result.status, 0);

  assert.match(
    result.stdout + result.stderr,
    /provide a command|command/i
  );
});

test("search returns seeded knowledge and records history", () => {
  initializeWorkspace();

  const entry = {
    id: "integration-search-1",
    title: "MongoDB Connection Troubleshooting",
    content: "Check the MongoDB connection string and network.",
    type: "debugging",
    project: "sample-project",
    projectId: "sample-project-id",
    source: "manual",
    tags: ["mongodb", "debugging"],
    createdAt: "2026-10-01T10:00:00.000Z",
  };

  writeStorage("knowledge.json", [entry]);

  const result = runCli([
    "search",
    "MongoDB",
    "--source",
    "manual",
    "--limit",
    "1",
  ]);

  assert.equal(
    result.status,
    0,
    `Search failed:\n${result.stdout}\n${result.stderr}`
  );

  assert.match(result.stdout, /MongoDB Connection Troubleshooting/);
  assert.match(result.stdout, /Matches:\s*1/);
  assert.match(result.stdout, /Showing:\s*1/);

  const history = readStorage("history.json");

  assert.ok(
    history.some(
      (item) =>
        item.action === "search" &&
        item.query === "MongoDB"
    ),
    "Search should record a history entry"
  );
});

test("search rejects a query without searchable characters", () => {
  initializeWorkspace();

  const result = runCli(["search", "!!!"]);

  assert.notEqual(result.status, 0);

  assert.match(
    result.stdout + result.stderr,
    /searchable character/i
  );
});

test("strict mode rejects unknown commands", () => {
  initializeWorkspace();

  const result = runCli(["not-a-real-command"]);

  assert.notEqual(result.status, 0);

  assert.match(
    result.stdout + result.stderr,
    /unknown command|not-a-real-command|command/i
  );
});

test("maintenance preview reports stale entries without deleting them", () => {
  initializeWorkspace();

  const projectId = "cli-maintenance-project";
  const projectDir = path.join(workspace, "sample-project");
  const routesDir = path.join(projectDir, "routes");

  fs.mkdirSync(routesDir, { recursive: true });

  // This file exists, but contains no matching Express route.
  fs.writeFileSync(
    path.join(routesDir, "old.js"),
    "export const value = 1;\n",
    "utf8"
  );

  writeStorage("projects.json", [
    {
      id: projectId,
      name: "sample-project",
      path: projectDir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ]);

  const staleEntry = {
    id: "stale-extracted-entry",
    title: "API route: GET /old",
    content: [
      "Detected an Express-style route declaration.",
      "HTTP method: GET",
      "Route path: /old",
      "Declaration: app.get('/old', handler)",
    ].join("\n"),
    type: "api-route",
    sourceFile: "routes/old.js",
    sourceLine: 1,
    sourceType: "express-route",
    project: "sample-project",
    projectId,
    source: "extractor",
  };

  writeStorage("knowledge.json", [staleEntry]);

  const result = runCli(["maintain", projectId]);

  assert.equal(
    result.status,
    0,
    `Maintenance preview failed:\n${result.stdout}\n${result.stderr}`
  );

  assert.match(result.stdout, /Preview only/i);
  assert.match(result.stdout, /Stale entries:\s*1/i);

  const remaining = readStorage("knowledge.json");

  assert.ok(
    remaining.some((entry) => entry.id === staleEntry.id),
    "Preview must not delete the stale entry"
  );
});

test("maintenance apply removes stale extracted entries but preserves manual entries", () => {
  initializeWorkspace();

  const projectId = "cli-maintenance-apply-project";
  const projectDir = path.join(workspace, "sample-project");
  const routesDir = path.join(projectDir, "routes");

  fs.mkdirSync(routesDir, { recursive: true });

  fs.writeFileSync(
    path.join(routesDir, "old.js"),
    "export const value = 1;\n",
    "utf8"
  );

  writeStorage("projects.json", [
    {
      id: projectId,
      name: "sample-project",
      path: projectDir,
    },
  ]);

  const staleEntry = {
    id: "stale-entry-to-remove",
    title: "API route: GET /old",
    content: "Old extracted route declaration",
    type: "api-route",
    sourceFile: "routes/old.js",
    project: "sample-project",
    projectId,
    source: "extractor",
  };

  const manualEntry = {
    id: "manual-entry-to-keep",
    title: "Manual debugging note",
    content: "Keep this user-created note.",
    type: "debugging",
    sourceFile: "routes/old.js",
    project: "sample-project",
    projectId,
    source: "manual",
  };

  writeStorage("knowledge.json", [staleEntry, manualEntry]);

  const result = runCli([
    "maintain",
    projectId,
    "--apply",
  ]);

  assert.equal(
    result.status,
    0,
    `Maintenance apply failed:\n${result.stdout}\n${result.stderr}`
  );

  assert.match(result.stdout, /Removed:\s*1/i);

  const remaining = readStorage("knowledge.json");

  assert.ok(
    !remaining.some((entry) => entry.id === staleEntry.id),
    "Confirmed-stale extracted knowledge should be removed"
  );

  assert.ok(
    remaining.some((entry) => entry.id === manualEntry.id),
    "Manual knowledge must be preserved"
  );
});
