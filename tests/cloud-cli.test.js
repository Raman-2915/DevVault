import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../src/index.js", import.meta.url));

let server;
let apiUrl;
let requests;
let workspace;
let home;

function runCli(args, { input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: workspace,
      env: { ...process.env, DEVVAULT_HOME: home, DEVVAULT_API_URL: apiUrl, DEVVAULT_ALLOW_ANONYMOUS: "1", DEVVAULT_VAULT_DIR: path.join(workspace, ".devvault") }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(workspace, ".devvault", name), "utf8"));

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : null;
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: parsed });
      const send = (status, data) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      };

      if (req.url === "/api/auth/login") {
        if (parsed.email === "unverified@x.co") return send(403, { error: "Please verify your email before logging in.", code: "EMAIL_NOT_VERIFIED" });
        return parsed.password === "correct-password"
          ? send(200, { token: "tok123", user: { id: "u1", email: parsed.email, name: "T" } })
          : send(401, { error: "Invalid email or password." });
      }
      if (req.url === "/api/auth/register") {
        return parsed.email.startsWith("verify")
          ? send(201, { verificationRequired: true, email: parsed.email, emailSent: true })
          : send(201, { token: "tok-new", user: { id: "u2", email: parsed.email, name: parsed.name } });
      }
      if (req.url === "/api/auth/verify-email") {
        return parsed.code === "123456"
          ? send(200, { token: "tok-verified", user: { id: "u3", email: parsed.email, name: "V" } })
          : send(400, { error: "Invalid or expired code." });
      }
      if (req.url === "/api/auth/forgot-password" || req.url === "/api/auth/resend-verification") return send(200, { ok: true });
      if (req.url === "/api/auth/reset-password") {
        return parsed.code === "654321" ? send(200, { ok: true }) : send(400, { error: "Invalid or expired code." });
      }
      if (req.url === "/api/me" && req.method === "DELETE") return parsed.password === "correct-password" ? send(200, { deleted: true }) : send(401, { error: "Incorrect password." });
      if (req.url === "/api/me") return send(200, { user: { id: "u1", name: "T", email: "a@b.co" } });
      if (!req.headers.authorization) return send(401, { error: "Authentication required.", code: "SESSION_INVALID" });
      if (req.url === "/api/sync" && req.method === "POST") return send(200, { created: parsed.knowledge.length, updated: 0, unchanged: 0, embedded: parsed.knowledge.length, embeddingFailed: 0 });
      if (req.url === "/api/sync/pull") return send(200, { knowledge: [{ id: "cloud-1", title: "From cloud", content: "pulled", type: "general", tags: [] }] });
      if (req.url === "/api/ask") return send(200, { answer: "You used JWT in Shortify [1].", grounded: true, sources: [{ title: "Shortify — JWT authentication", project: "Shortify", type: "authentication", sourceFile: "src/auth.js", sourceLine: 3, score: 0.91 }] });
      if (req.url === "/api/search") return send(200, { results: [{ title: "Hit", project: "P", type: "t", content: "some content", score: 0.8 }] });
      if (req.url === "/api/debug/structure") return send(200, { structured: { title: "Mongo ECONNREFUSED", problem: "Cannot connect", cause: "IP not allow-listed", solution: "Add 0.0.0.0/0 in Atlas", tags: ["mongodb", "atlas"] } });
      send(404, { error: "Not found." });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(async () => {
  requests = [];
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "dv-cloud-ws-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "dv-cloud-home-"));
  await runCli(["init"]);
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

async function login() {
  return runCli(["login", "--email", "a@b.co", "--password", "correct-password"]);
}

test("login stores a token with a restricted file and logout removes it", async () => {
  const result = await login();
  assert.equal(result.code, 0, result.stderr);
  const authFile = path.join(home, "auth.json");
  assert.equal(JSON.parse(fs.readFileSync(authFile, "utf8")).token, "tok123");
  if (process.platform !== "win32") assert.equal(fs.statSync(authFile).mode & 0o777, 0o600);

  await runCli(["logout"]);
  assert.equal(JSON.parse(fs.readFileSync(authFile, "utf8")).token, undefined);
});

test("wrong password fails with a non-zero exit code", async () => {
  const result = await runCli(["login", "--email", "a@b.co", "--password", "nope"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Invalid email or password/);
});

test("cloud commands require login", async () => {
  const result = await runCli(["ask", "anything"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not logged in/i);
});

test("sync uploads only new/changed entries, strips paths, and is idempotent", async () => {
  await login();
  await runCli(["add", "--title", "Note A", "--content", "Alpha", "--project", "P1"]);
  fs.writeFileSync(
    path.join(workspace, ".devvault", "projects.json"),
    JSON.stringify([{ id: "p1", name: "P1", path: "/home/secretuser/code/P1", languages: ["JavaScript"] }])
  );

  const first = await runCli(["sync"]);
  assert.equal(first.code, 0, first.stderr);
  const upload = requests.find((r) => r.url === "/api/sync" && r.method === "POST");
  assert.equal(upload.auth, "Bearer tok123");
  assert.equal(upload.body.knowledge.length, 1);
  assert.ok(!JSON.stringify(upload.body).includes("secretuser"), "absolute path must not be sent");
  assert.ok(readJson("knowledge.json")[0].syncedHash);

  requests = [];
  const second = await runCli(["sync"]);
  assert.match(second.stdout, /Entries to upload:\s+0/);
  assert.equal(requests.find((r) => r.url === "/api/sync").body.knowledge.length, 0);

  // editing an entry makes it pending again
  const id = readJson("knowledge.json")[0].id;
  await runCli(["edit", id, "--content", "Alpha changed"]);
  const third = await runCli(["sync", "--dry-run"]);
  assert.match(third.stdout, /Entries to upload:\s+1/);
});

test("sync --pull merges cloud-only entries", async () => {
  await login();
  const result = await runCli(["sync", "--pull"]);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(readJson("knowledge.json").some((e) => e.id === "cloud-1"));
});

test("ask prints the grounded answer and its sources", async () => {
  await login();
  const result = await runCli(["ask", "Where did I use JWT?"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /You used JWT in Shortify/);
  assert.match(result.stdout, /src\/auth\.js:3/);
  assert.equal(requests.find((r) => r.url === "/api/ask").body.question, "Where did I use JWT?");
});

test("search --semantic calls the API", async () => {
  await login();
  const result = await runCli(["search", "auth", "--semantic"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Hit/);
});

test("capture-error redacts secrets before sending and saves on --yes", async () => {
  await login();
  const result = await runCli(
    ["capture-error", "--message", "MongoNetworkError ECONNREFUSED\npassword=hunter2-secret", "--project", "Shortify", "--yes"]
  );
  assert.equal(result.code, 0, result.stderr);

  const sent = requests.find((r) => r.url === "/api/debug/structure").body;
  assert.ok(!sent.error.includes("hunter2-secret"));

  const entry = readJson("knowledge.json").find((e) => e.type === "debug-incident");
  assert.equal(entry.project, "Shortify");
  assert.match(entry.content, /Solution: Add 0\.0\.0\.0\/0 in Atlas/);
  assert.ok(entry.tags.includes("debugging"));
});

test("capture-error does not save when the user declines", async () => {
  await login();
  const result = await runCli(["capture-error", "--message", "Some error"], { input: "n\n" });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(readJson("knowledge.json").length, 0);
});

test("export then import round-trips and skips duplicates", async () => {
  await runCli(["add", "--title", "Keep me", "--content", "Body text", "--tags", "a,b"]);
  const file = path.join(workspace, "backup.json");
  const exported = await runCli(["export", file]);
  assert.equal(exported.code, 0, exported.stderr);

  const again = await runCli(["export", file]);
  assert.equal(again.code, 1, "must refuse to overwrite without --force");

  const imported = await runCli(["import", file]);
  assert.match(imported.stdout, /Imported 0 entries \(1 skipped/);

  fs.writeFileSync(path.join(workspace, ".devvault", "knowledge.json"), "[]");
  const restored = await runCli(["import", file]);
  assert.match(restored.stdout, /Imported 1 entries/);
  assert.equal(readJson("knowledge.json")[0].title, "Keep me");
});

test("import rejects files that are not DevVault exports", async () => {
  const file = path.join(workspace, "bad.json");
  fs.writeFileSync(file, JSON.stringify({ hello: "world" }));
  const result = await runCli(["import", file]);
  assert.equal(result.code, 1);
});

test("history lists recorded actions", async () => {
  await runCli(["add", "--title", "T", "--content", "C"]);
  await runCli(["search", "T"]);
  const result = await runCli(["history", "--action", "search"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /search/);
  assert.ok(!/\badd\b/.test(result.stdout.split("\n").slice(3).join("\n")));
});

test("register with verification: no login until the code is confirmed", async () => {
  const reg = await runCli(["register", "--name", "V", "--email", "verify@x.co", "--password", "password123"]);
  assert.equal(reg.code, 0, reg.stderr);
  assert.match(reg.stdout, /6-digit code/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "auth.json"), "utf8")).token, undefined);

  const bad = await runCli(["verify", "--code", "000000"]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /Invalid or expired code/);

  const good = await runCli(["verify", "--code", "123456"]);
  assert.equal(good.code, 0, good.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "auth.json"), "utf8")).token, "tok-verified");
});

test("login for an unverified account explains what to do (non-interactive)", async () => {
  const result = await runCli(["login", "--email", "unverified@x.co", "--password", "whatever"]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /not verified/);
  assert.match(result.stdout, /devvault verify/);
});

test("forgot-password then reset-password", async () => {
  const forgot = await runCli(["forgot-password", "--email", "a@b.co"]);
  assert.equal(forgot.code, 0, forgot.stderr);
  assert.match(forgot.stdout, /reset code/);

  const wrong = await runCli(["reset-password", "--code", "111111", "--new-password", "newpassword1"]);
  assert.equal(wrong.code, 1);
  const ok = await runCli(["reset-password", "--code", "654321", "--new-password", "newpassword1"]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /Password updated/);
});

test("account delete needs the right password and clears the login", async () => {
  await login();
  const wrong = await runCli(["account", "delete", "--yes", "--password", "nope"]);
  assert.equal(wrong.code, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "auth.json"), "utf8")).token, "tok123");

  const done = await runCli(["account", "delete", "--yes", "--password", "correct-password"]);
  assert.equal(done.code, 0, done.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "auth.json"), "utf8")).token, undefined);
});

test("auto-sync uploads a note right away when enabled", async () => {
  await login();
  await runCli(["config", "set", "auto-sync", "on"]);
  requests = [];
  await runCli(["note", "Remember to rotate the keys", "--general"]);
  const upload = requests.find((r) => r.url === "/api/sync");
  assert.ok(upload, "note should have triggered a sync");
  assert.equal(upload.body.knowledge[0].title, "Remember to rotate the keys");
});
