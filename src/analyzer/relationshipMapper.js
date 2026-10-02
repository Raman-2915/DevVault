import fs from "node:fs";
import path from "node:path";

import { scanProject } from "./scanner.js";
import { getProjectById } from "../storage/localStorage.js";

const SOURCE_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs",
  ".ts", ".tsx", ".mts", ".cts"
]);

const IGNORED_SOURCE_DIRECTORIES = new Set([
  "node_modules", ".git", ".svn", ".hg", ".devvault",
  "dist", "build", "coverage", ".next", ".nuxt",
  ".output", "vendor", "target", "__pycache__"
]);

const MAX_SOURCE_BYTES = 512 * 1024;

function classifyFile(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  const baseName = path.posix.basename(normalized);
  const segments = normalized.split("/");

  if (
    segments.some((part) => IGNORED_SOURCE_DIRECTORIES.has(part)) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(baseName) ||
    baseName.startsWith("test-")
  ) {
    return "test-or-ignored";
  }

  if (/(^|\/)routes?(\/|$)/.test(normalized) || /(^|\/)routes?\.[cm]?[jt]sx?$/.test(normalized)) {
    return "route";
  }

  if (/(^|\/)controllers?(\/|$)/.test(normalized) || /(^|\/)controllers?\.[cm]?[jt]sx?$/.test(normalized)) {
    return "controller";
  }

  if (/(^|\/)services?(\/|$)/.test(normalized) || /(^|\/)services?\.[cm]?[jt]sx?$/.test(normalized)) {
    return "service";
  }

  if (
    /(^|\/)models?(\/|$)/.test(normalized) ||
    /(^|\/)schemas?(\/|$)/.test(normalized) ||
    /(^|\/)entities?(\/|$)/.test(normalized)
  ) {
    return "model";
  }

  if (/(^|\/)middlewares?(\/|$)/.test(normalized) || /(^|\/)middlewares?\.[cm]?[jt]sx?$/.test(normalized)) {
    return "middleware";
  }

  if (/(^|\/)(utils?|helpers?)(\/|$)/.test(normalized)) {
    return "utility";
  }

  if (/(^|\/)(config|configs|configuration)(\/|$)/.test(normalized)) {
    return "config";
  }

  if (/(^|\/)(db|database|repositories|repository)(\/|$)/.test(normalized)) {
    return "data-access";
  }

  return "source";
}

function readSource(projectPath, relativePath) {
  const fullPath = path.resolve(projectPath, relativePath);

  // Never read files outside the analyzed project.
  const relativeToRoot = path.relative(projectPath, fullPath);
  if (
    relativeToRoot.startsWith("..") ||
    path.isAbsolute(relativeToRoot)
  ) {
    return null;
  }

  try {
    const stat = fs.lstatSync(fullPath);

    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > MAX_SOURCE_BYTES
    ) {
      return null;
    }

    return fs.readFileSync(fullPath, "utf8");
  } catch {
    return null;
  }
}

function extractImportSpecifiers(source) {
  const patterns = [
    /\bimport\s+(?:[\s\S]*?\s+from\s*)?["']([^"' \n]+)["']/g,
    /\bexport\s+[\s\S]*?\s+from\s*["']([^"' \n]+)["']/g,
    /\brequire\s*\(\s*["']([^"' \n]+)["']\s*\)/g,
    /\bimport\s*\(\s*["']([^"' \n]+)["']\s*\)/g
  ];

  const specifiers = new Set();

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1]);
    }
  }

  return [...specifiers];
}

function resolveRelativeImport(projectPath, fromFile, specifier, knownFiles) {
  if (!specifier.startsWith(".")) return null;

  const fromDirectory = path.posix.dirname(fromFile.replace(/\\/g, "/"));
  const base = path.posix.normalize(
    path.posix.join(fromDirectory, specifier)
  );

  if (base === ".." || base.startsWith("../") || path.posix.isAbsolute(base)) {
    return null;
  }

  const candidates = [
    base,
    ...[...SOURCE_EXTENSIONS].map((extension) => `${base}${extension}`),
    ...[...SOURCE_EXTENSIONS].map((extension) =>
      path.posix.join(base, `index${extension}`)
    ),
    path.posix.join(base, "package.json")
  ];

  for (const candidate of candidates) {
    const normalized = path.posix.normalize(candidate);

    if (knownFiles.has(normalized)) {
      return normalized;
    }
  }

  // Do not guess when the imported file cannot be found.
  return null;
}

export function buildRelationshipMap(projectId) {
  const project = getProjectById(projectId);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  if (!project.path || !fs.existsSync(project.path)) {
    throw new Error("The saved project path no longer exists.");
  }

  const scan = scanProject(project.path);
  const projectPath = path.resolve(project.path);

  const sourceFiles = scan.files
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => SOURCE_EXTENSIONS.has(path.posix.extname(file).toLowerCase()));

  const knownFiles = new Set(
    scan.files.map((file) => file.replace(/\\/g, "/"))
  );

  const nodes = sourceFiles.map((file) => ({
    id: file,
    path: file,
    role: classifyFile(file)
  }));

  const nodeByPath = new Map(nodes.map((node) => [node.path, node]));
  const edges = [];
  const edgeKeys = new Set();
  let unreadableFiles = 0;

  for (const file of sourceFiles) {
    const source = readSource(projectPath, file);

    if (source === null) {
      unreadableFiles += 1;
      continue;
    }

    for (const specifier of extractImportSpecifiers(source)) {
      const targetPath = resolveRelativeImport(
        projectPath,
        file,
        specifier,
        knownFiles
      );

      if (!targetPath || !nodeByPath.has(targetPath)) continue;
      if (targetPath === file) continue;

      const key = `${file} -> ${targetPath}`;
      if (edgeKeys.has(key)) continue;

      edgeKeys.add(key);

      const sourceRole = nodeByPath.get(file).role;
      const targetRole = nodeByPath.get(targetPath).role;

      edges.push({
        from: file,
        to: targetPath,
        kind: "imports",
        relationship:
          sourceRole === "route" && targetRole === "controller"
            ? "route-imports-controller"
            : `${sourceRole}-imports-${targetRole}`
      });
    }
  }

  const roleCounts = {};

  for (const node of nodes) {
    if (node.role === "test-or-ignored") continue;
    roleCounts[node.role] = (roleCounts[node.role] || 0) + 1;
  }

  return {
    project: {
      id: project.id,
      name: project.name || path.basename(projectPath),
      path: projectPath
    },
    scannedFiles: scan.fileCount,
    sourceFiles: sourceFiles.length,
    unreadableFiles,
    truncated: scan.truncated,
    nodes,
    edges,
    roleCounts
  };
}
