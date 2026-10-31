import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeUrl } from "../src/cli/commands/start.js";

const cliPath = fileURLToPath(new URL("../src/index.js", import.meta.url));
let server, apiUrl, home, project, mode, requests;

const USERS = {
  "a@x.co": { id: "user-a", name: "Alice" },
  "b@x.co": { id: "user-b", name: "Bob" }
};

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const data = body ? JSON.parse(body) : {};
      requests.push({ url: req.url, auth: req.headers.authorization });
      const send = (status, payload, headers = {}) => {
        res.writeHead(status, { "Content-Type": "application/json", ...headers });
        res.end(JSON.stringify(payload));
      };

      if (req.url === "/api/health") return send(200, { status: "ok" });
      if (req.url === "/api/auth/login") {
        const user = USERS[data.email];
        return user && data.password === "password123"
          ? send(200, { token: `token-${user.id}`, user: { id: user.id, name: user.name, email: data.email } })
          : send(401, { error: "Invalid email or password." });
      }
      if (req.url === "/api/me" && mode === "expired") return send(401, { error: "Session is no longer valid.", code: "SESSION_INVALID" });
      if (req.url === "/api/me" && mode === "renew") return send(200, { user: { name: "Alice", email: "a@x.co" } }, { "X-DevVault-Token": "token-renewed" });
      if (req.url === "/api/me") return send(200, { user: { name: "Alice", email: "a@x.co" } });
      if (req.url === "/api/sync") return send(200, { created: 0, updated: 0, unchanged: 0, embedded: 0, embeddingFailed: 0 });
      send(404, { error: "Not found." });
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  mode = "ok";
  requests = [];
  home = fs.mkdtempSync(path.join(os.tmpdir(), "dv-onb-home-"));
  project = fs.mkdtempSync(path.join(home, "proj-"));
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "demo-app" }));
});

afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

function cli(args, cwd = project) {
  return new Promise((resolve) => {
    const env = { ...process.env, HOME: home, USERPROFILE: home, DEVVAULT_HOME: path.join(home, "cfg"), DEVVAULT_API_URL: apiUrl };
    for (const key of ["DEVVAULT_VAULT_DIR", "DEVVAULT_ALLOW_ANONYMOUS"]) delete env[key];
    const child = spawn(process.execPath, [cliPath, ...args], { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end();
  });
}

const login = (email = "a@x.co") => cli(["login", "--email", email, "--password", "password123"]);
const auth = () => JSON.parse(fs.readFileSync(path.join(home, "cfg", "auth.json"), "utf8"));
const vaultOf = (id) => path.join(home, ".devvault", "users", id);
const notesOf = (id) => JSON.parse(fs.readFileSync(path.join(vaultOf(id), "knowledge.json"), "utf8"));

test("before signing in, vault commands are blocked with a friendly pointer to `devvault start`", async () => {
  for (const args of [["note", "hi"], ["list"], ["run", "--", "node", "-v"], ["fix", "x"], ["explain", "."], ["analyze", "."], ["sync"], ["ask", "q"], []]) {
    const result = await cli(args);
    assert.equal(result.code, 1, `devvault ${args.join(" ")}`);
    assert.match(result.stderr, /Welcome to DevVault/);
    assert.match(result.stderr, /devvault start/);
    assert.match(result.stderr, /devvault login/);
  }
  assert.ok(!fs.existsSync(path.join(home, ".devvault")), "a blocked command must not create anything");
});

test("the commands needed to sign up (and diagnostics) work before signing in", async () => {
  assert.equal((await cli(["--help"])).code, 0);
  assert.equal((await cli(["config", "show"])).code, 0);
  const doctor = await cli(["doctor"]); // may report problems (exit 1), but must never be blocked by the sign-in gate
  assert.ok(!doctor.stderr.includes("Welcome to DevVault"));
  assert.match(doctor.stdout, /DevVault doctor/);
  assert.equal((await login()).code, 0);
});

test("signing in creates your own vault automatically (no separate `init`) and turns on auto-sync", async () => {
  const result = await login();
  assert.match(result.stdout, /Signed in as a@x\.co/);
  assert.match(result.stdout, /stay signed in on this device/);
  assert.ok(fs.existsSync(path.join(vaultOf("user-a"), "config.json")));
  assert.equal(auth().autoSync, true);
  assert.equal(auth().token, "token-user-a");

  const note = await cli(["note", "first note", "--tags", "t"]);
  assert.equal(note.code, 0, note.stderr);
  assert.equal(notesOf("user-a")[0].project, "demo-app");
  assert.ok(requests.some((r) => r.url === "/api/sync" && r.auth === "Bearer token-user-a"), "auto-sync must upload the note to the account");
});

test("you stay signed in: later commands never ask to log in again", async () => {
  await login();
  for (const args of [["note", "one"], ["notes"], ["fix", "some error"]]) {
    const result = await cli(args);
    assert.ok(!result.stderr.includes("Welcome to DevVault"), args.join(" "));
  }
});

test("accounts are isolated on the same computer: B never sees or uploads A's notes", async () => {
  await login("a@x.co");
  await cli(["note", "Alice private note"]);
  await cli(["logout"]);

  const blocked = await cli(["notes", "--all"]);
  assert.equal(blocked.code, 1, "after logout you must sign in again");

  await login("b@x.co");
  const bobs = await cli(["notes", "--all"]);
  assert.ok(!bobs.stdout.includes("Alice private note"));
  requests = [];
  await cli(["note", "Bob note"]);
  const uploaded = JSON.stringify(requests);
  assert.ok(!uploaded.includes("Alice"), "nothing of Alice's may be sent with Bob's token");
  assert.notEqual(vaultOf("user-a"), vaultOf("user-b"));

  await cli(["logout"]);
  await login("a@x.co");
  assert.match((await cli(["notes", "--all"])).stdout, /Alice private note/, "Alice's notes come back when she signs in again");
});

test("a vault from older versions (~/.devvault) is adopted by the first account that signs in, not the second", async () => {
  fs.mkdirSync(path.join(home, ".devvault"), { recursive: true });
  fs.writeFileSync(path.join(home, ".devvault", "config.json"), JSON.stringify({ version: 1 }));
  fs.writeFileSync(path.join(home, ".devvault", "knowledge.json"), JSON.stringify([{ id: "old-1", title: "Legacy lesson", content: "kept", type: "note", tags: [] }]));
  fs.writeFileSync(path.join(home, ".devvault", "projects.json"), "[]");

  const first = await login("a@x.co");
  assert.match(first.stdout, /earlier notes on this computer were moved/);
  assert.equal(notesOf("user-a")[0].title, "Legacy lesson");
  assert.ok(!fs.existsSync(path.join(home, ".devvault", "knowledge.json")), "moved, not copied");

  await cli(["logout"]);
  await login("b@x.co");
  assert.ok(!JSON.stringify(notesOf("user-b")).includes("Legacy lesson"));
});

test("an expired or revoked session is explained clearly and sends you back to sign-in", async () => {
  await login();
  mode = "expired";
  const result = await cli(["account", "whoami"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /session has expired/i);
  assert.match(result.stderr, /devvault login/);
  assert.equal(auth().token, undefined);
  assert.match((await cli(["note", "x"])).stderr, /Welcome to DevVault/);
});

test("a renewed token from the server replaces the old one silently (you stay signed in)", async () => {
  await login();
  mode = "renew";
  const result = await cli(["account", "whoami"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(auth().token, "token-renewed");
});

test("`devvault start` refuses to run without a real terminal and explains why", async () => {
  const result = await cli(["start"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /interactive/);
});

test("normalizeUrl accepts what people actually type", () => {
  assert.equal(normalizeUrl("devvault.onrender.com/"), "https://devvault.onrender.com");
  assert.equal(normalizeUrl("https://x.app/api"), "https://x.app");
  assert.equal(normalizeUrl("localhost:5000"), "http://localhost:5000");
  assert.equal(normalizeUrl("  "), "");
});
