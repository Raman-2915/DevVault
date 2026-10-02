
import fs from "node:fs";
import path from "node:path";
import { randomUUID,createHash } from "node:crypto";
import { sanitizeSensitiveText } from "./secretSanitizer.js";

import {
  getProjectById,
  getAllKnowledge,
  addKnowledge,
  addHistory
} from "../storage/localStorage.js";

const MAX_SOURCE_FILE_BYTES = 256 * 1024;
const MAX_SOURCE_FILES = 2000;
const MAX_DIRECTORY_DEPTH = 12;
const MAX_README_LENGTH = 2500;

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".devvault",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".output",
  "vendor",
  "__pycache__"
]);

const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx"
]);

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
  "all"
]);

export function createKnowledgeFingerprint(entry) {
  const stableData = [
    entry.projectId,
    entry.sourceFile,
    entry.type,
    entry.title,
    entry.content
  ].join("|");

  return createHash("sha256")
    .update(stableData)
    .digest("hex");
}

function safeReadFile(filePath) {
  try {
    const stats = fs.statSync(filePath);

    if (!stats.isFile()) {
      return null;
    }

    if (stats.size > MAX_SOURCE_FILE_BYTES) {
      return null;
    }

    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function findRootFile(projectPath, acceptedNames) {
  try {
    const entries = fs.readdirSync(projectPath, {
      withFileTypes: true
    });

    const match = entries.find(
      (entry) =>
        entry.isFile() &&
        acceptedNames.includes(entry.name.toLowerCase())
    );

    return match
      ? path.join(projectPath, match.name)
      : null;
  } catch {
    return null;
  }
}


function sanitizeReadme(content) {
  return sanitizeSensitiveText(content)
    .trim()
    .slice(0, MAX_README_LENGTH);
}


function extractReadme(projectPath, project) {
  const readmePath = findRootFile(projectPath, [
    "readme.md",
    "readme.mdx",
    "readme.txt"
  ]);

  if (!readmePath) {
    return [];
  }

  const rawContent = safeReadFile(readmePath);

  if (!rawContent) {
    return [];
  }

  const content = sanitizeReadme(rawContent);

  if (!content) {
    return [];
  }

  return [
    {
      title: `${project.name || "Project"} — README notes`,
      content,
      type: "project-documentation",
      sourceFile: path.relative(projectPath, readmePath),
      sourceLine: 1,
      sourceType: "readme"
    }
  ];
}

function extractPackageMetadata(projectPath, project) {
  const packagePath = path.join(projectPath, "package.json");
  const rawContent = safeReadFile(packagePath);

  if (!rawContent) {
    return [];
  }

  let manifest;

  try {
    manifest = JSON.parse(rawContent);
  } catch {
    return [];
  }

  const lines = [];

  if (manifest.name) {
    lines.push(`Package name: ${manifest.name}`);
  }

  if (manifest.description) {
    lines.push(`Description: ${manifest.description}`);
  }

  if (manifest.version) {
    lines.push(`Version: ${manifest.version}`);
  }

  if (manifest.packageManager) {
    lines.push(`Package manager: ${manifest.packageManager}`);
  }

  const scriptNames = Object.keys(manifest.scripts || {});

  if (scriptNames.length > 0) {
    lines.push(`Available scripts: ${scriptNames.join(", ")}`);
  }

  const dependencies = Object.keys(manifest.dependencies || {});
  const devDependencies = Object.keys(
    manifest.devDependencies || {}
  );

  if (dependencies.length > 0) {
    lines.push(`Dependencies: ${dependencies.join(", ")}`);
  }

  if (devDependencies.length > 0) {
    lines.push(
      `Development dependencies: ${devDependencies.join(", ")}`
    );
  }

  if (lines.length === 0) {
    return [];
  }

  return [
    {
      title: `${project.name || manifest.name || "Project"} — package metadata`,
      content: sanitizeSensitiveText(lines.join("\n")),
      type: "project-metadata",
      sourceFile: "package.json",
      sourceLine: 1,
      sourceType: "package-json"
    }
  ];
}

function collectSourceFiles(rootPath) {
  const results = [];
  const pending = [{ directory: rootPath, depth: 0 }];

  while (
    pending.length > 0 &&
    results.length < MAX_SOURCE_FILES
  ) {
    const current = pending.pop();

    if (current.depth > MAX_DIRECTORY_DEPTH) {
      continue;
    }

    let entries;

    try {
      entries = fs.readdirSync(current.directory, {
        withFileTypes: true
      });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (results.length >= MAX_SOURCE_FILES) {
        break;
      }

      const fullPath = path.join(
        current.directory,
        entry.name
      );

      // Do not follow symbolic links.
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        if (
          entry.name.startsWith(".") ||
          IGNORED_DIRECTORIES.has(entry.name)
        ) {
          continue;
        }

        pending.push({
          directory: fullPath,
          depth: current.depth + 1
        });

        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        continue;
      }

      // Avoid likely test files in this initial route pass.
      if (
        /\.(test|spec)\.[^.]+$/i.test(entry.name) ||
        /(^|[/\\])__tests__([/\\]|$)/i.test(fullPath)
      ) {
        continue;
      }

      results.push(fullPath);
    }
  }

  return results;
}

function extractExpressRoutes(projectPath, sourceFiles = collectSourceFiles(projectPath)) {
  const findings = [];

  const routePattern =
    /\b(?:app|router|server)\s*\.\s*(get|post|put|patch|delete|options|head|all)\s*\(\s*(['"`])([^'"`]+)\2/g;

  for (const absoluteFilePath of sourceFiles) {
    const source = safeReadFile(absoluteFilePath);

    if (!source) {
      continue;
    }

    routePattern.lastIndex = 0;

    let match;

    while ((match = routePattern.exec(source)) !== null) {
      const method = match[1].toUpperCase();
      const routePath = match[3].trim();

      // Skip template paths that require runtime interpolation.
      if (
        !routePath ||
        routePath.includes("${") ||
        routePath.length > 300
      ) {
        continue;
      }

      const sourceLine =
        source.slice(0, match.index).split("\n").length;

      findings.push({
        title: `API route: ${method} ${routePath}`,
        content:
          `Detected an Express-style route declaration.\n` +
          `HTTP method: ${method}\n` +
          `Route path: ${routePath}\n` +
          `Declaration: ${match[0].trim()}`,
        type: "api-route",
        sourceFile: path.relative(
          projectPath,
          absoluteFilePath
        ),
        sourceLine,
        sourceType: "express-route"
      });
    }
  }

  return findings;
}

export function getCurrentKnowledgeSnapshot(projectId) {
  const project = getProjectById(projectId);

  if (!project) {
    throw new Error(
      `Project "${projectId}" was not found. Run "analyze <path>" first.`
    );
  }

  const projectPath = path.resolve(project.path);

  if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    throw new Error(
      `The project's saved path is missing or is not a directory: ${projectPath}`
    );
  }

  const sourceFiles = collectSourceFiles(projectPath);

  const candidates = [
    ...extractReadme(projectPath, project),
    ...extractPackageMetadata(projectPath, project),
    ...extractExpressRoutes(projectPath, sourceFiles)
  ];

  return {
    project,
    projectPath,
    candidates,
    scannedSourceFiles: sourceFiles.length,
    scanLimited: sourceFiles.length >= MAX_SOURCE_FILES,
    scannedSourcePaths: new Set(
      sourceFiles.map((file) =>
        path.relative(projectPath, file).split(path.sep).join("/")
      )
    )
  };
}
export function extractProjectKnowledge(projectId) {
    const snapshot = getCurrentKnowledgeSnapshot(projectId);
    const { project, projectPath, candidates } = snapshot;

  if (!project) {
    throw new Error(
      `Project "${projectId}" was not found. Run "analyze <path>" first.`
    );
  }
  if (!fs.existsSync(projectPath)) {
    throw new Error(
      `The project's saved path no longer exists: ${projectPath}`
    );
  }

  const existingKnowledge = getAllKnowledge();

  const existingFingerprints = new Set(
    existingKnowledge
      .map((entry) => entry.fingerprint)
      .filter(Boolean)
  );

  let added = 0;
  let duplicates = 0;

  for (const candidate of candidates) {
    const entry = {
  id: randomUUID(),
  ...candidate,
  project: project.name || project.path,
  projectId: project.id,
  source: "extractor",
  extractedAt: new Date().toISOString()
};

    entry.fingerprint = createKnowledgeFingerprint(entry);

    if (existingFingerprints.has(entry.fingerprint)) {
      duplicates += 1;
      continue;
    }

    addKnowledge(entry);

    existingFingerprints.add(entry.fingerprint);
    added += 1;
  }

  addHistory({
    action: "extract",
    projectId: project.id,
    projectPath: projectPath,
    added,
    duplicates
  });

  return {
    project,
    scannedSourceFiles: collectSourceFiles(projectPath).length,
    candidatesFound: candidates.length,
    added,
    duplicates
  };
}
