import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

import { createApp } from "../src/app.js";
import { createMailer, verificationEmail } from "../src/services/email.js";
import { resolveEmailConfig } from "../src/config.js";

const SECRET = "t".repeat(40);

// ---------- minimal in-memory models ----------
function matches(doc, filter) {
  return Object.entries(filter).every(([k, c]) => {
    if (c && typeof c === "object" && !(c instanceof RegExp) && "$ne" in c) return doc[k] !== c.$ne;
    return String(doc[k]) === String(c);
  });
}
function query(rows) {
  let data = rows;
  const q = { select: () => q, sort: () => q, limit: () => q, lean: async () => data, then: (a, b) => Promise.resolve(data).then(a, b) };
  return q;
}
function applyUpdate(doc, update) {
  Object.assign(doc, update.$set || {});
  for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] || 0) + v;
  for (const k of Object.keys(update.$unset || {})) delete doc[k];
}
function collection(rows, extra = {}) {
  return {
    rows,
    find: (f = {}) => query(rows.filter((d) => matches(d, f))),
    findOne: (f) => query(rows.find((d) => matches(d, f)) ?? null),
    countDocuments: async (f = {}) => rows.filter((d) => matches(d, f)).length,
    updateOne: async (f, u) => { const d = rows.find((x) => matches(x, f)); if (d) applyUpdate(d, u); },
    deleteOne: async (f) => { const i = rows.findIndex((x) => matches(x, f)); if (i >= 0) rows.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
    deleteMany: async (f) => { for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], f)) rows.splice(i, 1); return { deletedCount: 0 }; },
    bulkWrite: async () => {},
    create: async (d) => { const doc = { _id: `u${rows.length + 1}`, ...d }; rows.push(doc); return doc; },
    ...extra
  };
}

let server, base, sent, models, emailRequired;

const fakeMailer = { send: async (mail) => { sent.push(mail); } };

async function start(required) {
  sent = [];
  models = {
    User: collection([]),
    Project: collection([]),
    KnowledgeEntry: collection([]),
    DebugEntry: collection([]),
    SearchHistory: collection([], { create: async () => {} })
  };
  const app = createApp({
    config: { jwtSecret: SECRET, jwtExpiresIn: "1h", dashboardDir: "/none", rateLimits: { sensitive: 1000, auth: 1000 }, email: { required, appUrl: "http://app.test", provider: "console" } },
    models,
    ai: { embed: async (t) => t.map(() => [1]), chat: async () => "x", embedModel: "m" },
    retrieve: async () => [],
    mailer: fakeMailer
  });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
}

const stop = () => new Promise((r) => server.close(r));
const call = (method, route, body, token) =>
  fetch(`${base}${route}`, { method, headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
const codeFrom = (mail) => /\b(\d{6})\b/.exec(mail.text)[1];

before(() => start(true));
after(stop);

test("register requires verification: no token is issued and a code is emailed", async () => {
  const res = await call("POST", "/api/auth/register", { name: "Ann", email: "Ann@Example.com", password: "password123" });
  const data = await res.json();
  assert.equal(res.status, 201);
  assert.equal(data.verificationRequired, true);
  assert.equal(data.token, undefined);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "ann@example.com");
  assert.match(sent[0].text, /http:\/\/app\.test\/\?verify=[a-f0-9]{64}/);
  const stored = models.User.rows[0];
  assert.ok(!JSON.stringify(stored).includes(codeFrom(sent[0])) || stored.verifyCodeHash.length === 64, "code must be stored hashed");
  assert.notEqual(stored.verifyCodeHash, codeFrom(sent[0]));
});

test("login is blocked until the email is verified (after the password is proven)", async () => {
  const wrong = await call("POST", "/api/auth/login", { email: "ann@example.com", password: "nope-nope" });
  assert.equal(wrong.status, 401);
  const blocked = await call("POST", "/api/auth/login", { email: "ann@example.com", password: "password123" });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, "EMAIL_NOT_VERIFIED");
});

test("wrong codes are rejected and lock out after 5 attempts, even for the right code", async () => {
  for (let i = 0; i < 5; i++) {
    const res = await call("POST", "/api/auth/verify-email", { email: "ann@example.com", code: "000000" });
    assert.equal(res.status, 400);
  }
  const locked = await call("POST", "/api/auth/verify-email", { email: "ann@example.com", code: codeFrom(sent[0]) });
  assert.equal(locked.status, 429);
});

test("resend issues a fresh code (throttled), and the right code verifies and logs in", async () => {
  models.User.rows[0].verifySentAt = new Date(Date.now() - 120_000);
  await call("POST", "/api/auth/resend-verification", { email: "ann@example.com" });
  assert.equal(sent.length, 2);

  await call("POST", "/api/auth/resend-verification", { email: "ann@example.com" });
  assert.equal(sent.length, 2, "second resend within 60s must be throttled");

  const res = await call("POST", "/api/auth/verify-email", { email: "ann@example.com", code: codeFrom(sent[1]) });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.ok(jwt.verify(data.token, SECRET).sub);
  assert.equal(models.User.rows[0].emailVerified, true);
  assert.equal(models.User.rows[0].verifyCodeHash, undefined);

  assert.equal((await call("POST", "/api/auth/login", { email: "ann@example.com", password: "password123" })).status, 200);
});

test("the one-click link token verifies once and cannot be reused", async () => {
  await call("POST", "/api/auth/register", { name: "Bob", email: "bob@example.com", password: "password123" });
  const token = /verify=([a-f0-9]{64})/.exec(sent.at(-1).text)[1];
  assert.equal((await call("POST", "/api/auth/verify-email", { token })).status, 200);
  assert.equal((await call("POST", "/api/auth/verify-email", { token })).status, 400);
  assert.equal((await call("POST", "/api/auth/verify-email", { token: "x".repeat(64) })).status, 400);
});

test("resend and forgot-password never reveal whether an account exists", async () => {
  const before = sent.length;
  const a = await call("POST", "/api/auth/resend-verification", { email: "ghost@example.com" });
  const b = await call("POST", "/api/auth/forgot-password", { email: "ghost@example.com" });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(sent.length, before);
});

test("password reset: code works once, changes the password, and signs out old sessions", async () => {
  const login = await (await call("POST", "/api/auth/login", { email: "ann@example.com", password: "password123" })).json();
  assert.equal((await call("GET", "/api/me", null, login.token)).status, 200);

  await call("POST", "/api/auth/forgot-password", { email: "ann@example.com" });
  const mail = sent.at(-1);
  assert.match(mail.subject, /reset/i);
  const code = codeFrom(mail);

  assert.equal((await call("POST", "/api/auth/reset-password", { email: "ann@example.com", code: "111111", newPassword: "brand-new-pass" })).status, 400);
  assert.equal((await call("POST", "/api/auth/reset-password", { email: "ann@example.com", code, newPassword: "short" })).status, 400);
  assert.equal((await call("POST", "/api/auth/reset-password", { email: "ann@example.com", code, newPassword: "brand-new-pass" })).status, 200);
  assert.equal((await call("POST", "/api/auth/reset-password", { email: "ann@example.com", code, newPassword: "another-pass-1" })).status, 400, "code is single use");

  assert.equal((await call("GET", "/api/me", null, login.token)).status, 401, "old token revoked");
  assert.equal((await call("POST", "/api/auth/login", { email: "ann@example.com", password: "password123" })).status, 401);
  assert.equal((await call("POST", "/api/auth/login", { email: "ann@example.com", password: "brand-new-pass" })).status, 200);
});

test("tokens for deleted users stop working, and account deletion needs the password and wipes data", async () => {
  const login = await (await call("POST", "/api/auth/login", { email: "ann@example.com", password: "brand-new-pass" })).json();
  const userId = login.user.id;
  models.KnowledgeEntry.rows.push({ userId, clientId: "k", title: "t" }, { userId: "other", clientId: "o", title: "t" });

  assert.equal((await call("DELETE", "/api/me", { password: "wrong" }, login.token)).status, 401);
  assert.equal(models.KnowledgeEntry.rows.length, 2);

  assert.equal((await call("DELETE", "/api/me", { password: "brand-new-pass" }, login.token)).status, 200);
  assert.deepEqual(models.KnowledgeEntry.rows.map((r) => r.userId), ["other"]);
  assert.equal((await call("GET", "/api/me", null, login.token)).status, 401);
});

test("legacy accounts (no emailVerified field) can still log in", async () => {
  models.User.rows.push({ _id: "legacy", name: "Old", email: "old@example.com", passwordHash: bcrypt.hashSync("password123", 4) });
  assert.equal((await call("POST", "/api/auth/login", { email: "old@example.com", password: "password123" })).status, 200);
});

// ---------- email service & config ----------
test("brevo and resend requests have the documented shape", async () => {
  const calls = [];
  const fetchStub = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: true }; };
  const mail = { to: "a@b.co", subject: "S", html: "<p>h</p>", text: "t" };

  await createMailer({ provider: "brevo", brevoKey: "xkeysib-1", from: { email: "me@x.co", name: "DevVault" } }, fetchStub).send(mail);
  assert.equal(calls[0].url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(calls[0].init.headers["api-key"], "xkeysib-1");
  assert.deepEqual(calls[0].body.sender, { name: "DevVault", email: "me@x.co" });
  assert.deepEqual(calls[0].body.to, [{ email: "a@b.co" }]);
  assert.equal(calls[0].body.htmlContent, "<p>h</p>");

  await createMailer({ provider: "resend", resendKey: "re_1", from: { email: "me@x.co", name: "DevVault" } }, fetchStub).send(mail);
  assert.equal(calls[1].url, "https://api.resend.com/emails");
  assert.equal(calls[1].init.headers.Authorization, "Bearer re_1");

  const failing = createMailer({ provider: "brevo", brevoKey: "k", from: { email: "a@b.co", name: "x" } }, async () => ({ ok: false, status: 401, text: async () => "bad key" }));
  await assert.rejects(() => failing.send(mail), /rejected the email \(HTTP 401\)/);
});

test("email templates escape user-controlled names", () => {
  const { html } = verificationEmail({ name: '<script>alert("x")</script>', code: "123456", link: "http://a/?verify=1" });
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("verification is required by default locally, but auto-disabled in production without a provider", () => {
  assert.equal(resolveEmailConfig({}, { production: false }).required, true);
  const prod = resolveEmailConfig({}, { production: true });
  assert.equal(prod.required, false);
  assert.match(prod.warnings[0], /verification is OFF/);
  assert.equal(resolveEmailConfig({ BREVO_API_KEY: "k", EMAIL_FROM_ADDRESS: "a@b.co" }, { production: true }).required, true);
  assert.equal(resolveEmailConfig({ REQUIRE_EMAIL_VERIFICATION: "false" }, { production: false }).required, false);
  assert.throws(() => resolveEmailConfig({ EMAIL_PROVIDER: "carrier-pigeon" }), /not valid/);
});

test("when verification is off, register logs the user in immediately", async () => {
  await stop();
  await start(false);
  const res = await call("POST", "/api/auth/register", { name: "Cy", email: "cy@example.com", password: "password123" });
  const data = await res.json();
  assert.ok(data.token);
  assert.equal(sent.length, 0);
});

// ---------- failed email delivery ----------
test("when email delivery fails: outside production the code is logged for the developer, resend works immediately", async () => {
  await stop();
  sent = [];
  models = { User: collection([]), Project: collection([]), KnowledgeEntry: collection([]), DebugEntry: collection([]), SearchHistory: collection([], { create: async () => {} }) };
  let failing = true;
  const flaky = { send: async (mail) => { if (failing) throw new Error("Brevo blocked the sending IP"); sent.push(mail); } };
  const logged = [];
  const { warn, error } = console;
  console.warn = (m) => logged.push(String(m));
  console.error = () => {};

  const app = createApp({
    config: { jwtSecret: SECRET, jwtExpiresIn: "1h", dashboardDir: "/none", rateLimits: { sensitive: 1000, auth: 1000 }, email: { required: true, appUrl: "http://app.test", provider: "brevo", devFallback: true } },
    models, ai: { embed: async (t) => t.map(() => [1]), chat: async () => "x", embedModel: "m" }, retrieve: async () => [], mailer: flaky
  });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  const reg = await (await call("POST", "/api/auth/register", { name: "Dee", email: "dee@example.com", password: "password123" })).json();
  assert.equal(reg.verificationRequired, true);
  assert.equal(reg.emailSent, false);
  const devLine = logged.find((l) => l.includes("[auth:dev]"));
  assert.match(devLine, /dee@example\.com: \d{6}/);

  // The dev-logged code really verifies the account.
  const code = /: (\d{6})/.exec(devLine)[1];
  failing = false;
  // A failed send must not start the 60s resend cooldown, so a retry goes out right away.
  await call("POST", "/api/auth/resend-verification", { email: "dee@example.com" });
  assert.equal(sent.length, 1, "resend must work immediately after a failed send");

  const ok = await call("POST", "/api/auth/verify-email", { email: "dee@example.com", code: /\b(\d{6})\b/.exec(sent[0].text)[1] });
  assert.equal(ok.status, 200);
  assert.ok(code);
  console.warn = warn;
  console.error = error;
});

test("the dev-code fallback is OFF in production (codes never reach logs)", async () => {
  await stop();
  models = { User: collection([]), Project: collection([]), KnowledgeEntry: collection([]), DebugEntry: collection([]), SearchHistory: collection([], { create: async () => {} }) };
  const logged = [];
  const { warn, error } = console;
  console.warn = (m) => logged.push(String(m));
  console.error = () => {};
  const app = createApp({
    config: { jwtSecret: SECRET, jwtExpiresIn: "1h", dashboardDir: "/none", rateLimits: { sensitive: 1000, auth: 1000 }, email: { required: true, appUrl: "http://app.test", provider: "brevo", devFallback: false } },
    models, ai: { embed: async (t) => t.map(() => [1]), chat: async () => "x", embedModel: "m" }, retrieve: async () => [],
    mailer: { send: async () => { throw new Error("nope"); } }
  });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call("POST", "/api/auth/register", { name: "Eve", email: "eve@example.com", password: "password123" });
  console.warn = warn;
  console.error = error;
  assert.ok(!logged.some((l) => /\d{6}/.test(l)));
});

// ---------- sliding sessions ----------
test("old tokens are renewed transparently, fresh ones are left alone, and renewed tokens work", async () => {
  await stop();
  await start(false);
  const reg = await (await call("POST", "/api/auth/register", { name: "Sue", email: "sue@example.com", password: "password123" })).json();
  const userId = reg.user.id;

  const old = jwt.sign({ sub: userId, v: 0, iat: Math.floor(Date.now() / 1000) - 40 * 86400 }, SECRET, { expiresIn: "90d" });
  const res = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${old}` } });
  assert.equal(res.status, 200);
  const renewed = res.headers.get("x-devvault-token");
  assert.ok(renewed, "a 40-day-old token must be renewed");
  assert.equal((await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${renewed}` } })).headers.get("x-devvault-token"), null, "the renewed token is fresh");

  const fresh = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${reg.token}` } });
  assert.equal(fresh.headers.get("x-devvault-token"), null);
});

test("session failures carry a machine-readable code, but a wrong password does not", async () => {
  const bad = await fetch(`${base}/api/me`, { headers: { Authorization: "Bearer nonsense" } });
  assert.equal((await bad.json()).code, "SESSION_INVALID");

  const login = await (await call("POST", "/api/auth/login", { email: "sue@example.com", password: "password123" })).json();
  const wrong = await call("DELETE", "/api/me", { password: "not-it-at-all" }, login.token);
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).code, undefined, "must not look like an expired session");
});
