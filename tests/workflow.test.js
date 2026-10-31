import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { quoteArg, buildCommandLine } from "../src/cli/commands/run.js";
import { makeTitle } from "../src/cli/commands/note.js";
import { errorSignature, rankEntries } from "../src/search/localRank.js";

const cliPath = fileURLToPath(new URL("../src/index.js", import.meta.url));
let home;
let projA;
let projB;

function makeProject(name, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dv-${name}-`));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", ...extra }));
  return dir;
}

// Runs the real CLI with an isolated HOME so the *global vault* logic is exercised end to end.
function cli(args, cwd) {
  return new Promise((resolve) => {
    const env = { ...process.env, HOME: home, USERPROFILE: home, DEVVAULT_HOME: path.join(home, "cfg"), DEVVAULT_ALLOW_ANONYMOUS: "1" };
    delete env.DEVVAULT_VAULT_DIR;
    const child = spawn(process.execPath, [cliPath, ...args], { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });
}

const vault = (file) => JSON.parse(fs.readFileSync(path.join(home, ".devvault", file), "utf8"));

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "dv-home-"));
  projA = makeProject("shop-api");
  projB = makeProject("blog-app");
});

afterEach(() => {
  for (const dir of [home, projA, projB]) fs.rmSync(dir, { recursive: true, force: true });
});

test("commands refuse to run before init and say how to fix it", async () => {
  const result = await cli(["note", "hello"], projA);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /devvault init/);
});

test("init is once per user: it creates ~/.devvault, and a second init anywhere just reports it", async () => {
  const first = await cli(["init"], projA);
  assert.equal(first.code, 0, first.stderr);
  assert.ok(fs.existsSync(path.join(home, ".devvault", "config.json")));
  assert.ok(!fs.existsSync(path.join(projA, ".devvault")), "must not create a per-project vault");

  const second = await cli(["init"], projB);
  assert.match(second.stdout, /already set up/);
  assert.ok(!fs.existsSync(path.join(projB, ".devvault")));
});

test("notes attach to the project of the folder you are in, one shared vault for all projects", async () => {
  await cli(["init"], projA);
  await cli(["note", "Use Atlas 0.0.0.0/0 for Render", "--tags", "atlas,render", "--type", "tip"], projA);
  await cli(["note", "Paginate with limit+skip"], projB);

  const knowledge = vault("knowledge.json");
  assert.equal(knowledge.length, 2);
  const a = knowledge.find((e) => e.title.includes("Atlas"));
  assert.equal(a.project, "shop-api");
  assert.equal(a.type, "tip");
  assert.deepEqual(a.tags, ["atlas", "render"]);
  assert.equal(knowledge.find((e) => e.title.includes("Paginate")).project, "blog-app");

  assert.deepEqual(vault("projects.json").map((p) => p.name).sort(), ["blog-app", "shop-api"]);

  const here = await cli(["notes"], projA);
  assert.match(here.stdout, /Atlas/);
  assert.ok(!here.stdout.includes("Paginate"));
  const all = await cli(["notes", "--all"], projA);
  assert.match(all.stdout, /Atlas/);
  assert.match(all.stdout, /Paginate/);
});

test("a note saved outside any project is stored as a general note, and secrets are redacted", async () => {
  await cli(["init"], projA);
  const loose = fs.mkdtempSync(path.join(home, "loose-"));
  const result = await cli(["note", "api key is password=hunter2 ok"], loose);
  fs.rmSync(loose, { recursive: true, force: true });
  assert.equal(result.code, 0, result.stderr);
  const entry = vault("knowledge.json")[0];
  assert.equal(entry.project, null);
  assert.ok(!entry.content.includes("hunter2"));
});

test("stuck in project B: `fix` and `run` surface the solution you saved in project A", async () => {
  await cli(["init"], projA);
  await cli(["capture-error", "-m", "MongooseServerSelectionError: connection timed out, Atlas cluster unreachable", "--solution", "Allow-list 0.0.0.0/0 in Atlas Network Access", "--yes"], projA);

  const fix = await cli(["fix", "MongooseServerSelectionError: connection timed out"], projB);
  assert.match(fix.stdout, /Solution: Allow-list 0\.0\.0\.0\/0/);
  assert.match(fix.stdout, /shop-api/);

  const none = await cli(["fix", "TypeError: Cannot read properties of undefined (reading 'map')"], projB);
  assert.match(none.stdout, /No similar past errors/);

  const run = await cli(["run", "--", process.execPath, "-e", "console.error('MongooseServerSelectionError: connection timed out, Atlas'); process.exit(3)"], projB);
  assert.equal(run.code, 3, "exit code of the wrapped command must be preserved");
  assert.match(run.stdout, /You may have solved this before/);
  assert.match(run.stdout, /Allow-list 0\.0\.0\.0\/0/);

  const ok = await cli(["run", "--", process.execPath, "-e", "console.log('fine')"], projB);
  assert.equal(ok.code, 0);
  assert.match(ok.stdout, /fine/);
  assert.ok(!ok.stdout.includes("solved this before"));
});

test("capture-error --last saves the failed run's error under the current project", async () => {
  await cli(["init"], projA);
  await cli(["run", "--", process.execPath, "-e", "console.error('ECONNREFUSED 127.0.0.1:27017 mongod not running'); process.exit(1)"], projB);

  const saved = await cli(["capture-error", "--last", "--solution", "Started mongod", "--yes"], projB);
  assert.equal(saved.code, 0, saved.stderr);

  const entry = vault("knowledge.json").find((e) => e.type === "debug-incident");
  assert.equal(entry.project, "blog-app");
  assert.match(entry.content, /Solution: Started mongod/);
  assert.match(entry.debug.error, /ECONNREFUSED/);
});

test("explain describes a project in plain English, resolving route prefixes and per-model fields", async () => {
  const dir = makeProject("demo-shop", { description: "A tiny shop API", main: "server.js", scripts: { start: "node server.js", test: "node --test" }, dependencies: { express: "4", mongoose: "8", jsonwebtoken: "9", bcryptjs: "2" } });
  fs.mkdirSync(path.join(dir, "routes"));
  fs.mkdirSync(path.join(dir, "models"));
  fs.writeFileSync(path.join(dir, "server.js"), `const express = require("express");\nconst orders = require("./routes/orders");\nconst app = express();\napp.use("/api/orders", orders);\napp.listen(process.env.PORT);`);
  fs.writeFileSync(path.join(dir, "routes", "orders.js"), `const router = require("express").Router();\nrouter.get("/", (q, r) => r.json([]));\nrouter.post("/:id/pay", (q, r) => r.end());\nmodule.exports = router;`);
  fs.writeFileSync(path.join(dir, "models", "all.js"), `const a = new mongoose.Schema({ customer: String, total: Number });\nconst b = new mongoose.Schema({ sku: String, price: Number });\nmongoose.model("Order", a);\nmongoose.model("Product", b);\njwt.sign({}, process.env.JWT_SECRET);`);

  await cli(["init"], projA);
  const out = path.join(home, "overview.md");
  const result = await cli(["explain", dir, "--out", out, "--save"], projA);
  fs.rmSync(dir, { recursive: true, force: true });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /A tiny shop API/);
  assert.match(result.stdout, /web server \/ API/);
  assert.match(result.stdout, /`GET \/api\/orders`/);
  assert.match(result.stdout, /`POST \/api\/orders\/:id\/pay`/);
  assert.match(result.stdout, /\*\*Order\*\*: customer, total/);
  assert.match(result.stdout, /\*\*Product\*\*: sku, price/);
  assert.match(result.stdout, /signed token \(JWT\)/);
  assert.match(result.stdout, /`JWT_SECRET`/);
  assert.match(result.stdout, /flowchart LR/);
  assert.match(fs.readFileSync(out, "utf8"), /## How it works/);

  await cli(["explain", dir, "--save"], projA).catch(() => {});
  const overviews = vault("knowledge.json").filter((e) => e.type === "project-overview");
  assert.equal(overviews.length, 1, "re-running --save must replace, not duplicate");
  assert.equal(overviews[0].project, "demo-shop");
});

test("explain fails clearly for something that is neither a folder nor a saved project", async () => {
  await cli(["init"], projA);
  const result = await cli(["explain", "no-such-thing"], projA);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not a folder or a saved project/);
});

test("digest turns recent git commits into a work-log note", { skip: spawnSync("git", ["--version"]).status !== 0 }, async () => {
  await cli(["init"], projA);
  const git = (...a) => spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@t.co", ...a], { cwd: projA });
  git("init");
  git("add", ".");
  git("commit", "-m", "Add login endpoint");
  fs.writeFileSync(path.join(projA, "x.txt"), "x");
  git("add", ".");
  git("commit", "-m", "Fix CORS origin");

  const result = await cli(["digest"], projA);
  assert.equal(result.code, 0, result.stderr);
  const entry = vault("knowledge.json").find((e) => e.type === "work-log");
  assert.match(entry.content, /Add login endpoint/);
  assert.match(entry.content, /Fix CORS origin/);
  assert.equal(entry.project, "shop-api");
});

test("vault migrate merges an old per-folder vault into the personal one", async () => {
  const old = fs.mkdtempSync(path.join(os.tmpdir(), "dv-old-"));
  fs.mkdirSync(path.join(old, ".devvault"));
  fs.writeFileSync(path.join(old, ".devvault", "config.json"), JSON.stringify({ version: 1 }));
  fs.writeFileSync(path.join(old, ".devvault", "knowledge.json"), JSON.stringify([{ id: "old-1", title: "Old lesson", content: "from before", type: "general", tags: [] }]));
  fs.writeFileSync(path.join(old, ".devvault", "projects.json"), JSON.stringify([{ id: "p-old", name: "legacy", path: "/x/legacy" }]));

  const result = await cli(["vault", "migrate"], old);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Merged 1 entries and 1 projects/);
  assert.equal(vault("knowledge.json")[0].title, "Old lesson");
  assert.ok(fs.existsSync(path.join(old, ".devvault.migrated")));
  fs.rmSync(old, { recursive: true, force: true });
});

test("config sets and shows the API URL and rejects bad values", async () => {
  await cli(["init"], projA);
  assert.equal((await cli(["config", "set", "api-url", "not-a-url"], projA)).code, 1);
  assert.equal((await cli(["config", "set", "api-url", "https://vault.example.com/"], projA)).code, 0);
  const shown = await cli(["config", "show"], projA);
  assert.match(shown.stdout, /api-url:\s+https:\/\/vault\.example\.com\n/);
});

// ---------- pure helpers ----------
test("quoteArg/buildCommandLine keep arguments intact for the shell", () => {
  assert.equal(quoteArg("npm"), "npm");
  assert.equal(quoteArg("a (b)", "linux"), "'a (b)'");
  assert.equal(quoteArg("it's", "linux"), `'it'\\''s'`);
  assert.equal(quoteArg('say "hi"', "win32"), '"say \\"hi\\""');
  assert.equal(buildCommandLine(["node", "-e", "x (y)"], "linux"), "node -e 'x (y)'");
  assert.equal(buildCommandLine(["npm test && npm run lint"], "linux"), "npm test && npm run lint");
});

test("makeTitle trims long first lines on a word boundary", () => {
  assert.equal(makeTitle("short note\nsecond line"), "short note");
  const title = makeTitle("word ".repeat(40));
  assert.ok(title.length <= 81 && title.endsWith("…"));
});

test("errorSignature drops paths/numbers; rankEntries needs real overlap", () => {
  const sig = errorSignature("Error: connect ECONNREFUSED 127.0.0.1:27017\n    at /home/u/app/db.js:12:5\n    at Module._compile (node:internal:1)");
  assert.match(sig, /ECONNREFUSED/);
  assert.ok(!sig.includes("/home/u"));

  const entries = [
    { id: "1", title: "Mongo ECONNREFUSED fix", content: "start mongod", tags: [], type: "debug-incident" },
    { id: "2", title: "CSS grid tips", content: "use gap", tags: [], type: "tip" }
  ];
  const ranked = rankEntries(entries, "MongoServerError connect ECONNREFUSED mongo");
  assert.deepEqual(ranked.map((r) => r.entry.id), ["1"]);
  assert.deepEqual(rankEntries(entries, "kubernetes ingress controller"), []);
});

test("`projects` lists projects with entry counts and `forget` removes a project with all its entries", async () => {
  await cli(["init"], projA);
  await cli(["note", "keep me"], projB);
  await cli(["note", "junk one"], projA);
  await cli(["note", "junk two"], projA);

  const listed = await cli(["projects"], projA);
  assert.match(listed.stdout, /shop-api\s+2 entries/);
  assert.match(listed.stdout, /blog-app\s+1 entries/);

  assert.equal((await cli(["forget", "does-not-exist", "--yes"], projA)).code, 1);

  const result = await cli(["forget", "shop-api", "--yes"], projA);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /2 knowledge entries/);
  assert.deepEqual(vault("knowledge.json").map((e) => e.title), ["keep me"]);
  assert.deepEqual(vault("projects.json").map((p) => p.name), ["blog-app"]);
  assert.ok(fs.existsSync(projA), "project files on disk are never touched");
});
