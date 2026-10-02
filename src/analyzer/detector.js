
import fs from "node:fs";
import path from "node:path";

function readTextFile(projectPath, relativePath, maxBytes = 200_000) {
  if (!relativePath) return null;

  const fullPath = path.join(projectPath, relativePath);

  try {
    const stat = fs.statSync(fullPath);

    if (!stat.isFile() || stat.size > maxBytes) {
      return null;
    }

    return fs.readFileSync(fullPath, "utf8");
  } catch {
    return null;
  }
}

function detectPackageManager(files) {
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  if (files.includes("bun.lock") || files.includes("bun.lockb")) {
    return "bun";
  }
  if (files.includes("package-lock.json")) return "npm";

  return "unknown";
}

function detectLanguages(files) {
  const extensions = new Set(
    files.map((file) => path.extname(file).toLowerCase())
  );

  const languageMap = {
    ".js": "JavaScript",
    ".jsx": "JavaScript",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".ts": "TypeScript",
    ".tsx": "TypeScript",
    ".py": "Python",
    ".java": "Java",
    ".go": "Go",
    ".rs": "Rust",
    ".php": "PHP",
    ".rb": "Ruby",
    ".cs": "C#",
    ".cpp": "C++",
    ".c": "C",
    ".html": "HTML",
    ".css": "CSS",
    ".sql": "SQL"
  };

  return [
    ...new Set(
      Object.entries(languageMap)
        .filter(([extension]) => extensions.has(extension))
        .map(([, language]) => language)
    )
  ];
}

function detectTechnologies(packageJson) {
  if (!packageJson) return [];

  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies
  };

  const rules = [
    ["express", "Express"],
    ["react", "React"],
    ["next", "Next.js"],
    ["vite", "Vite"],
    ["mongoose", "Mongoose"],
    ["mongodb", "MongoDB"],
    ["socket.io", "Socket.IO"],
    ["jsonwebtoken", "JWT"],
    ["bcrypt", "bcrypt"],
    ["yargs", "Yargs"],
    ["typescript", "TypeScript"],
    ["prisma", "Prisma"],
    ["sequelize", "Sequelize"],
    ["mongoose", "MongoDB with Mongoose"],
    ["tailwindcss", "Tailwind CSS"],
    ["@tanstack/react-query", "TanStack Query"],
    ["openai", "OpenAI SDK"],
    ["@google/generative-ai", "Google Generative AI SDK"],
    ["groq-sdk", "Groq SDK"]
  ];

  const detected = rules
    .filter(([dependency]) => dependencies[dependency])
    .map(([, technology]) => technology);

  if (dependencies["react-dom"]) detected.push("React DOM");

  if (packageJson.type === "module") {
    detected.push("ES Modules");
  }

  return [...new Set(detected)];
}

function detectPackageScripts(packageJson) {
  if (!packageJson?.scripts) return [];

  return Object.entries(packageJson.scripts).map(
    ([name, command]) => ({ name, command })
  );
}

function detectArchitecture(files, packageJson) {
 const lowerFiles = files.map((file) =>
  file.replace(/\\/g, "/").toLowerCase()
);
  const hasPath = (pattern) =>
    lowerFiles.some((file) => pattern.test(file));

  const architecture = [];

  if (hasPath(/(^|\/)routes?\//)) {
    architecture.push("Route files");
  }

  if (hasPath(/(^|\/)controllers?\//)) {
    architecture.push("Controller files");
  }

  if (hasPath(/(^|\/)services?\//)) {
    architecture.push("Service files");
  }

  if (hasPath(/(^|\/)models?\//) || hasPath(/(^|\/)schemas?\//)) {
    architecture.push("Model/schema files");
  }

  if (hasPath(/(^|\/)middleware\//)) {
    architecture.push("Middleware files");
  }

  if (hasPath(/(^|\/)utils?\//) || hasPath(/(^|\/)helpers?\//)) {
    architecture.push("Utility/helper files");
  }

  if (hasPath(/(^|\/)tests?\//) || hasPath(/(^|\/)__tests__\//) ||
      hasPath(/\.(test|spec)\.[cm]?[jt]sx?$/)) {
    architecture.push("Test files");
  }

  if (packageJson?.bin) {
    architecture.push("CLI package configuration");
  }

  if (hasPath(/(^|\/)dockerfile$/i) ||
      hasPath(/(^|\/)docker-compose[^/]*\.ya?ml$/)) {
    architecture.push("Docker configuration");
  }

  if (hasPath(/(^|\/)\.github\/workflows\//)) {
    architecture.push("GitHub Actions workflows");
  }

  return architecture;
}

function detectDatabaseTechnologies(packageJson, files) {
  const deps = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies
  };

  const results = [];

  if (deps.mongoose || deps.mongodb) results.push("MongoDB");
  if (deps.pg || deps["pg-promise"]) results.push("PostgreSQL");
  if (deps.mysql || deps.mysql2) results.push("MySQL");
  if (deps.sqlite3 || deps["better-sqlite3"]) results.push("SQLite");
  if (deps["@prisma/client"]) results.push("Prisma client");

  if (files.some((file) => /\.sql$/i.test(file))) {
    results.push("SQL files present");
  }

  return [...new Set(results)];
}

function detectAuthTechnologies(packageJson) {
  const deps = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies
  };

  const results = [];

  if (deps.jsonwebtoken) results.push("JWT library");
  if (deps.bcrypt || deps["bcryptjs"]) results.push("Password hashing library");
  if (deps.passport) results.push("Passport.js");
  if (deps["express-session"]) results.push("Express session middleware");
  if (deps["@clerk/nextjs"] || deps["@clerk/clerk-sdk-node"]) {
    results.push("Clerk authentication SDK");
  }

  return results;
}

export function detectProjectDetails(scan) {
  const { absolutePath, files, directories } = scan;

  const packageJsonText = readTextFile(
    absolutePath,
    "package.json"
  );

  let packageJson = null;

  if (packageJsonText) {
    try {
      packageJson = JSON.parse(packageJsonText);
    } catch {
      // Malformed package.json is recorded as a warning.
    }
  }

  const readmePath = files.find(
    (file) => /^readme(\.[^/]*)?$/i.test(path.basename(file))
  );

  const readme = readmePath
    ? readTextFile(absolutePath, readmePath, 50_000)
    : null;

  const dependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
    ...packageJson?.peerDependencies
  };

  const dependencyList = Object.entries(dependencies)
    .map(([name, version]) => ({ name, version }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const languages = detectLanguages(files);
  const technologies = detectTechnologies(packageJson);

  if (files.some((file) => /^requirements\.txt$/i.test(path.basename(file)))) {
    technologies.push("Python requirements.txt");
  }

  if (files.includes("pyproject.toml")) {
    technologies.push("Python pyproject.toml");
  }

  const frameworks = technologies.filter((technology) =>
    [
      "Express",
      "React",
      "Next.js",
      "Vite",
      "Tailwind CSS"
    ].includes(technology)
  );

  const warnings = [];

  if (files.includes("package.json") && !packageJson) {
    warnings.push("package.json exists but could not be parsed.");
  }

  if (!readme) {
    warnings.push("No readable README file was found.");
  }

  if (scan.truncated) {
    warnings.push("Scan reached a configured file or depth limit.");
  }

  const summary = [
    packageJson?.description,
    languages.length
      ? `Languages detected: ${languages.join(", ")}.`
      : null,
    technologies.length
      ? `Technologies detected: ${[...new Set(technologies)].join(", ")}.`
      : null,
    `${scan.fileCount} files and ${scan.directoryCount} directories scanned.`
  ].filter(Boolean).join(" ");

  return {
    name: packageJson?.name || path.basename(absolutePath),
    description: packageJson?.description || "",
    version: packageJson?.version || "",
    packageManager: detectPackageManager(files),
    languages,
    technologies: [...new Set(technologies)],
    frameworks: [...new Set(frameworks)],
    dependencies: dependencyList,
    scripts: detectPackageScripts(packageJson),
    architecture: detectArchitecture(files, packageJson),
    databases: detectDatabaseTechnologies(packageJson, files),
    authenticationLibraries: detectAuthTechnologies(packageJson),
    readmePath,
    readmeExcerpt: readme ? readme.slice(0, 2000) : "",
    directories: directories.slice(0, 200),
    fileCount: scan.fileCount,
    directoryCount: scan.directoryCount,
    truncated: scan.truncated,
    warnings,
    summary
  };
}
