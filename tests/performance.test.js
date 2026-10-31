
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { initializeStorage, upsertProject, addKnowledge, getAllKnowledge } from "../src/storage/localStorage.js";
import { getCurrentKnowledgeSnapshot } from "../src/analyzer/knowledgeExtractor.js";
import { maintainProjectKnowledge } from "../src/analyzer/knowledgeMaintenance.js";

test("large project scan is capped and maintenance preserves uncertain entries", (t) => {
  const originalCwd = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "devvault-performance-"));

  try {
    process.chdir(tempDir);
    initializeStorage();

    const projectPath = path.join(tempDir, "large-project");
    fs.mkdirSync(projectPath, { recursive: true });

    // Create 2,000 source files to exercise the discovery limit.
    for (let i = 0; i < 2000; i++) {
      const filename = `file-${String(i).padStart(4, "0")}.js`;
      fs.writeFileSync(
        path.join(projectPath, filename),
        `export const value${i} = ${i};\n`
      );
    }

    const project = upsertProject({
      id: "large-project-test",
      name: "Large Test Project",
      path: projectPath,
    });

    addKnowledge({
      id: "large-project-knowledge-test",
      title: "Previously extracted knowledge",
      content: "Previously extracted content",
      type: "api-route",
      sourceFile: "file-0000.js",
      source: "extractor",
      project: project.name,
      projectId: project.id,
    });

    const snapshot = getCurrentKnowledgeSnapshot(project.id);

    assert.equal(snapshot.scannedSourceFiles, 2000);
    assert.equal(snapshot.scanLimited, true);

    const result = maintainProjectKnowledge(project.id, { apply: true });

    assert.equal(result.applied, true);
    assert.equal(result.removed, 0);
    assert.equal(
      result.uncertain.some(
        (entry) => entry.id === "large-project-knowledge-test"
      ),
      true
    );

    assert.equal(
      getAllKnowledge().some(
        (entry) => entry.id === "large-project-knowledge-test"
      ),
      true,
      "Knowledge must be preserved when source discovery may be incomplete"
    );
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
