import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getAllProjects, upsertProject } from "./localStorage.js";

const MARKERS = ["package.json", "pyproject.toml", "requirements.txt", "pom.xml", "build.gradle", "go.mod", "Cargo.toml", "composer.json", "Gemfile", "pubspec.yaml"];

const norm = (p) => (process.platform === "win32" || process.platform === "darwin" ? path.resolve(p).toLowerCase() : path.resolve(p));

function isInside(child, parent) {
  const rel = path.relative(norm(parent), norm(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// Walks up from `start` to find the project root: the nearest git root, otherwise the nearest folder
// with a project marker file. Never returns the home folder or above.
export function findProjectRoot(start = process.cwd()) {
  const home = norm(os.homedir());
  let dir = path.resolve(start);
  let firstMarker = null;

  while (norm(dir) !== home) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    if (!firstMarker && MARKERS.some((marker) => fs.existsSync(path.join(dir, marker)))) firstMarker = dir;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return firstMarker;
}

export function projectNameFor(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    if (typeof pkg.name === "string" && pkg.name.trim()) return pkg.name.trim().replace(/^@[^/]+\//, "");
  } catch {
    // fall through
  }
  return path.basename(root);
}

// Finds the DevVault project for the folder you are in. With `create`, an unseen project is registered
// automatically (a light profile; run `devvault analyze .` later for the full one).
export function detectProject({ create = false, from = process.cwd() } = {}) {
  const root = findProjectRoot(from);
  if (!root) return null;

  const projects = getAllProjects();
  let project = projects.find((p) => norm(p.path) === norm(root)) || projects.find((p) => isInside(root, p.path));

  if (!project && create) {
    project = upsertProject({
      id: randomUUID(),
      name: projectNameFor(root),
      path: root,
      languages: [],
      technologies: [],
      frameworks: [],
      dependencies: [],
      databases: [],
      authenticationLibraries: [],
      architecture: [],
      packageManager: "unknown",
      summary: "Registered automatically from a note. Run `devvault analyze .` for the full profile.",
      source: "auto"
    });
  }

  if (!project) return { id: null, name: projectNameFor(root), path: root, registered: false };
  return { id: project.id, name: project.name, path: project.path, registered: true };
}

// Resolves --project <name|id|path> or falls back to the folder you are in.
export function resolveProject(nameOrId, { create = false } = {}) {
  if (nameOrId) {
    const needle = String(nameOrId).toLowerCase();
    const hit = getAllProjects().find((p) => p.id === nameOrId || p.name.toLowerCase() === needle || norm(p.path) === norm(nameOrId));
    return hit ? { id: hit.id, name: hit.name, path: hit.path, registered: true } : { id: null, name: String(nameOrId), path: null, registered: false };
  }

  return detectProject({ create });
}
