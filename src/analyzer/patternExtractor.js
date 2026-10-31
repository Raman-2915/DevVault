import fs from "node:fs";
import path from "node:path";
import { sanitizeSensitiveText } from "./secretSanitizer.js";

// Detects higher-level engineering patterns that README/package/route extraction misses.
// Only *names and locations* are recorded, never values (env values, secrets, tokens).

const PATTERNS = [
  { id: "jwt", type: "authentication", label: "JWT authentication", regex: /\b(?:jsonwebtoken|jwt\.sign|jwt\.verify|jwt-decode|passport-jwt)\b/ },
  { id: "bcrypt", type: "authentication", label: "bcrypt password hashing", regex: /\b(?:bcrypt(?:js)?\.(?:hash|compare|genSalt)|require\(["']bcrypt(?:js)?["']\)|from ["']bcrypt(?:js)?["'])/ },
  { id: "passport", type: "authentication", label: "Passport.js authentication", regex: /\bpassport\.(?:use|authenticate|initialize)\b/ },
  { id: "oauth", type: "authentication", label: "OAuth / social login", regex: /\b(?:GoogleStrategy|GithubStrategy|passport-google-oauth|passport-github|OAuth2Client)\b/ },
  { id: "session", type: "authentication", label: "Session-based authentication", regex: /\b(?:express-session|cookie-session)\b/ },
  { id: "auth-middleware", type: "authentication", label: "Authentication middleware", regex: /\b(?:verifyToken|authMiddleware|requireAuth|isAuthenticated|protect|ensureAuth)\b\s*[,)=(]/ },
  { id: "mongoose", type: "database", label: "MongoDB with Mongoose", regex: /\bmongoose\.(?:connect|model|Schema)\b|new\s+(?:mongoose\.)?Schema\s*\(/ },
  { id: "mongodb-driver", type: "database", label: "MongoDB native driver", regex: /\bMongoClient\b/ },
  { id: "postgres", type: "database", label: "PostgreSQL", regex: /\b(?:new\s+Pool|pg\.Client|from ["']pg["']|require\(["']pg["']\))/ },
  { id: "sequelize", type: "database", label: "Sequelize ORM", regex: /\bnew\s+Sequelize\b|\bsequelize\.define\b/ },
  { id: "prisma", type: "database", label: "Prisma ORM", regex: /\bnew\s+PrismaClient\b/ },
  { id: "mysql", type: "database", label: "MySQL", regex: /\bmysql2?\.create(?:Connection|Pool)\b/ },
  { id: "redis", type: "database", label: "Redis", regex: /\bcreateClient\s*\(|\bnew\s+Redis\s*\(/ },
  { id: "yargs", type: "cli", label: "Yargs CLI", regex: /\byargs\s*\(|\bfrom ["']yargs["']|require\(["']yargs["']\)/ },
  { id: "commander", type: "cli", label: "Commander CLI", regex: /\bnew\s+Command\s*\(|\bprogram\.command\s*\(/ },
  { id: "openai", type: "ai-integration", label: "OpenAI API", regex: /\bnew\s+OpenAI\s*\(|\bapi\.openai\.com\b|chat\.completions\.create/ },
  { id: "gemini", type: "ai-integration", label: "Google Gemini API", regex: /\bGoogleGenerativeAI\b|generativelanguage\.googleapis\.com|@google\/genai/ },
  { id: "anthropic", type: "ai-integration", label: "Anthropic Claude API", regex: /\bnew\s+Anthropic\s*\(|api\.anthropic\.com|@anthropic-ai\/sdk/ },
  { id: "groq", type: "ai-integration", label: "Groq API", regex: /\bapi\.groq\.com\b|\bgroq-sdk\b/ },
  { id: "multer", type: "file-upload", label: "File uploads (Multer)", regex: /\bmulter\s*\(/ },
  { id: "cloudinary", type: "file-upload", label: "Cloudinary media storage", regex: /\bcloudinary\.(?:v2|uploader|config)\b/ },
  { id: "socketio", type: "realtime", label: "Socket.IO realtime", regex: /\bnew\s+Server\s*\(.*\)|\bio\.on\(\s*["']connection["']|\bsocket\.io\b/ },
  { id: "rate-limit", type: "security", label: "Rate limiting", regex: /\brateLimit\s*\(|express-rate-limit/ },
  { id: "cors", type: "security", label: "CORS configuration", regex: /\bcors\s*\(/ },
  { id: "helmet", type: "security", label: "Helmet security headers", regex: /\bhelmet\s*\(/ },
  { id: "validation", type: "security", label: "Input validation", regex: /\b(?:express-validator|Joi\.object|z\.object|yup\.object)\b/ }
];

const ENV_REFERENCE = /\bprocess\.env\.([A-Z][A-Z0-9_]{1,63})\b|\bimport\.meta\.env\.([A-Z][A-Z0-9_]{1,63})\b/g;
const SOURCE_EXT = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const IGNORED_DIRS = new Set(["node_modules", ".git", ".devvault", "dist", "build", "coverage", ".next", "vendor"]);
const MAX_FILES = 2000;
const MAX_BYTES = 256 * 1024;

const DEPLOY_FILES = [
  { file: "Dockerfile", label: "Docker container build" },
  { file: "docker-compose.yml", label: "Docker Compose" },
  { file: "docker-compose.yaml", label: "Docker Compose" },
  { file: "render.yaml", label: "Render deployment config" },
  { file: "vercel.json", label: "Vercel deployment config" },
  { file: "netlify.toml", label: "Netlify deployment config" },
  { file: "Procfile", label: "Procfile (Heroku-style deployment)" },
  { file: "railway.json", label: "Railway deployment config" },
  { file: "fly.toml", label: "Fly.io deployment config" },
  { file: ".github/workflows", label: "GitHub Actions CI/CD", directory: true }
];

export function listSourceFiles(root) {
  const found = [];
  const pending = [{ dir: root, depth: 0 }];

  while (pending.length && found.length < MAX_FILES) {
    const { dir, depth } = pending.pop();
    let entries;

    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (depth < 12 && !entry.name.startsWith(".") && !IGNORED_DIRS.has(entry.name)) {
          pending.push({ dir: full, depth: depth + 1 });
        }
      } else if (
        entry.isFile() &&
        SOURCE_EXT.has(path.extname(entry.name)) &&
        !/\.(test|spec)\.[^.]+$/i.test(entry.name)
      ) {
        found.push(full);
      }
    }
  }

  return found;
}

function readSmall(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && stat.size <= MAX_BYTES ? fs.readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

export function extractPatternKnowledge(projectPath, project, sourceFiles = listSourceFiles(projectPath)) {
  const name = project.name || path.basename(projectPath);
  const hits = new Map(); // pattern id -> [{file, line}]
  const envVars = new Map(); // NAME -> Set(files)

  for (const absolute of sourceFiles) {
    const source = readSmall(absolute);
    if (!source) continue;

    const relative = path.relative(projectPath, absolute).split(path.sep).join("/");

    for (const pattern of PATTERNS) {
      const match = pattern.regex.exec(source);

      if (match) {
        if (!hits.has(pattern.id)) hits.set(pattern.id, []);
        hits.get(pattern.id).push({ file: relative, line: lineOf(source, match.index) });
      }
    }

    for (const match of source.matchAll(ENV_REFERENCE)) {
      const variable = match[1] || match[2];
      if (!envVars.has(variable)) envVars.set(variable, new Set());
      envVars.get(variable).add(relative);
    }
  }

  const findings = [];

  for (const pattern of PATTERNS) {
    const locations = hits.get(pattern.id);
    if (!locations?.length) continue;

    const shown = locations.slice(0, 8).map((loc) => `- ${loc.file}:${loc.line}`);
    const more = locations.length > 8 ? `\n- …and ${locations.length - 8} more files` : "";

    findings.push({
      title: `${name} — ${pattern.label}`,
      type: pattern.type,
      content: sanitizeSensitiveText(
        `${name} uses ${pattern.label} (${pattern.type}).\nDetected in ${locations.length} file(s):\n${shown.join("\n")}${more}`
      ),
      tags: [pattern.type, pattern.id],
      sourceFile: locations[0].file,
      sourceLine: locations[0].line,
      sourceType: `pattern-${pattern.id}`
    });
  }

  if (envVars.size) {
    const lines = [...envVars.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(0, 60)
      .map(([variable, files]) => `- ${variable} (used in ${[...files].slice(0, 3).join(", ")})`);

    findings.push({
      title: `${name} — environment variables`,
      type: "configuration",
      content: `${name} reads these environment variables (names only, values are never read):\n${lines.join("\n")}`,
      tags: ["configuration", "env"],
      sourceFile: "(multiple files)",
      sourceLine: 1,
      sourceType: "env-references"
    });
  }

  const deployments = DEPLOY_FILES.filter(({ file, directory }) => {
    try {
      const stat = fs.statSync(path.join(projectPath, file));
      return directory ? stat.isDirectory() : stat.isFile();
    } catch {
      return false;
    }
  });

  if (deployments.length) {
    findings.push({
      title: `${name} — deployment configuration`,
      type: "deployment",
      content: `${name} has deployment/CI configuration:\n${deployments.map((d) => `- ${d.label} (${d.file})`).join("\n")}`,
      tags: ["deployment", ...new Set(deployments.map((d) => d.file.split(".")[0].toLowerCase()))],
      sourceFile: deployments[0].file,
      sourceLine: 1,
      sourceType: "deployment-files"
    });
  }

  return findings;
}
