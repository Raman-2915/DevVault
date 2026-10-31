import fs from "node:fs";
import path from "node:path";
import { scanProject } from "./scanner.js";
import { listSourceFiles } from "./patternExtractor.js";
import { read, posix, findModels, findRoutes, topLevelKeys } from "./codeIntel.js";

// Works out a project's technology stack from CODE STRUCTURE, not only package names:
// Prisma/TypeORM/Sequelize/Knex/Drizzle configs, Mongoose schemas, connection-URL schemes, Docker images,
// Python/Java/Go manifests. Every finding carries evidence (file:line). Secrets are never read or stored:
// connection strings are reduced to their scheme (e.g. "postgresql") and env files are never opened.

// ---------- canonical names ----------
const DB_ALIASES = [
  [/^(postgres|postgresql|pg|pgsql|psycopg2?|asyncpg|pq)$/i, "PostgreSQL"],
  [/^(cockroach|cockroachdb)$/i, "CockroachDB"],
  [/^(mysql|mysql2|mysqli|pymysql|mysqlclient)$/i, "MySQL"],
  [/^(mariadb)$/i, "MariaDB"],
  [/^(sqlite|sqlite3|better-sqlite3|libsql|sqlite-sync)$/i, "SQLite"],
  [/^(mongo|mongodb|mongoose|mongodb\+srv|pymongo|motor|mongoengine|typegoose)$/i, "MongoDB"],
  [/^(redis|rediss|ioredis)$/i, "Redis"],
  [/^(mssql|sqlserver|tedious|sqlserver)$/i, "SQL Server"],
  [/^(oracle|oracledb)$/i, "Oracle"],
  [/^(dynamodb)$/i, "DynamoDB"],
  [/^(cassandra)$/i, "Cassandra"],
  [/^(neo4j)$/i, "Neo4j"],
  [/^(elasticsearch|elastic)$/i, "Elasticsearch"],
  [/^(firestore|firebase)$/i, "Firebase"],
  [/^(supabase)$/i, "Supabase (PostgreSQL)"]
];

export function canonicalDb(name) {
  const key = String(name).trim();
  for (const [pattern, label] of DB_ALIASES) if (pattern.test(key)) return label;
  return null;
}

// ---------- dependency rules (package.json) ----------
// [dependency name or prefix*, category, label, optional database]
const DEP_RULES = [
  // databases / drivers
  ["pg", "database", "pg driver", "PostgreSQL"], ["pg-promise", "database", "pg-promise", "PostgreSQL"], ["postgres", "database", "postgres.js", "PostgreSQL"],
  ["slonik", "database", "Slonik", "PostgreSQL"], ["@neondatabase/serverless", "database", "Neon", "PostgreSQL"], ["@vercel/postgres", "database", "Vercel Postgres", "PostgreSQL"],
  ["@supabase/supabase-js", "database", "Supabase client", "Supabase (PostgreSQL)"],
  ["mysql", "database", "mysql driver", "MySQL"], ["mysql2", "database", "mysql2 driver", "MySQL"], ["@planetscale/database", "database", "PlanetScale", "MySQL"], ["mariadb", "database", "mariadb driver", "MariaDB"],
  ["sqlite3", "database", "sqlite3", "SQLite"], ["better-sqlite3", "database", "better-sqlite3", "SQLite"], ["@libsql/client", "database", "libSQL", "SQLite"],
  ["mongodb", "database", "MongoDB driver", "MongoDB"], ["mongoose", "database", "Mongoose ODM", "MongoDB"], ["@typegoose/typegoose", "database", "Typegoose", "MongoDB"],
  ["redis", "database", "node-redis", "Redis"], ["ioredis", "database", "ioredis", "Redis"], ["@upstash/redis", "database", "Upstash Redis", "Redis"],
  ["firebase", "database", "Firebase SDK", "Firebase"], ["firebase-admin", "database", "Firebase Admin", "Firebase"],
  ["@aws-sdk/client-dynamodb", "database", "AWS SDK", "DynamoDB"], ["@aws-sdk/lib-dynamodb", "database", "AWS SDK", "DynamoDB"], ["dynamoose", "database", "Dynamoose", "DynamoDB"],
  ["cassandra-driver", "database", "cassandra-driver", "Cassandra"], ["neo4j-driver", "database", "neo4j-driver", "Neo4j"], ["@elastic/elasticsearch", "database", "Elasticsearch client", "Elasticsearch"],
  ["mssql", "database", "mssql driver", "SQL Server"], ["tedious", "database", "tedious", "SQL Server"], ["oracledb", "database", "oracledb", "Oracle"],
  // ORMs / query builders
  ["@prisma/client", "orm", "Prisma"], ["prisma", "orm", "Prisma"], ["typeorm", "orm", "TypeORM"], ["sequelize", "orm", "Sequelize"], ["knex", "orm", "Knex"],
  ["drizzle-orm", "orm", "Drizzle ORM"], ["@mikro-orm/core", "orm", "MikroORM"], ["objection", "orm", "Objection.js"], ["kysely", "orm", "Kysely"], ["mongoose", "orm", "Mongoose"],
  // vector DBs
  ["chromadb", "database", "Chroma", "Chroma (vector DB)"], ["@pinecone-database/pinecone", "database", "Pinecone", "Pinecone (vector DB)"], ["@qdrant/js-client-rest", "database", "Qdrant", "Qdrant (vector DB)"],
  // frameworks
  ["express", "framework", "Express"], ["fastify", "framework", "Fastify"], ["koa", "framework", "Koa"], ["@hapi/hapi", "framework", "Hapi"], ["@nestjs/core", "framework", "NestJS"], ["hono", "framework", "Hono"],
  ["next", "framework", "Next.js"], ["nuxt", "framework", "Nuxt"], ["react", "framework", "React"], ["vue", "framework", "Vue"], ["@angular/core", "framework", "Angular"], ["svelte", "framework", "Svelte"],
  ["@sveltejs/kit", "framework", "SvelteKit"], ["solid-js", "framework", "SolidJS"], ["astro", "framework", "Astro"], ["gatsby", "framework", "Gatsby"], ["@remix-run/react", "framework", "Remix"],
  ["vite", "tooling", "Vite"], ["webpack", "tooling", "Webpack"], ["tailwindcss", "framework", "Tailwind CSS"], ["bootstrap", "framework", "Bootstrap"], ["@mui/material", "framework", "Material UI"],
  ["electron", "framework", "Electron"], ["react-native", "framework", "React Native"], ["expo", "framework", "Expo"], ["socket.io", "framework", "Socket.IO"], ["ws", "framework", "WebSockets (ws)"],
  ["graphql", "framework", "GraphQL"], ["@apollo/server", "framework", "Apollo Server"], ["apollo-server", "framework", "Apollo Server"], ["@trpc/server", "framework", "tRPC"],
  ["yargs", "cli", "Yargs CLI"], ["commander", "cli", "Commander CLI"],
  // auth
  ["jsonwebtoken", "auth", "JWT (jsonwebtoken)"], ["jose", "auth", "JWT (jose)"], ["bcrypt", "auth", "bcrypt password hashing"], ["bcryptjs", "auth", "bcrypt password hashing"], ["argon2", "auth", "Argon2 password hashing"],
  ["passport", "auth", "Passport.js"], ["next-auth", "auth", "NextAuth / Auth.js"], ["@auth/core", "auth", "Auth.js"], ["express-session", "auth", "Express sessions"], ["cookie-session", "auth", "Cookie sessions"],
  ["@clerk/clerk-sdk-node", "auth", "Clerk"], ["lucia", "auth", "Lucia auth"], ["google-auth-library", "auth", "Google OAuth"],
  // AI
  ["openai", "ai", "OpenAI API"], ["@anthropic-ai/sdk", "ai", "Anthropic Claude API"], ["@google/generative-ai", "ai", "Google Gemini API"], ["@google/genai", "ai", "Google Gemini API"],
  ["groq-sdk", "ai", "Groq API"], ["langchain", "ai", "LangChain"], ["@langchain/core", "ai", "LangChain"], ["ollama", "ai", "Ollama"], ["ai", "ai", "Vercel AI SDK"], ["@huggingface/inference", "ai", "Hugging Face"],
  // testing
  ["jest", "testing", "Jest"], ["vitest", "testing", "Vitest"], ["mocha", "testing", "Mocha"], ["supertest", "testing", "Supertest"], ["@playwright/test", "testing", "Playwright"], ["cypress", "testing", "Cypress"],
  // integrations
  ["stripe", "integration", "Stripe payments"], ["razorpay", "integration", "Razorpay payments"], ["cloudinary", "integration", "Cloudinary media"], ["multer", "integration", "File uploads (multer)"],
  ["nodemailer", "integration", "Email (nodemailer)"], ["@sendgrid/mail", "integration", "SendGrid email"], ["bullmq", "integration", "BullMQ queues"], ["bull", "integration", "Bull queues"],
  ["amqplib", "integration", "RabbitMQ"], ["kafkajs", "integration", "Kafka"], ["axios", "integration", "Axios HTTP client"]
];

const PY_RULES = [
  ["django", "framework", "Django"], ["django", "orm", "Django ORM"], ["flask", "framework", "Flask"], ["fastapi", "framework", "FastAPI"], ["tornado", "framework", "Tornado"], ["streamlit", "framework", "Streamlit"],
  ["psycopg2", "database", "psycopg2", "PostgreSQL"], ["psycopg2-binary", "database", "psycopg2", "PostgreSQL"], ["psycopg", "database", "psycopg", "PostgreSQL"], ["asyncpg", "database", "asyncpg", "PostgreSQL"],
  ["pymysql", "database", "PyMySQL", "MySQL"], ["mysqlclient", "database", "mysqlclient", "MySQL"], ["pymongo", "database", "PyMongo", "MongoDB"], ["motor", "database", "Motor", "MongoDB"], ["mongoengine", "database", "MongoEngine", "MongoDB"],
  ["redis", "database", "redis-py", "Redis"], ["sqlalchemy", "orm", "SQLAlchemy"], ["tortoise-orm", "orm", "Tortoise ORM"], ["peewee", "orm", "Peewee"],
  ["celery", "integration", "Celery tasks"], ["pytest", "testing", "pytest"], ["numpy", "ml", "NumPy"], ["pandas", "ml", "pandas"], ["scikit-learn", "ml", "scikit-learn"],
  ["tensorflow", "ml", "TensorFlow"], ["torch", "ml", "PyTorch"], ["openai", "ai", "OpenAI API"], ["langchain", "ai", "LangChain"], ["pyjwt", "auth", "JWT (PyJWT)"], ["bcrypt", "auth", "bcrypt password hashing"]
];

const JAVA_RULES = [
  [/spring-boot-starter-web/i, "framework", "Spring Boot"], [/spring-boot-starter-data-jpa/i, "orm", "Spring Data JPA"], [/spring-boot-starter-security/i, "auth", "Spring Security"],
  [/postgresql/i, "database", "PostgreSQL JDBC driver", "PostgreSQL"], [/mysql-connector/i, "database", "MySQL connector", "MySQL"], [/mongodb-driver|spring-boot-starter-data-mongodb/i, "database", "MongoDB driver", "MongoDB"],
  [/h2database|<artifactId>h2</i, "database", "H2", "H2 (in-memory)"], [/jjwt|java-jwt/i, "auth", "JWT"], [/hibernate/i, "orm", "Hibernate"], [/junit/i, "testing", "JUnit"]
];

const GO_RULES = [
  [/github\.com\/lib\/pq|jackc\/pgx/, "database", "pgx/pq driver", "PostgreSQL"], [/go-sql-driver\/mysql/, "database", "MySQL driver", "MySQL"], [/mongo-driver/, "database", "MongoDB driver", "MongoDB"],
  [/go-redis/, "database", "go-redis", "Redis"], [/gorm\.io\/gorm/, "orm", "GORM"], [/gin-gonic\/gin/, "framework", "Gin"], [/labstack\/echo/, "framework", "Echo"], [/gofiber\/fiber/, "framework", "Fiber"], [/golang-jwt/, "auth", "JWT"]
];

const LANGUAGE_BY_EXT = {
  ".js": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript", ".jsx": "JavaScript (React JSX)", ".ts": "TypeScript", ".tsx": "TypeScript (React TSX)",
  ".py": "Python", ".java": "Java", ".kt": "Kotlin", ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".php": "PHP", ".cs": "C#", ".cpp": "C++", ".c": "C", ".swift": "Swift", ".dart": "Dart",
  ".html": "HTML", ".css": "CSS", ".scss": "SCSS", ".vue": "Vue SFC", ".svelte": "Svelte", ".sql": "SQL", ".prisma": "Prisma schema"
};

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

function addTo(map, key, patch) {
  const entry = map.get(key) || { name: key, via: new Set(), evidence: [] };
  if (patch.via) entry.via.add(patch.via);
  if (patch.evidence && entry.evidence.length < 4 && !entry.evidence.includes(patch.evidence)) entry.evidence.push(patch.evidence);
  map.set(key, entry);
}

function parseRequirements(root) {
  const names = new Set();
  for (const file of ["requirements.txt", "requirements-dev.txt", "Pipfile", "pyproject.toml", "setup.py", "environment.yml"]) {
    const text = read(path.join(root, file));
    for (const m of text.matchAll(/^\s*["']?([A-Za-z0-9_.-]+)\s*(?:[=<>!~;\[\]"',]|$)/gm)) names.add(m[1].toLowerCase());
    for (const m of text.matchAll(/["']([A-Za-z0-9_.-]+)\s*(?:[=<>!~]|["'])/g)) names.add(m[1].toLowerCase());
  }
  return names;
}

// ---------- Prisma ----------
function parsePrisma(root, files, databases, models, orms) {
  for (const rel of files.filter((f) => f.endsWith(".prisma")).slice(0, 5)) {
    const text = read(path.join(root, rel));
    if (!text) continue;

    const provider = /datasource\s+\w+\s*\{[^}]*?provider\s*=\s*["'](\w+)["']/s.exec(text);
    if (provider) {
      const db = canonicalDb(provider[1]);
      const index = text.indexOf(provider[0]);
      if (db) addTo(databases, db, { via: "Prisma ORM", evidence: `${rel}:${lineOf(text, index + provider[0].lastIndexOf("provider"))} (datasource provider "${provider[1]}")` });
    }
    orms.add("Prisma");

    for (const m of text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
      const fields = m[2].split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("@@") && !l.startsWith("//"))
        .map((l) => l.split(/\s+/)[0]);
      models.push({ name: m[1], file: rel, source: "Prisma", fields: fields.slice(0, 14) });
    }
  }
}

// ---------- code scanning (JS/TS) ----------
function scanCode(root, sourceFiles, databases, orms, flags) {
  const CONFIGS = [
    [/dialect:\s*["'`](postgres|postgresql|mysql|mariadb|sqlite|mssql|oracle)["'`]/g, "Sequelize", "dialect"],
    [/client:\s*["'`](pg|postgresql|mysql2?|sqlite3|better-sqlite3|mssql|oracledb)["'`]/g, "Knex", "client"],
    [/drizzle-orm\/(pg-core|mysql-core|sqlite-core|node-postgres|postgres-js|neon-http|neon-serverless|vercel-postgres|mysql2|better-sqlite3|libsql|planetscale-serverless)/g, "Drizzle ORM", "import"]
  ];
  const DRIZZLE_MAP = { "pg-core": "postgresql", "node-postgres": "postgresql", "postgres-js": "postgresql", "neon-http": "postgresql", "neon-serverless": "postgresql", "vercel-postgres": "postgresql", "mysql-core": "mysql", "mysql2": "mysql", "planetscale-serverless": "mysql", "sqlite-core": "sqlite", "better-sqlite3": "sqlite", "libsql": "sqlite" };
  const SCHEME = /\b(postgres(?:ql)?|mongodb(?:\+srv)?|mysql|rediss?|mssql|sqlserver):\/\/(?![^\s"'`]*\$\{)/g;

  for (const absolute of sourceFiles) {
    const text = read(absolute);
    if (!text) continue;
    const rel = posix(path.relative(root, absolute));

    for (const [regex, orm, kind] of CONFIGS) {
      for (const m of text.matchAll(regex)) {
        const value = kind === "import" ? DRIZZLE_MAP[m[1]] : m[1];
        const db = canonicalDb(value);
        if (db) addTo(databases, db, { via: `${orm}`, evidence: `${rel}:${lineOf(text, m.index)} (${orm} ${kind} "${m[1]}")` });
        orms.add(orm);
      }
    }

    if (/DataSource|createConnection|TypeOrmModule|@Entity\(/.test(text)) {
      for (const m of text.matchAll(/\btype:\s*["'`](postgres|mysql|mariadb|sqlite|better-sqlite3|mongodb|mssql|oracle|cockroachdb)["'`]/g)) {
        const db = canonicalDb(m[1] === "better-sqlite3" ? "sqlite" : m[1]);
        if (db) addTo(databases, db, { via: "TypeORM", evidence: `${rel}:${lineOf(text, m.index)} (TypeORM type "${m[1]}")` });
        orms.add("TypeORM");
      }
    }

    if (/new\s+(?:mongoose\.)?Schema\(|mongoose\.connect\(/.test(text)) {
      const at = text.search(/mongoose\.connect\(|new\s+(?:mongoose\.)?Schema\(/);
      addTo(databases, "MongoDB", { via: "Mongoose ODM", evidence: `${rel}:${lineOf(text, at)} (Mongoose ${/mongoose\.connect\(/.test(text) ? "connection" : "schema"})` });
      orms.add("Mongoose");
    }

    if (/\bnew\s+MongoClient\b/.test(text)) addTo(databases, "MongoDB", { via: "MongoDB driver", evidence: `${rel}:${lineOf(text, text.search(/new\s+MongoClient/))} (MongoClient)` });
    if (/\bnew\s+(?:Pool|Client)\b[\s\S]{0,200}?(?:host|connectionString)/.test(text) && /require\(["']pg["']\)|from ["']pg["']/.test(text)) {
      addTo(databases, "PostgreSQL", { via: "pg driver", evidence: `${rel}:${lineOf(text, text.search(/new\s+(?:Pool|Client)/))} (pg Pool/Client)` });
    }

    // Connection-URL SCHEMES only (never the string itself, which may hold credentials).
    for (const m of text.matchAll(SCHEME)) {
      const db = canonicalDb(m[1]);
      if (db) addTo(databases, db, { via: "connection URL", evidence: `${rel}:${lineOf(text, m.index)} (${m[1]}:// connection URL)` });
    }

    if (/@Entity\(/.test(text)) {
      for (const m of text.matchAll(/@Entity\([^)]*\)\s*(?:export\s+)?class\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) {
        const fields = [...m[2].matchAll(/@(?:PrimaryGeneratedColumn|PrimaryColumn|Column|ObjectIdColumn|ManyToOne|OneToMany|OneToOne|ManyToMany)\([^)]*\)\s*(?:readonly\s+)?(\w+)/g)].map((f) => f[1]);
        flags.typeormModels.push({ name: m[1], file: rel, source: "TypeORM", fields: fields.slice(0, 14) });
      }
    }
  }
}

function scanInfraFiles(root, files, databases) {
  for (const rel of files.filter((f) => /(^|\/)(docker-compose[^/]*\.ya?ml|compose\.ya?ml)$/i.test(f)).slice(0, 4)) {
    const text = read(path.join(root, rel));
    for (const m of text.matchAll(/image:\s*["']?(?:library\/)?(postgres|mysql|mariadb|mongo|redis|mssql|cassandra|neo4j|elasticsearch)\b[^\s"']*/gi)) {
      const db = canonicalDb(m[1]);
      if (db) addTo(databases, db, { via: "Docker image", evidence: `${rel}:${lineOf(text, m.index)} (image ${m[0].replace(/image:\s*["']?/i, "").trim()})` });
    }
  }

  // Template env files only (never .env). Keep just the connection SCHEME and the variable NAME.
  const templates = ["", "backend/", "server/", "api/"].flatMap((dir) => [".env.example", ".env.sample", ".env.template"].map((n) => `${dir}${n}`)).filter((rel) => fs.existsSync(path.join(root, rel)));
  for (const rel of templates.slice(0, 4)) {
    const text = read(path.join(root, rel));
    for (const m of text.matchAll(/^([A-Z0-9_]*(?:DATABASE|DB|MONGO|POSTGRES|MYSQL|REDIS)[A-Z0-9_]*)\s*=\s*["']?(postgres(?:ql)?|mongodb(?:\+srv)?|mysql|rediss?):\/\//gim)) {
      const db = canonicalDb(m[2]);
      if (db) addTo(databases, db, { via: `${m[1]} variable`, evidence: `${rel}:${lineOf(text, m.index)} (${m[1]} uses ${m[2]}://)` });
    }
  }
}

// ---------- Python / Java / Go ----------
function scanOtherLanguages(root, files, add, databases, models) {
  const py = parseRequirements(root);
  for (const [dep, cat, label, db] of PY_RULES) if (py.has(dep)) add(cat, label, `requirements: ${dep}`, db);

  const djangoSettings = files.find((f) => /(^|\/)settings(\/[^/]+)?\.py$/.test(f));
  if (djangoSettings) {
    const text = read(path.join(root, djangoSettings));
    const m = /["']ENGINE["']\s*:\s*["']django\.db\.backends\.(\w+)["']/.exec(text);
    if (m) addTo(databases, canonicalDb(m[1]) || m[1], { via: "Django ORM", evidence: `${djangoSettings}:${lineOf(text, m.index)} (DATABASES ENGINE ${m[1]})` });
  }

  for (const rel of files.filter((f) => f.endsWith(".py")).slice(0, 400)) {
    const text = read(path.join(root, rel), 120_000);
    if (!text) continue;
    for (const m of text.matchAll(/^class\s+(\w+)\((?:[\w.]*models\.Model|[\w.]*Base|db\.Model|SQLModel|Document)[^)]*\):\n((?:[ \t]+.*\n?)+)/gm)) {
      const fields = [...m[2].matchAll(/^[ \t]+(\w+)\s*(?::[^=\n]+)?=\s*(?:models\.|Column|db\.Column|mapped_column|Field|\w+Field)/gm)].map((f) => f[1]);
      models.push({ name: m[1], file: rel, source: /models\.Model/.test(m[0]) ? "Django" : "SQLAlchemy/ORM", fields: fields.slice(0, 14) });
    }
    for (const m of text.matchAll(/\b(postgres(?:ql)?(?:\+\w+)?|mysql(?:\+\w+)?|sqlite|mongodb(?:\+srv)?):\/\/(?![^\s"']*\{)/g)) {
      const db = canonicalDb(m[1].split("+")[0]);
      if (db) addTo(databases, db, { via: "connection URL", evidence: `${rel}:${lineOf(text, m.index)} (${m[1]}:// URL)` });
    }
  }

  const build = [read(path.join(root, "pom.xml")), read(path.join(root, "build.gradle")), read(path.join(root, "build.gradle.kts"))].join("\n");
  if (build.trim()) for (const [pattern, cat, label, db] of JAVA_RULES) if (pattern.test(build)) add(cat, label, "pom.xml / build.gradle", db);

  for (const rel of files.filter((f) => /application[^/]*\.(properties|ya?ml)$/.test(f)).slice(0, 3)) {
    const text = read(path.join(root, rel));
    const m = /jdbc:(postgresql|mysql|mariadb|sqlserver|oracle|h2):/.exec(text);
    if (m) addTo(databases, canonicalDb(m[1]) || m[1].toUpperCase(), { via: "Spring datasource", evidence: `${rel}:${lineOf(text, m.index)} (jdbc:${m[1]})` });
  }

  for (const rel of files.filter((f) => f.endsWith(".java")).slice(0, 300)) {
    const text = read(path.join(root, rel), 100_000);
    const m = /@Entity[\s\S]{0,200}?class\s+(\w+)\s*\{([\s\S]*?)\n\}/.exec(text);
    if (m) models.push({ name: m[1], file: rel, source: "JPA", fields: [...m[2].matchAll(/private\s+[\w<>\[\], ?]+\s+(\w+);/g)].map((f) => f[1]).slice(0, 14) });
  }

  const goMod = read(path.join(root, "go.mod"));
  if (goMod) for (const [pattern, cat, label, db] of GO_RULES) if (pattern.test(goMod)) add(cat, label, "go.mod", db);
}

// ---------- main ----------
export function fingerprintStack(projectPath, { sourceFiles = listSourceFiles(projectPath), scan = null } = {}) {
  const root = path.resolve(projectPath);
  const projectScan = scan || scanProject(root);
  const files = projectScan.files.map(posix);

  const databases = new Map();
  const found = { framework: new Map(), orm: new Map(), auth: new Map(), ai: new Map(), testing: new Map(), integration: new Map(), cli: new Map(), tooling: new Map(), ml: new Map() };
  const orms = new Set();
  const flags = { typeormModels: [] };

  const add = (category, label, evidence, db) => {
    if (category === "database") {
      if (db) addTo(databases, db, { via: label, evidence });
      return;
    }
    if (category === "orm") orms.add(label);
    const bucket = found[category];
    if (!bucket) return;
    const entry = bucket.get(label) || { name: label, evidence };
    bucket.set(label, entry);
  };

  // package.json (root and one level of workspaces)
  const pkgFiles = files.filter((f) => /(^|\/)package\.json$/.test(f) && f.split("/").length <= 3).slice(0, 8);
  const isTs = files.some((f) => /\.tsx?$/.test(f));

  for (const rel of pkgFiles) {
    let pkg;
    try { pkg = JSON.parse(read(path.join(root, rel))); } catch { continue; }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
    for (const [dep, cat, label, db] of DEP_RULES) if (deps[dep] !== undefined) add(cat, label, `${rel}: ${dep}`, db);
  }

  scanOtherLanguages(root, files, add, databases, flags.typeormModels);
  parsePrisma(root, files, databases, flags.typeormModels, orms);
  scanCode(root, sourceFiles, databases, orms, flags);
  scanInfraFiles(root, files, databases);

  // Code-defined models (Mongoose, Sequelize ...) + schema-defined ones (Prisma, TypeORM, Django, JPA).
  const seen = new Set();
  const models = [...findModels(root, sourceFiles).map((m) => ({ ...m, source: m.source || "Mongoose/Sequelize" })), ...flags.typeormModels]
    .filter((m) => (seen.has(m.name) ? false : seen.add(m.name)));

  const routes = findRoutes(root, sourceFiles);
  const languageCounts = new Map();
  for (const file of files) {
    const language = LANGUAGE_BY_EXT[path.extname(file).toLowerCase()];
    if (language) languageCounts.set(language, (languageCounts.get(language) || 0) + 1);
  }

  const languages = [...languageCounts.entries()]
    .filter(([name]) => !["HTML", "CSS", "SCSS", "SQL", "Prisma schema"].includes(name) || languageCounts.size < 3)
    .map(([name, fileCount]) => ({ name, fileCount }))
    .sort((a, b) => b.fileCount - a.fileCount)
    .slice(0, 6);

  const toList = (map) => [...map.values()].map((e) => e.name);
  const dbList = [...databases.values()].map((d) => ({ name: d.name, via: [...d.via], evidence: d.evidence }));

  const apiStyles = [
    routes.length && "REST",
    found.framework.has("GraphQL") || found.framework.has("Apollo Server") ? "GraphQL" : null,
    found.framework.has("tRPC") ? "tRPC" : null,
    found.framework.has("Socket.IO") || found.framework.has("WebSockets (ws)") ? "WebSockets" : null
  ].filter(Boolean);

  return {
    languages,
    typescript: isTs,
    frameworks: toList(found.framework).concat(toList(found.cli)),
    orms: [...new Set([...orms])],
    databases: dbList,
    models,
    auth: toList(found.auth),
    ai: toList(found.ai),
    testing: toList(found.testing),
    integrations: toList(found.integration),
    tooling: toList(found.tooling),
    ml: toList(found.ml),
    api: { styles: apiStyles, routeCount: routes.length },
    routes
  };
}

// ---------- human/AI-readable knowledge entries ----------
const list = (items) => (items.length ? items.join(", ") : "none detected");

export function profileSummary(name, fp) {
  const dbText = fp.databases.length
    ? fp.databases.map((d) => `${d.name}${d.via.length ? ` (via ${d.via.slice(0, 2).join(" / ")})` : ""}`).join("; ")
    : "none detected";
  const modelText = fp.models.length
    ? fp.models.slice(0, 12).map((m) => `${m.name}${m.fields.length ? `(${m.fields.slice(0, 6).join(", ")})` : ""}`).join("; ")
    : "none detected";

  return [
    `${name} — technology profile.`,
    `Languages: ${fp.languages.length ? fp.languages.map((l) => `${l.name} (${l.fileCount} files)`).join(", ") : "none detected"}`,
    `Frameworks and libraries: ${list(fp.frameworks)}`,
    `Databases: ${dbText}`,
    `ORM / ODM: ${list(fp.orms)}`,
    `Data models (${fp.models.length}): ${modelText}`,
    `Authentication: ${list(fp.auth)}`,
    `API: ${fp.api.styles.length ? fp.api.styles.join(", ") : "none detected"}${fp.api.routeCount ? `, ${fp.api.routeCount} ${fp.api.routeCount === 1 ? "endpoint" : "endpoints"}` : ""}`,
    fp.ai.length ? `AI integrations: ${list(fp.ai)}` : null,
    fp.integrations.length ? `Integrations: ${list(fp.integrations)}` : null,
    fp.testing.length ? `Testing: ${list(fp.testing)}` : null
  ].filter(Boolean).join("\n");
}

export function extractStackKnowledge(projectPath, project, options = {}) {
  const name = project.name || path.basename(projectPath);
  const fp = fingerprintStack(projectPath, options);
  const findings = [];

  findings.push({
    title: `${name} — technology profile`,
    type: "project-profile",
    content: profileSummary(name, fp),
    tags: ["profile", "stack", ...fp.databases.map((d) => d.name.toLowerCase()), ...fp.frameworks.slice(0, 5).map((f) => f.toLowerCase())],
    sourceFile: "(project)",
    sourceLine: 1,
    sourceType: "stack-profile"
  });

  for (const db of fp.databases) {
    const modelsHere = fp.models.slice(0, 20).map((m) => m.name);
    findings.push({
      title: `${name} — uses ${db.name} (database)`,
      type: "database",
      content:
        `${name} uses the ${db.name} database.\n` +
        `Accessed through: ${db.via.length ? db.via.join(", ") : "direct connection"}.\n` +
        `Evidence:\n${db.evidence.map((e) => `- ${e}`).join("\n")}` +
        (modelsHere.length ? `\nData models in this project: ${modelsHere.join(", ")}.` : "") +
        (fp.orms.length ? `\nORM/ODM used: ${fp.orms.join(", ")}.` : ""),
      tags: ["database", db.name.toLowerCase(), ...db.via.map((v) => v.toLowerCase())],
      sourceFile: db.evidence[0]?.split(":")[0] || "(project)",
      sourceLine: Number(/:(\d+)/.exec(db.evidence[0] || "")?.[1]) || 1,
      sourceType: `database-${db.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
    });
  }

  if (fp.models.length) {
    findings.push({
      title: `${name} — data models and schemas`,
      type: "data-model",
      content:
        `${name} defines ${fp.models.length} data model(s):\n` +
        fp.models.slice(0, 40).map((m) => `- ${m.name} [${m.source}] (${m.file}): ${m.fields.length ? m.fields.join(", ") : "fields not detected"}`).join("\n"),
      tags: ["data-model", "schema", ...fp.orms.map((o) => o.toLowerCase())],
      sourceFile: fp.models[0].file,
      sourceLine: 1,
      sourceType: "data-models"
    });
  }

  return { findings, fingerprint: fp };
}
