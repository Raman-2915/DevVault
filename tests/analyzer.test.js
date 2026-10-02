
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { scanProject } from "../src/analyzer/scanner.js";
import { detectProjectDetails } from "../src/analyzer/detector.js";
import { analyzeProject } from "../src/analyzer/projectAnalyzer.js";
import {
  initializeStorage,
  getAllProjects,
  getAllKnowledge,
  readData
} from "../src/storage/localStorage.js";

let tempDir;
let originalCwd;
let sampleProject;

function writeFile(relativePath, content) {
  const fullPath = path.join(sampleProject, relativePath);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");
}

before(() => {
  originalCwd = process.cwd();

  tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "devvault-analyzer-tests-")
  );

  process.chdir(tempDir);
  initializeStorage();

  sampleProject = path.join(tempDir, "sample-app");
  fs.mkdirSync(sampleProject, { recursive: true });

  writeFile(
    "package.json",
    JSON.stringify({
      name: "sample-app",
      version: "1.2.3",
      description: "A test application",
      type: "module",
      dependencies: {
        express: "^5.0.0",
        mongoose: "^8.0.0",
        jsonwebtoken: "^9.0.0",
        react: "^19.0.0"
      },
      devDependencies: {
        vite: "^6.0.0"
      },
      scripts: {
        start: "node server.js",
        test: "node --test"
      }
    }, null, 2)
  );

  writeFile("README.md", "# Sample App\n\nA test project.");
  writeFile("server.js", "console.log('sample app');");
  writeFile("src/App.jsx", "export default function App() { return null; }");
  writeFile("src/types.ts", "export type Status = string;");
  writeFile("routes/users.js", "export default [];");
  writeFile("models/user.js", "export default {};");

  writeFile("node_modules/ignored.js", "should not be scanned");
  writeFile(".git/ignored.js", "should not be scanned");
  writeFile(".devvault/ignored.js", "should not be scanned");
  writeFile("dist/bundle.js", "should not be scanned");
  writeFile(".env", "SECRET=do-not-read");
  writeFile(".env.development", "SECRET=do-not-read");
  writeFile("private.pem", "private key");
  writeFile("certificate.key", "private key");
});

after(() => {
  if (originalCwd) {
    process.chdir(originalCwd);
  }

  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("scanner rejects nonexistent paths", () => {
  assert.throws(
    () => scanProject(path.join(tempDir, "does-not-exist")),
    /Path does not exist/
  );
});

test("scanner rejects file paths instead of directories", () => {
  assert.throws(
    () => scanProject(path.join(sampleProject, "server.js")),
    /Path is not a directory/
  );
});

test("scanner ignores generated directories and sensitive files", () => {
  const scan = scanProject(sampleProject);

  assert.ok(scan.files.includes("package.json"));
  assert.ok(scan.files.includes("server.js"));
  assert.ok(scan.files.includes("README.md"));

  assert.ok(!scan.files.some((file) => file.startsWith("node_modules/")));
  assert.ok(!scan.files.some((file) => file.startsWith(".git/")));
  assert.ok(!scan.files.some((file) => file.startsWith(".devvault/")));
  assert.ok(!scan.files.some((file) => file.startsWith("dist/")));

  assert.ok(!scan.files.includes(".env"));
  assert.ok(!scan.files.includes(".env.development"));
  assert.ok(!scan.files.includes("private.pem"));
  assert.ok(!scan.files.includes("certificate.key"));

  assert.equal(scan.fileCount, scan.files.length);
  assert.equal(scan.directoryCount, scan.directories.length);
});

test("detector identifies languages, technologies and package scripts", () => {
  const scan = scanProject(sampleProject);
  const details = detectProjectDetails(scan);

  assert.equal(details.name, "sample-app");
  assert.equal(details.version, "1.2.3");
  assert.equal(details.description, "A test application");

  assert.ok(details.languages.includes("JavaScript"));
  assert.ok(details.languages.includes("TypeScript"));

  assert.ok(details.technologies.includes("Express"));
  assert.ok(details.technologies.includes("React"));
  assert.ok(details.technologies.includes("Vite"));
  assert.ok(details.technologies.includes("Mongoose"));
  assert.ok(details.technologies.includes("JWT"));
  assert.ok(details.technologies.includes("ES Modules"));

  assert.ok(details.frameworks.includes("Express"));
  assert.ok(details.frameworks.includes("React"));
  assert.ok(details.frameworks.includes("Vite"));

  assert.equal(details.packageManager, "unknown");
  assert.ok(details.scripts.some((script) => script.name === "start"));
  assert.ok(details.scripts.some((script) => script.name === "test"));

  assert.ok(details.architecture.includes("Route files"));
  assert.ok(details.architecture.includes("Model/schema files"));

  assert.ok(details.databases.includes("MongoDB"));
  assert.ok(details.authenticationLibraries.includes("JWT library"));

  assert.equal(details.readmePath, "README.md");
  assert.ok(details.readmeExcerpt.includes("Sample App"));
  assert.equal(details.truncated, false);
});

test("detector handles malformed package.json and missing README", () => {
  const brokenProject = path.join(tempDir, "broken-app");
  fs.mkdirSync(brokenProject, { recursive: true });

  fs.writeFileSync(
    path.join(brokenProject, "package.json"),
    "{ invalid json",
    "utf8"
  );

  fs.writeFileSync(
    path.join(brokenProject, "main.py"),
    "print('hello')",
    "utf8"
  );

  const scan = scanProject(brokenProject);
  const details = detectProjectDetails(scan);

  assert.equal(details.name, "broken-app");
  assert.ok(details.languages.includes("Python"));

  assert.ok(
    details.warnings.includes(
      "package.json exists but could not be parsed."
    )
  );

  assert.ok(
    details.warnings.includes("No readable README file was found.")
  );
});

test("analyzer saves a project and records history", () => {
  const project = analyzeProject(sampleProject);

  assert.ok(project.id);
  assert.equal(project.path, path.resolve(sampleProject));
  assert.equal(project.name, "sample-app");
  assert.ok(project.analyzedAt);

  assert.equal(
    getAllProjects().filter((item) => item.path === project.path).length,
    1
  );

  const history = readData("history");

  assert.ok(
    history.some(
      (item) =>
        item.action === "analyze" &&
        item.projectId === project.id &&
        item.projectPath === project.path
    )
  );
});

test("re-analysis preserves the project ID and updates the profile", () => {
  const first = analyzeProject(sampleProject);

  writeFile(
    "package.json",
    JSON.stringify({
      name: "sample-app",
      version: "2.0.0",
      description: "Updated test application",
      type: "module"
    }, null, 2)
  );

  const second = analyzeProject(sampleProject);

  assert.equal(second.id, first.id);
  assert.equal(second.version, "2.0.0");
  assert.equal(second.description, "Updated test application");

  assert.equal(
    getAllProjects().filter((item) => item.path === first.path).length,
    1
  );
});

test("analysis does not modify saved knowledge entries", () => {
  const knowledgeBefore = getAllKnowledge();

  analyzeProject(sampleProject);

  assert.deepEqual(getAllKnowledge(), knowledgeBefore);
});
