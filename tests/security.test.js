import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { scanProject } from "../src/analyzer/scanner.js";

function createTempProject() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "devvault-security-")
  );

  return {
    root,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function writeFile(root, relativePath, content = "test content") {
  const fullPath = path.join(root, relativePath);

  fs.mkdirSync(path.dirname(fullPath), {
    recursive: true
  });

  fs.writeFileSync(fullPath, content);
}

// 1. Secret and credential files must not be scanned.
test("scanner excludes common secret and credential files", () => {
  const project = createTempProject();

  try {
    const allowedFiles = [
      "src/index.js",
      "package.json",
      "README.md"
    ];

    const sensitiveFiles = [
      ".env",
      ".env.local",
      ".env.production",
      ".env.development",
      ".npmrc",
      ".pypirc",
      "id_rsa",
      "id_ed25519",
      "server.pem",
      "private.key",
      "certificate.p12",
      "certificate.pfx"
    ];

    for (const file of allowedFiles) {
      writeFile(project.root, file);
    }

    for (const file of sensitiveFiles) {
      writeFile(project.root, file, "placeholder secret");
    }

    const result = scanProject(project.root);
const normalizedFiles = result.files.map((file) =>
  file.replace(/\\/g, "/")
);

    for (const file of allowedFiles) {
      assert.ok(
        normalizedFiles.includes(file),
        `Expected ${file} to be included`
      );
    }

    for (const file of sensitiveFiles) {
      assert.ok(
        !normalizedFiles.includes(file),
        `Expected ${file} to be excluded`
      );
    }
  } finally {
    project.cleanup();
  }
});

// 2. Generated and dependency directories must be ignored.
test("scanner skips generated and dependency directories", () => {
  const project = createTempProject();

  try {
    writeFile(project.root, "src/app.js");
    writeFile(project.root, "node_modules/example/index.js");
    writeFile(project.root, "dist/bundle.js");
    writeFile(project.root, "build/output.js");
    writeFile(project.root, "coverage/report.js");
    writeFile(project.root, ".git/config");
    writeFile(project.root, ".devvault/knowledge.json");
    writeFile(project.root, "__pycache__/module.pyc");

   const result = scanProject(project.root);

const normalizedFiles = result.files.map((file) =>
  file.replace(/\\/g, "/")
);

const normalizedDirectories = result.directories.map((directory) =>
  directory.replace(/\\/g, "/")
);

assert.deepEqual(normalizedFiles, ["src/app.js"]);
assert.deepEqual(normalizedDirectories, ["src"]);
assert.equal(result.truncated, false);
  } finally {
    project.cleanup();
  }
});

// 3. Symbolic links must not be followed.
test("scanner skips symbolic links when supported", (context) => {
  const project = createTempProject();

  try {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), "devvault-outside-")
    );

    try {
      writeFile(outside, "secret.js", "outside content");
      writeFile(project.root, "src/index.js");

      const linkPath = path.join(project.root, "linked-folder");

      try {
        fs.symlinkSync(outside, linkPath, "junction");
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

     const result = scanProject(project.root);

const normalizedFiles = result.files.map((file) =>
  file.replace(/\\/g, "/")
);

const normalizedDirectories = result.directories.map((directory) =>
  directory.replace(/\\/g, "/")
);

assert.ok(normalizedFiles.includes("src/index.js"));

assert.ok(
  !normalizedFiles.some((file) => file.includes("secret.js"))
);

assert.ok(
  !normalizedDirectories.includes("linked-folder")
);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    project.cleanup();
  }
});

// 4. Nonexistent paths must fail safely.
test("scanner rejects nonexistent project paths", () => {
  const project = createTempProject();

  try {
    const missingPath = path.join(project.root, "does-not-exist");

    assert.throws(
      () => scanProject(missingPath),
      /Path does not exist/
    );
  } finally {
    project.cleanup();
  }
});

// 5. A regular file must not be accepted as a project directory.
test("scanner rejects a file passed as the project path", () => {
  const project = createTempProject();

  try {
    const filePath = path.join(project.root, "app.js");
    fs.writeFileSync(filePath, "console.log('test');");

    assert.throws(
      () => scanProject(filePath),
      /Path is not a directory/
    );
  } finally {
    project.cleanup();
  }
});

// 6. Directory depth must be bounded.
test("scanner limits traversal depth", () => {
  const project = createTempProject();

  try {
    writeFile(project.root, "root.js");

    const deepPath = Array.from(
      { length: 15 },
      (_, index) => `level${index}`
    ).join(path.sep);

    writeFile(
      project.root,
      path.join(deepPath, "deep.js")
    );

    const result = scanProject(project.root);

    assert.ok(
      result.files.length < 2,
      "The deeply nested file should not be scanned"
    );

    assert.equal(result.truncated, true);
  } finally {
    project.cleanup();
  }
});

// 7. File-count limit must be enforced.
test("scanner stops at the maximum file count", () => {
  const project = createTempProject();

  try {
    // The production scanner has a maximum of 10,000 files.
    // Create one more than that to exercise the limit.
    for (let index = 0; index < 10001; index += 1) {
      fs.writeFileSync(
        path.join(project.root, `file-${index}.txt`),
        "x"
      );
    }

    const result = scanProject(project.root);

    assert.equal(result.fileCount, 10000);
    assert.equal(result.files.length, 10000);
    assert.equal(result.truncated, true);
  } finally {
    project.cleanup();
  }
});
