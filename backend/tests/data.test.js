import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import jwt from "jsonwebtoken";

import { createApp } from "../src/app.js";
import { loadDotEnv, loadConfig, resolveAiConfig } from "../src/config.js";
import { createAiClient } from "../src/services/ai.js";
import { hybridRank, tokenize } from "../src/services/retrieval.js";

const SECRET = "s".repeat(40);

// ---------- .env loading ----------

function tmpEnv(content, encoding = "utf8") {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dv-env-")), ".env");
  fs.writeFileSync(file, content, encoding);
  return file;
}

test("loadDotEnv parses quotes, comments, export and does not override existing vars", () => {
  const file = tmpEnv(
    ['# comment', 'JWT_SECRET="quoted-secret-value"', "PORT=8080 # inline", "export AI_API_KEY='k-1'", "EXISTING=from-file", "", "BAD LINE"].join("\n")
  );
  const env = { EXISTING: "from-process" };
  assert.equal(loadDotEnv(file, env), true);
  assert.equal(env.JWT_SECRET, "quoted-secret-value");
  assert.equal(env.PORT, "8080");
  assert.equal(env.AI_API_KEY, "k-1");
  assert.equal(env.EXISTING, "from-process");
});

test("loadDotEnv handles a UTF-8 BOM and Windows UTF-16 files", () => {
  const bom = tmpEnv("\uFEFFJWT_SECRET=bom-value\r\nPORT=1\r\n");
  const env1 = {};
  loadDotEnv(bom, env1);
  assert.equal(env1.JWT_SECRET, "bom-value");

  const utf16 = tmpEnv("\uFEFFJWT_SECRET=utf16-value\r\n", "utf16le");
  const env2 = {};
  loadDotEnv(utf16, env2);
  assert.equal(env2.JWT_SECRET, "utf16-value");

  assert.equal(loadDotEnv(path.join(os.tmpdir(), "does-not-exist.env"), {}), false);
});

test("loadConfig gives actionable errors", () => {
  assert.throws(() => loadConfig({}), /JWT_SECRET is not set[\s\S]*\.env/);
  assert.throws(() => loadConfig({ JWT_SECRET: "short" }), /only 5 characters/);
});

// ---------- hybrid ranking ----------

test("tokenize drops stop words and duplicates", () => {
  assert.deepEqual(tokenize("Where have I used JWT in the JWT flow?"), ["jwt", "flow"]);
});

test("hybrid ranking rescues exact keyword hits that embeddings miss", () => {
  const docs = [
    { id: "kw", title: "Shortify — JWT authentication", content: "jwt.sign used", tags: ["jwt"], type: "authentication", embedding: [0, 1] },
    { id: "sem", title: "Login flow", content: "users sign in with a token", tags: [], type: "authentication", embedding: [0.95, 0.3] },
    { id: "noise", title: "Dockerfile", content: "docker build", tags: [], type: "deployment", embedding: [0, 1] }
  ];
  const ranked = hybridRank([1, 0], "jwt", docs, { limit: 5, minScore: 0.5 });
  const ids = ranked.map((r) => r.doc.id);

  assert.ok(ids.includes("kw"), "keyword match must be retrieved despite low cosine");
  assert.ok(ids.includes("sem"), "semantic match must be retrieved");
  assert.ok(!ids.includes("noise"));
  assert.equal(ranked.find((r) => r.doc.id === "kw").matchedBy, "keyword");
  assert.equal(ranked.find((r) => r.doc.id === "sem").matchedBy, "semantic");
});

// ---------- dashboard endpoints ----------

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") return cond.some((sub) => matches(doc, sub));
    const value = doc[key];
    if (cond instanceof RegExp) return Array.isArray(value) ? value.some((v) => cond.test(v)) : cond.test(String(value ?? ""));
    if (cond && typeof cond === "object" && "$ne" in cond) return value !== cond.$ne;
    if (cond && typeof cond === "object" && "$nin" in cond) return !cond.$nin.includes(value);
    if (Array.isArray(value)) return value.includes(cond);
    return String(value) === String(cond);
  });
}

function query(rows) {
  let data = rows;
  const q = {
    select: () => q,
    sort: () => q,
    skip: (n) => ((data = data.slice(n)), q),
    limit: (n) => ((data = data.slice(0, n)), q),
    lean: async () => data,
    then: (res, rej) => Promise.resolve(data).then(res, rej)
  };
  return q;
}

function fakeCollection(store, name, idField) {
  return {
    find: (filter) => query(store[name].filter((d) => matches(d, filter))),
    findOne: (filter) => query(store[name].find((d) => matches(d, filter)) ?? null),
    countDocuments: async (filter) => store[name].filter((d) => matches(d, filter)).length,
    deleteOne: async (filter) => {
      const i = store[name].findIndex((d) => matches(d, filter));
      if (i >= 0) store[name].splice(i, 1);
      return { deletedCount: i >= 0 ? 1 : 0 };
    },
    deleteMany: async (filter) => {
      const before = store[name].length;
      store[name] = store[name].filter((d) => !matches(d, filter));
      return { deletedCount: before - store[name].length };
    },
    bulkWrite: async (ops = []) => {
      for (const { updateOne } of ops) {
        const doc = store[name].find((d) => matches(d, updateOne.filter));
        if (doc && updateOne.update?.$set) Object.assign(doc, updateOne.update.$set);
      }
    }
  };
}

let store;
let server;
const embedCalls = [];
const aiFake = {
  embedModel: "m@768",
  embed: async (t) => { embedCalls.push(t.length); return t.map(() => [1]); },
  chat: async () => "x",
  describe: () => ({ provider: "gemini", chatModel: "c", embedModel: "m@768", configured: true })
};
let base;
const tokenFor = (id) => jwt.sign({ sub: id }, SECRET, { expiresIn: "1h" });

before(async () => {
  store = {
    users: [{ _id: "u1", name: "One", email: "one@x.co" }, { _id: "u2", name: "Two", email: "two@x.co" }],
    projects: [{ userId: "u1", clientId: "p1", name: "Shortify", languages: ["JavaScript"], analyzedAt: new Date() }, { userId: "u2", clientId: "p9", name: "Secret", languages: [] }],
    knowledge: [
      { userId: "u1", clientId: "a", project: "Shortify", type: "authentication", title: "JWT auth", content: "jwt.sign", tags: ["jwt", "auth"], embeddingModel: "m" },
      { userId: "u1", clientId: "b", project: "Shortify", type: "deployment", title: "Render deploy", content: "render.yaml", tags: ["deployment"] },
      { userId: "u2", clientId: "c", project: "Secret", type: "authentication", title: "Other user's note", content: "private", tags: ["jwt"] }
    ],
    debug: [],
    history: [{ userId: "u1", query: "jwt", mode: "ask", resultCount: 2, createdAt: new Date() }]
  };

  const models = {
    User: fakeCollection(store, "users"),
    Project: fakeCollection(store, "projects"),
    KnowledgeEntry: fakeCollection(store, "knowledge"),
    DebugEntry: fakeCollection(store, "debug"),
    SearchHistory: { ...fakeCollection(store, "history"), create: async (d) => store.history.push(d) }
  };

  const app = createApp({
    config: { jwtSecret: SECRET, jwtExpiresIn: "1h", dashboardDir: "/nonexistent" },
    models,
    ai: aiFake,
    retrieve: async () => []
  });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((r) => server.close(r)));

const call = (method, route, token, body) =>
  fetch(`${base}${route}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body)
  });

test("/api/me returns the caller", async () => {
  const data = await (await call("GET", "/api/me", tokenFor("u1"))).json();
  assert.equal(data.user.email, "one@x.co");
});

test("knowledge list is user-scoped, filterable and paginated", async () => {
  const all = await (await call("GET", "/api/knowledge", tokenFor("u1"))).json();
  assert.equal(all.total, 2);
  assert.ok(all.items.every((i) => i.project === "Shortify"));
  assert.ok(!JSON.stringify(all).includes("private"));

  const byType = await (await call("GET", "/api/knowledge?type=deployment", tokenFor("u1"))).json();
  assert.deepEqual(byType.items.map((i) => i.id), ["b"]);

  const byTag = await (await call("GET", "/api/knowledge?tag=jwt", tokenFor("u1"))).json();
  assert.deepEqual(byTag.items.map((i) => i.id), ["a"]);

  const byText = await (await call("GET", "/api/knowledge?q=render", tokenFor("u1"))).json();
  assert.deepEqual(byText.items.map((i) => i.id), ["b"]);

  const paged = await (await call("GET", "/api/knowledge?limit=1&page=2", tokenFor("u1"))).json();
  assert.equal(paged.items.length, 1);
  assert.equal(paged.pages, 2);
});

test("operator injection through query strings is ignored", async () => {
  const res = await call("GET", "/api/knowledge?type[$ne]=x&project[$ne]=y", tokenFor("u1"));
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.total, 2);
});

test("a user cannot read or delete another user's entry", async () => {
  assert.equal((await call("GET", "/api/knowledge/c", tokenFor("u1"))).status, 404);
  assert.equal((await call("DELETE", "/api/knowledge/c", tokenFor("u1"))).status, 404);
  assert.ok(store.knowledge.some((k) => k.clientId === "c"));
});

test("delete removes the caller's own entry", async () => {
  store.knowledge.push({ userId: "u1", clientId: "tmp", type: "x", title: "t", content: "c", tags: [] });
  const res = await call("DELETE", "/api/knowledge/tmp", tokenFor("u1"));
  assert.equal(res.status, 200);
  assert.ok(!store.knowledge.some((k) => k.clientId === "tmp"));
});

test("stats and projects aggregate only the caller's data", async () => {
  const stats = await (await call("GET", "/api/stats", tokenFor("u1"))).json();
  assert.equal(stats.totals.entries, 2);
  assert.equal(stats.totals.embedded, 1);
  assert.equal(stats.totals.projects, 1);
  assert.equal(stats.byType.find((t) => t.name === "authentication").count, 1);
  assert.equal(stats.recentSearches.length, 1);

  const projects = await (await call("GET", "/api/projects", tokenFor("u1"))).json();
  assert.deepEqual(projects.projects.map((p) => p.name), ["Shortify"]);
  assert.equal(projects.projects[0].entryCount, 2);
});

test("prune deletes only the caller's entries missing from keepIds and refuses an empty list", async () => {
  assert.equal((await call("POST", "/api/sync/prune", tokenFor("u1"), { keepIds: [] })).status, 400);
  assert.equal((await call("POST", "/api/sync/prune", tokenFor("u1"), { keepIds: "a" })).status, 400);

  const res = await call("POST", "/api/sync/prune", tokenFor("u1"), { keepIds: ["a"] });
  assert.equal((await res.json()).deleted, 1);
  assert.ok(store.knowledge.some((k) => k.clientId === "a"));
  assert.ok(!store.knowledge.some((k) => k.clientId === "b"));
  assert.ok(store.knowledge.some((k) => k.clientId === "c"), "other user's data must survive");
});

test("the built dashboard is served with an SPA fallback, but never for /api paths", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dv-dash-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html>DASH</html>");
  const app = createApp({
    config: { jwtSecret: SECRET, jwtExpiresIn: "1h", dashboardDir: dir },
    models: { User: {}, Project: {}, KnowledgeEntry: {}, DebugEntry: {}, SearchHistory: {} },
    ai: {}, retrieve: async () => []
  });
  const srv = app.listen(0);
  await new Promise((r) => srv.once("listening", r));
  const url = `http://127.0.0.1:${srv.address().port}`;

  assert.match(await (await fetch(`${url}/`)).text(), /DASH/);
  assert.match(await (await fetch(`${url}/deep/link`)).text(), /DASH/);
  assert.equal((await fetch(`${url}/api/knowledge`)).status, 401);
  await new Promise((r) => srv.close(r));
});

// ---------- AI provider presets ----------

test("gemini preset needs only one key and targets Google's OpenAI-compatible endpoint", () => {
  const ai = resolveAiConfig({ AI_PROVIDER: "gemini", AI_API_KEY: "gkey" });
  assert.equal(ai.provider, "gemini");
  assert.equal(ai.chat.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
  assert.equal(ai.embed.baseUrl, ai.chat.baseUrl);
  assert.equal(ai.chat.apiKey, "gkey");
  assert.equal(ai.embed.apiKey, "gkey");
  assert.equal(ai.chat.model, "gemini-flash-latest");
  assert.equal(ai.embed.model, "gemini-embedding-001");
  assert.equal(ai.embed.dimensions, 768);
});

test("ollama preset needs no key; chat and embeddings can use different providers", () => {
  assert.ok(resolveAiConfig({ AI_PROVIDER: "ollama" }).chat.apiKey);

  const split = resolveAiConfig({
    AI_PROVIDER: "gemini",
    AI_API_KEY: "gkey",
    AI_CHAT_BASE_URL: "https://chat.example/v1/",
    AI_CHAT_API_KEY: "ckey",
    AI_CHAT_MODEL: "big-chat"
  });
  assert.equal(split.chat.baseUrl, "https://chat.example/v1");
  assert.equal(split.chat.apiKey, "ckey");
  assert.equal(split.embed.apiKey, "gkey");
  assert.equal(split.embed.model, "gemini-embedding-001");
});

test("backward compatible: AI_BASE_URL without a provider acts as a custom provider", () => {
  const ai = resolveAiConfig({ AI_BASE_URL: "http://localhost:1234/v1", AI_API_KEY: "k", AI_CHAT_MODEL: "m", AI_EMBED_MODEL: "e" });
  assert.equal(ai.provider, "custom");
  assert.equal(ai.chat.baseUrl, "http://localhost:1234/v1");
});

test("invalid provider or malformed extra body fail loudly", () => {
  assert.throws(() => resolveAiConfig({ AI_PROVIDER: "skynet" }), /not valid/);
  assert.throws(() => resolveAiConfig({ AI_PROVIDER: "gemini", AI_CHAT_EXTRA_BODY: "{nope" }), /valid JSON/);
});

test("health exposes provider status without secrets", async () => {
  const data = await (await fetch(`${base}/api/health`)).json();
  assert.equal(data.ai.provider, "gemini");
  assert.equal(data.ai.configured, true);
  assert.ok(!JSON.stringify(data).toLowerCase().includes("key"));
});

test("reindex re-embeds only entries from a different model and reports what remains", async () => {
  store.knowledge.push(
    { userId: "u1", clientId: "old1", type: "x", title: "t", content: "c", tags: [], embeddingModel: "text-embedding-3-small" },
    { userId: "u1", clientId: "old2", type: "x", title: "t", content: "c", tags: [] },
    { userId: "u2", clientId: "other", type: "x", title: "t", content: "c", tags: [], embeddingModel: "old" }
  );
  embedCalls.length = 0;

  const first = await (await call("POST", "/api/sync/reindex", tokenFor("u1"), {})).json();
  assert.equal(first.model, "m@768");
  assert.ok(first.reindexed >= 2);
  assert.equal(embedCalls.length, 1);
  assert.ok(!JSON.stringify(embedCalls).includes("other"));

  const second = await (await call("POST", "/api/sync/reindex", tokenFor("u1"), {})).json();
  assert.equal(second.reindexed, 0);
  assert.equal(second.remaining, 0);
});

test("a stray AI_BASE_URL cannot override a provider preset (the api.gemini.com mistake)", () => {
  const ai = resolveAiConfig({ AI_PROVIDER: "gemini", AI_API_KEY: "k", AI_BASE_URL: "https://api.gemini.com/v1" });
  assert.equal(ai.chat.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
  assert.equal(ai.embed.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
  assert.equal(ai.warnings.length, 1);
  assert.match(ai.warnings[0], /Delete the AI_BASE_URL line/);
  assert.equal(resolveAiConfig({ AI_PROVIDER: "gemini" }).warnings.length, 0);
});

test("a 404 from the provider names the host and the likely cause", async () => {
  const client = createAiClient(
    { provider: "gemini", chat: { baseUrl: "https://api.gemini.com/v1", apiKey: "k", model: "m", maxTokens: 10 }, embed: { baseUrl: "https://api.gemini.com/v1", apiKey: "k", model: "e" }, chatExtraBody: {} },
    async () => ({ ok: false, status: 404 })
  );
  await assert.rejects(() => client.embed(["x"]), /api\.gemini\.com.*base URL/s);
});

test("deleting a project removes it, its entries and its debug history, and only for the owner", async () => {
  store.projects.push({ userId: "u1", clientId: "px", name: "Junk Project" }, { userId: "u2", clientId: "py", name: "Junk Project" });
  store.knowledge.push(
    { userId: "u1", clientId: "e1", project: "Junk Project", type: "x", title: "t", content: "c", tags: [] },
    { userId: "u1", clientId: "e2", projectClientId: "px", type: "x", title: "t", content: "c", tags: [] },
    { userId: "u1", clientId: "keep", project: "Shortify", type: "x", title: "t", content: "c", tags: [] },
    { userId: "u2", clientId: "theirs", project: "Junk Project", type: "x", title: "t", content: "c", tags: [] }
  );

  assert.equal((await call("DELETE", "/api/projects/py", tokenFor("u1"))).status, 404, "cannot delete another user's project");

  const res = await call("DELETE", "/api/projects/px", tokenFor("u1"));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).entries, 2);
  assert.ok(!store.projects.some((p) => p.clientId === "px"));
  assert.ok(store.knowledge.some((k) => k.clientId === "keep"), "unrelated entries survive");
  assert.ok(store.knowledge.some((k) => k.clientId === "theirs"), "other users' data survives");
  assert.ok(store.projects.some((p) => p.clientId === "py"));
});
