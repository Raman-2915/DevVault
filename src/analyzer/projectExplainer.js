import fs from "node:fs";
import path from "node:path";
import { scanProject } from "./scanner.js";
import { detectProjectDetails } from "./detector.js";
import { extractPatternKnowledge, listSourceFiles } from "./patternExtractor.js";
import { read, posix, topLevelKeys, findRoutes, findModels } from "./codeIntel.js";

export { topLevelKeys };

// Turns a codebase into a plain-English explanation. Everything is computed locally; no code is uploaded.

const FOLDER_ROLES = {
  routes: "URL routes: decide which code runs for each web address",
  router: "URL routes: decide which code runs for each web address",
  controllers: "Controllers: the logic that handles each request",
  models: "Data models: the shape of what is stored in the database",
  schemas: "Data schemas: the shape of stored data",
  middleware: "Middleware: checks that run before a request is handled (login, validation, security)",
  middlewares: "Middleware: checks that run before a request is handled (login, validation, security)",
  services: "Services: reusable business logic",
  utils: "Helpers used across the project",
  helpers: "Helpers used across the project",
  lib: "Shared library code",
  config: "Configuration and settings",
  views: "Pages/templates shown to users",
  templates: "Pages/templates shown to users",
  pages: "Pages of the user interface",
  components: "Reusable user-interface pieces",
  hooks: "Reusable UI logic (React hooks)",
  public: "Static files served as-is (CSS, images, browser scripts)",
  static: "Static files served as-is (CSS, images, browser scripts)",
  assets: "Images, fonts and other static assets",
  tests: "Automated tests",
  test: "Automated tests",
  __tests__: "Automated tests",
  docs: "Documentation",
  scripts: "Helper scripts",
  cli: "Command-line interface code",
  commands: "Individual CLI commands",
  analyzer: "Code that analyzes things",
  api: "API client / API code",
  backend: "The server side of the app",
  server: "The server side of the app",
  frontend: "The user-facing website",
  client: "The user-facing website",
  dashboard: "A web dashboard",
  storage: "Data storage code",
  prisma: "Database schema (Prisma)",
  migrations: "Database migrations",
  src: "Main source code"
};

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".devvault", "vendor", ".github", ".vscode"]);

function folderSummary(root, files) {
  const counts = new Map();

  for (const file of files) {
    const parts = posix(file).split("/");
    if (parts.length < 2) continue;
    const top = parts[0];
    if (IGNORE_DIRS.has(top)) continue;
    counts.set(top, (counts.get(top) || 0) + 1);
    if (["src", "app", "backend", "server", "client", "frontend"].includes(top) && parts.length > 2) {
      const key = `${top}/${parts[1]}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .filter(([name]) => !name.includes("/") || FOLDER_ROLES[name.split("/")[1]])
    .map(([name, fileCount]) => {
      const last = name.split("/").pop().toLowerCase();
      return { name, fileCount, role: FOLDER_ROLES[last] || null };
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 24);
}

function firstParagraph(readme) {
  const lines = String(readme).split(/\r?\n/);
  const out = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (out.length) break; continue; }
    if (/^(#|!\[|\[!\[|<|```|---|\|)/.test(line)) { if (out.length) break; continue; }
    out.push(line.replace(/\*\*|`|\[([^\]]+)\]\([^)]+\)/g, "$1"));
  }

  return out.join(" ").slice(0, 400);
}

const AUTH_SENTENCES = {
  jwt: "Users receive a signed token (JWT) after logging in and must send it with later requests, so the server doesn't have to remember sessions.",
  bcrypt: "Passwords are never stored as plain text; they are hashed with bcrypt before saving.",
  passport: "Login is handled by Passport.js strategies.",
  oauth: "Users can sign in with an outside account (OAuth / social login).",
  session: "Logged-in users are tracked with server-side sessions and cookies.",
  "auth-middleware": "A reusable check (middleware) blocks protected routes unless the user is logged in."
};

const EXTRA_SENTENCES = {
  "rate-limit": "Rate limiting slows down abusive or repeated requests.",
  cors: "CORS rules control which websites may call the API from a browser.",
  helmet: "Security headers (Helmet) harden the web server.",
  validation: "Incoming data is validated before it is used.",
  multer: "Users can upload files.",
  cloudinary: "Images/media are stored on Cloudinary.",
  socketio: "Real-time updates are pushed to clients with Socket.IO.",
  openai: "It calls the OpenAI API.",
  gemini: "It calls Google's Gemini API.",
  anthropic: "It calls Anthropic's Claude API.",
  groq: "It calls the Groq API.",
  redis: "It uses Redis (usually for caching or queues)."
};

export function explainProject(projectPath) {
  const root = path.resolve(projectPath);
  const scan = scanProject(root);
  const details = detectProjectDetails(scan);
  const sourceFiles = listSourceFiles(root);
  const patterns = extractPatternKnowledge(root, { name: details.name }, sourceFiles);
  const patternIds = new Set(patterns.map((p) => p.tags?.[1]).filter(Boolean));
  const lower = scan.files.map((f) => posix(f).toLowerCase());
  const has = (segment) => lower.some((f) => f.includes(`/${segment}/`) || f.startsWith(`${segment}/`));

  const routes = findRoutes(root, sourceFiles);
  const models = findModels(root, sourceFiles);
  const folders = folderSummary(root, scan.files);

  const pkg = (() => { try { return JSON.parse(read(path.join(root, "package.json"))); } catch { return {}; } })();
  const entryCandidates = [pkg.main, ...["server.js", "app.js", "index.js", "main.js", "src/server.js", "src/app.js", "src/index.js", "src/main.js", "src/main.jsx", "backend/src/server.js", "server/index.js"]].filter(Boolean);
  const entryPoints = [...new Set(entryCandidates.filter((e) => fs.existsSync(path.join(root, e))))].slice(0, 3);

  const env = patterns.find((p) => p.sourceType === "env-references");
  const envVars = env ? [...env.content.matchAll(/^- ([A-Z0-9_]+) /gm)].map((m) => m[1]) : [];
  const deploy = patterns.find((p) => p.sourceType === "deployment-files");
  const deployList = deploy ? [...deploy.content.matchAll(/^- (.+)$/gm)].map((m) => m[1]) : [];

  const isCli = patternIds.has("yargs") || patternIds.has("commander") || Boolean(pkg.bin);
  const hasWeb = routes.length > 0 || details.frameworks.some((f) => /express|fastify|koa|next|nest|hapi/i.test(f));
  const hasUi = details.frameworks.some((f) => /react|vue|angular|svelte|next/i.test(f)) || has("components") || has("pages");

  const facts = {
    name: details.name,
    description: details.description || firstParagraph(details.readmeExcerpt),
    version: details.version,
    languages: details.languages,
    frameworks: details.frameworks,
    technologies: details.technologies,
    databases: details.databases,
    authenticationLibraries: details.authenticationLibraries,
    packageManager: details.packageManager,
    scripts: details.scripts,
    entryPoints,
    folders,
    routes,
    models,
    patterns: patterns.filter((p) => !["configuration", "deployment"].includes(p.type)).map((p) => ({ label: p.title.split(" — ")[1], type: p.type, id: p.tags?.[1] })),
    envVars,
    deployment: deployList,
    fileCount: scan.fileCount,
    kind: [isCli && "command-line tool", hasWeb && "web server / API", hasUi && "web user interface"].filter(Boolean)
  };

  return { facts, markdown: renderMarkdown(facts, { has, patternIds, isCli, hasWeb, hasUi }) };
}

function list(items) {
  return items.map((i) => `- ${i}`).join("\n");
}

function renderMarkdown(f, ctx) {
  const out = [];
  const kind = f.kind.length ? f.kind.join(" + ") : "software project";
  const stack = [...new Set([...f.languages.slice(0, 2), ...f.frameworks])].join(", ");

  out.push(`# ${f.name}`, "");
  out.push(`## What it is`);
  out.push(f.description ? `${f.description}` : `A ${kind}${stack ? ` built with ${stack}` : ""}.`);
  out.push(`\nIt is a **${kind}** with about ${f.fileCount} files${f.version ? ` (version ${f.version})` : ""}.`, "");

  out.push("## Tech stack");
  out.push(list([
    f.languages.length && `Languages: ${f.languages.join(", ")}`,
    f.frameworks.length && `Frameworks: ${f.frameworks.join(", ")}`,
    f.databases.length && `Database: ${f.databases.join(", ")}`,
    f.authenticationLibraries.length && `Authentication: ${f.authenticationLibraries.join(", ")}`,
    f.packageManager && f.packageManager !== "unknown" && `Package manager: ${f.packageManager}`
  ].filter(Boolean)) || "- Not enough information to detect a stack.");
  out.push("");

  out.push("## How it is organized");
  if (f.entryPoints.length) out.push(`Start reading at **${f.entryPoints[0]}**; that is where the program starts.\n`);
  out.push(f.folders.length
    ? list(f.folders.map((d) => `\`${d.name}/\` (${d.fileCount} ${d.fileCount === 1 ? "file" : "files"})${d.role ? `: ${d.role}` : ""}`))
    : "- Everything lives in the top-level folder.");
  out.push("");

  out.push("## How it works (the journey of one request)");
  const steps = [];
  if (ctx.isCli) {
    steps.push("A person types a command in the terminal.", `The entry file${f.entryPoints[0] ? ` (${f.entryPoints[0]})` : ""} reads the command and its options.`);
    if (ctx.has("commands")) steps.push("The matching file in `commands/` runs that command.");
    if (ctx.has("storage") || ctx.has("lib")) steps.push("Helper modules read or write data and do the heavy lifting.");
    steps.push("The result is printed back in the terminal.");
  } else if (ctx.hasWeb) {
    steps.push("A browser or app sends a request to the server" + (f.entryPoints[0] ? ` (started in ${f.entryPoints[0]})` : "") + ".");
    if (ctx.has("middleware") || ctx.patternIds.has("cors") || ctx.patternIds.has("helmet")) steps.push("Middleware runs first: security headers, CORS, login checks, input validation.");
    steps.push("Routing matches the web address and HTTP method to a handler" + (ctx.has("routes") ? " (files in `routes/`)" : "") + ".");
    if (ctx.has("controllers")) steps.push("A controller in `controllers/` contains the logic for that action.");
    if (ctx.has("services")) steps.push("Services hold reusable business logic.");
    if (f.models.length || f.databases.length) steps.push(`Data is read or written in ${f.databases[0] || "the database"}${f.models.length ? ` through models (${f.models.slice(0, 4).map((m) => m.name).join(", ")})` : ""}.`);
    steps.push(ctx.has("views") ? "A page (template) is rendered and sent back." : "A response (usually JSON) is sent back to the caller.");
  } else if (ctx.hasUi) {
    steps.push("The browser loads the app's entry file.", "Pages and components draw the screen.", "User actions trigger state changes and, if needed, calls to a backend API.");
  } else {
    steps.push("Execution starts at the entry file and calls helper modules in turn.");
  }
  out.push(steps.map((s, i) => `${i + 1}. ${s}`).join("\n"), "");

  const nodes = ctx.isCli
    ? ["Terminal command", "Entry file", ctx.has("commands") && "Command handler", (ctx.has("storage") || ctx.has("lib")) && "Helpers / storage", "Printed result"]
    : ctx.hasWeb
      ? ["Client request", (ctx.has("middleware") || ctx.patternIds.has("cors")) && "Middleware", "Routes", ctx.has("controllers") && "Controllers", ctx.has("services") && "Services", (f.databases.length || f.models.length) && "Database", "Response"]
      : ["Entry file", "Modules", "Output"];
  const chain = nodes.filter(Boolean);
  out.push("```mermaid", "flowchart LR", chain.map((n, i) => `  N${i}["${n}"]`).join("\n"), chain.slice(1).map((_, i) => `  N${i} --> N${i + 1}`).join("\n"), "```", "");

  if (f.routes.length) {
    out.push("## What it can do (API endpoints)");
    const shown = f.routes.slice(0, 40);
    out.push(list(shown.map((r) => `\`${r.method} ${r.path}\` (${r.file})`)));
    if (f.routes.length > shown.length) out.push(`- …and ${f.routes.length - shown.length} more.`);
    out.push("");
  }

  if (f.models.length) {
    out.push("## Data it stores");
    out.push(list(f.models.map((m) => `**${m.name}**${m.fields.length ? `: ${m.fields.join(", ")}` : ""} (${m.file})`)));
    out.push("");
  }

  const sentences = [
    ...Object.entries(AUTH_SENTENCES).filter(([id]) => ctx.patternIds.has(id)).map(([, s]) => s),
    ...Object.entries(EXTRA_SENTENCES).filter(([id]) => ctx.patternIds.has(id)).map(([, s]) => s)
  ];
  if (sentences.length) out.push("## Security, integrations and extras", list(sentences), "");

  out.push("## How to run it");
  const scripts = f.scripts.filter((s) => ["install", "dev", "start", "build", "test", "lint"].includes(s.name));
  const pm = f.packageManager && f.packageManager !== "unknown" ? f.packageManager : "npm";
  out.push(list([
    `Install dependencies: \`${pm} install\``,
    ...scripts.map((s) => `${s.name}: \`${pm} run ${s.name}\` (runs \`${s.command}\`)`),
    f.envVars.length && `Create a \`.env\` file with: ${f.envVars.slice(0, 12).map((v) => `\`${v}\``).join(", ")}`
  ].filter(Boolean)), "");

  if (f.deployment.length) out.push("## Deployment", list(f.deployment), "");

  out.push("## Where to look first", list([
    f.entryPoints[0] && `\`${f.entryPoints[0]}\`: where everything starts`,
    f.routes[0] && `\`${f.routes[0].file}\`: the first place requests land`,
    f.models[0] && `\`${f.models[0].file}\`: how data is shaped`
  ].filter(Boolean)) || "- Browse the folders listed above.", "");

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
