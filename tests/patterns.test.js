import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractPatternKnowledge } from "../src/analyzer/patternExtractor.js";

function makeProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dv-pattern-"));
  for (const [name, content] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

test("detects auth, database, env vars and deployment without leaking values", () => {
  const dir = makeProject({
    "src/auth.js": `import jwt from "jsonwebtoken";\nimport bcrypt from "bcryptjs";\nconst t = jwt.sign({}, process.env.JWT_SECRET);\nawait bcrypt.hash(pw, 10);`,
    "src/db.js": `mongoose.connect(process.env.MONGODB_URI);\nconst s = new Schema({});`,
    "render.yaml": "services: []",
    ".env": "JWT_SECRET=super-secret-value-123",
    "node_modules/x/index.js": `jwt.sign()`
  });

  const findings = extractPatternKnowledge(dir, { name: "Demo" });
  const titles = findings.map((f) => f.title);

  assert.ok(titles.includes("Demo — JWT authentication"));
  assert.ok(titles.includes("Demo — bcrypt password hashing"));
  assert.ok(titles.includes("Demo — MongoDB with Mongoose"));
  assert.ok(titles.includes("Demo — environment variables"));
  assert.ok(titles.includes("Demo — deployment configuration"));

  const env = findings.find((f) => f.type === "configuration");
  assert.match(env.content, /JWT_SECRET/);
  assert.match(env.content, /MONGODB_URI/);

  const everything = JSON.stringify(findings);
  assert.ok(!everything.includes("super-secret-value-123"));
  assert.ok(!everything.includes("node_modules"));

  fs.rmSync(dir, { recursive: true, force: true });
});

test("returns nothing for a project without recognizable patterns", () => {
  const dir = makeProject({ "index.js": "console.log('hi')" });
  assert.deepEqual(extractPatternKnowledge(dir, { name: "Empty" }), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
