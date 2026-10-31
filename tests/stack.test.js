import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fingerprintStack, extractStackKnowledge, canonicalDb } from "../src/analyzer/stackFingerprint.js";

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dv-stack-"));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}
const names = (fp) => fp.databases.map((d) => d.name);

test("Prisma: the database comes from schema.prisma, not just the package name (the FindIt/PostgreSQL case)", () => {
  const dir = project({
    "package.json": JSON.stringify({ dependencies: { "@prisma/client": "5", express: "4" } }),
    "prisma/schema.prisma": 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\nmodel User {\n  id Int @id\n  email String\n  @@index([email])\n}\nmodel Post {\n  id Int @id\n  title String\n}',
    "src/index.ts": "export {}"
  });
  const fp = fingerprintStack(dir);
  assert.deepEqual(names(fp), ["PostgreSQL"]);
  assert.match(fp.databases[0].evidence[0], /prisma\/schema\.prisma:2/);
  assert.deepEqual(fp.models.map((m) => m.name), ["User", "Post"]);
  assert.deepEqual(fp.models[0].fields, ["id", "email"], "block attributes (@@index) must not be listed as fields");
  assert.ok(fp.orms.includes("Prisma"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Prisma with MySQL/SQLite/MongoDB providers is reported correctly", () => {
  for (const [provider, expected] of [["mysql", "MySQL"], ["sqlite", "SQLite"], ["mongodb", "MongoDB"], ["sqlserver", "SQL Server"]]) {
    const dir = project({ "package.json": "{}", "prisma/schema.prisma": `datasource db {\n provider = "${provider}"\n url = env("X")\n}` });
    assert.deepEqual(names(fingerprintStack(dir)), [expected]);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Mongoose schemas give MongoDB plus per-model fields", () => {
  const dir = project({
    "package.json": JSON.stringify({ dependencies: { mongoose: "8" } }),
    "models/A.js": 'const a = new mongoose.Schema({ title: String, done: Boolean });\nconst b = new mongoose.Schema({ sku: String });\nmongoose.model("Todo", a);\nmongoose.model("Item", b);'
  });
  const fp = fingerprintStack(dir);
  assert.deepEqual(names(fp), ["MongoDB"]);
  assert.deepEqual(fp.models.map((m) => [m.name, m.fields.join(",")]), [["Todo", "title,done"], ["Item", "sku"]]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Sequelize dialect, Knex client, TypeORM type and Drizzle imports each identify their database", () => {
  const dir = project({
    "package.json": "{}",
    "a.js": 'new Sequelize("x", "u", "p", { dialect: "mysql" });',
    "b.js": 'module.exports = require("knex")({ client: "pg" });',
    "c.ts": 'import { DataSource } from "typeorm";\nexport default new DataSource({ type: "mariadb" });',
    "d.ts": 'import { pgTable } from "drizzle-orm/pg-core";'
  });
  assert.deepEqual(names(fingerprintStack(dir)).sort(), ["MariaDB", "MySQL", "PostgreSQL"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("connection URLs are reduced to their scheme: passwords never reach the output", () => {
  const dir = project({
    "package.json": "{}",
    "db.js": 'const url = "postgresql://admin:SuperSecret123@db.example.com:5432/app";',
    "docker-compose.yml": "services:\n  cache:\n    image: redis:7\n  db:\n    image: mongo:6",
    ".env.example": "MONGO_URL=mongodb+srv://u:TopSecretToken@cluster/x"
  });
  const { findings, fingerprint } = extractStackKnowledge(dir, { name: "p" });
  assert.deepEqual(names(fingerprint).sort(), ["MongoDB", "PostgreSQL", "Redis"]);
  const everything = JSON.stringify(findings);
  assert.ok(!everything.includes("SuperSecret123"));
  assert.ok(!everything.includes("TopSecretToken"));
  assert.ok(!everything.includes("db.example.com"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a real .env file is never read", () => {
  const dir = project({ "package.json": "{}", ".env": "DATABASE_URL=postgresql://u:p@h/db\nMONGO=mongodb://x" });
  assert.deepEqual(names(fingerprintStack(dir)), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("Python/Django, Java/Spring and Go manifests are understood", () => {
  const py = project({
    "requirements.txt": "Django==5.0\npsycopg2-binary==2.9\npymongo==4\n",
    "shop/settings.py": 'DATABASES = {"default": {"ENGINE": "django.db.backends.mysql"}}',
    "shop/models.py": "from django.db import models\nclass Product(models.Model):\n    title = models.CharField(max_length=10)\n    price = models.IntegerField()\n"
  });
  const fp = fingerprintStack(py);
  assert.deepEqual(names(fp).sort(), ["MongoDB", "MySQL", "PostgreSQL"]);
  assert.ok(fp.frameworks.includes("Django"));
  assert.deepEqual(fp.models.map((m) => [m.name, m.fields.join(",")]), [["Product", "title,price"]]);

  const java = project({
    "pom.xml": "<artifactId>spring-boot-starter-web</artifactId><artifactId>postgresql</artifactId>",
    "src/main/resources/application.properties": "spring.datasource.url=jdbc:postgresql://localhost/x"
  });
  assert.ok(fingerprintStack(java).frameworks.includes("Spring Boot"));
  assert.deepEqual(names(fingerprintStack(java)), ["PostgreSQL"]);

  const go = project({ "go.mod": "require (\n github.com/jackc/pgx/v5 v5\n github.com/gin-gonic/gin v1\n)" });
  const gofp = fingerprintStack(go);
  assert.deepEqual(names(gofp), ["PostgreSQL"]);
  assert.ok(gofp.frameworks.includes("Gin"));
  for (const d of [py, java, go]) fs.rmSync(d, { recursive: true, force: true });
});

test("extract output has a profile, one entry per database, and a data-model entry, all keyword-friendly", () => {
  const dir = project({
    "package.json": JSON.stringify({ name: "findit", dependencies: { "@prisma/client": "5" } }),
    "prisma/schema.prisma": 'datasource db {\n provider = "postgresql"\n}\nmodel User {\n id Int @id\n}'
  });
  const { findings } = extractStackKnowledge(dir, { name: "FindIt" });
  const byType = Object.fromEntries(findings.map((f) => [f.type, f]));
  assert.match(byType["project-profile"].content, /Databases: PostgreSQL \(via Prisma ORM\)/);
  assert.match(byType.database.title, /FindIt — uses PostgreSQL/);
  assert.match(byType.database.content, /prisma\/schema\.prisma:2/);
  assert.match(byType["data-model"].content, /User \[Prisma\]/);
  assert.ok(byType["project-profile"].tags.includes("postgresql"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("canonicalDb normalizes common spellings", () => {
  for (const [input, expected] of [["postgres", "PostgreSQL"], ["PG", "PostgreSQL"], ["mongodb+srv", "MongoDB"], ["mysql2", "MySQL"], ["better-sqlite3", "SQLite"], ["rediss", "Redis"]]) {
    assert.equal(canonicalDb(input), expected);
  }
  assert.equal(canonicalDb("unknown-db"), null);
});
