
import fs from "node:fs";
import path from "node:path";

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  ".devvault",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".output",
  "vendor",
  "target",
  "__pycache__"
]);

const IGNORED_FILES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".npmrc",
  ".pypirc",
  "id_rsa",
  "id_ed25519"
]);

const MAX_FILES = 10000;
const MAX_DEPTH = 12;

function shouldIgnoreFile(name) {
  const lower = name.toLowerCase();

  if (IGNORED_FILES.has(lower)) return true;
  if (lower.startsWith(".env.")) return true;
  if (lower.endsWith(".pem")) return true;
  if (lower.endsWith(".key")) return true;
  if (lower.endsWith(".p12")) return true;
  if (lower.endsWith(".pfx")) return true;

  return false;
}

export function scanProject(projectPath) {
  const absolutePath = path.resolve(projectPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }

  if (!fs.statSync(absolutePath).isDirectory()) {
    throw new Error(`Path is not a directory: ${absolutePath}`);
  }

  const files = [];
  const directories = [];
  let truncated = false;

  function walk(currentPath, depth) {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) {
      truncated = true;
      return;
    }

    let entries;

    try {
      entries = fs.readdirSync(currentPath, {
        withFileTypes: true
      });
    } catch {
      // Permission errors should not crash the entire scan.
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }

      const name = entry.name;
      const fullPath = path.join(currentPath, name);
      const relativePath = path.relative(
        absolutePath,
        fullPath
      );

      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(name)) continue;

        directories.push(relativePath);

        walk(fullPath, depth + 1);
        continue;
      }

      if (!entry.isFile() || shouldIgnoreFile(name)) {
        continue;
      }

      files.push(relativePath);
    }
  }

  walk(absolutePath, 0);

  return {
    absolutePath,
    files,
    directories,
    fileCount: files.length,
    directoryCount: directories.length,
    truncated
  };
}
