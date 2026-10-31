import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAiConfig } from "../src/config.js";
import { createAiClient, preferChatModels } from "../src/services/ai.js";
import { createMailer } from "../src/services/email.js";

const cfg = (over = {}) => ({
  provider: "x",
  chat: { provider: "x", baseUrl: "http://x", apiKey: "k", model: "primary", maxTokens: 100, fallbackModels: ["alt-1", "alt-2"] },
  embed: { provider: "x", baseUrl: "http://x", apiKey: "k", model: "e" },
  chatExtraBody: {},
  retryDelayMs: 0,
  ...over
});

const quiet = async (fn) => {
  const { error, warn } = console;
  console.error = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { console.error = error; console.warn = warn; }
};

// ---------- presets ----------
test("nvidia preset targets integrate.api.nvidia.com, uses input_type embeddings and a bigger token budget", () => {
  const ai = resolveAiConfig({ AI_PROVIDER: "nvidia", AI_API_KEY: "nvapi-test" });
  assert.equal(ai.chat.baseUrl, "https://integrate.api.nvidia.com/v1");
  assert.equal(ai.embed.baseUrl, "https://integrate.api.nvidia.com/v1");
  assert.equal(ai.embed.model, "nvidia/nemotron-3-embed-1b");
  assert.equal(ai.embed.inputTypes, true);
  assert.equal(ai.embed.dimensions, undefined, "nemotron-3-embed only supports its native 2048 dims");
  assert.equal(ai.chat.maxTokens, 4096);
  assert.ok(ai.chat.fallbackModels.includes("nvidia/nemotron-3-super-120b-a12b"));
});

test("chat and embeddings can come from different providers, each with its own key", () => {
  const ai = resolveAiConfig({ AI_CHAT_PROVIDER: "nvidia", AI_EMBED_PROVIDER: "gemini", NVIDIA_API_KEY: "nvapi-1", GEMINI_API_KEY: "gem-1" });
  assert.equal(ai.provider, "nvidia+gemini");
  assert.equal(ai.chat.baseUrl, "https://integrate.api.nvidia.com/v1");
  assert.equal(ai.chat.apiKey, "nvapi-1");
  assert.equal(ai.embed.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
  assert.equal(ai.embed.apiKey, "gem-1");
  assert.equal(ai.embed.inputTypes, false);
  assert.equal(ai.embed.dimensions, 768);
});

test("key precedence: AI_CHAT_API_KEY > provider key > AI_API_KEY", () => {
  const env = { AI_PROVIDER: "gemini", AI_API_KEY: "generic", GEMINI_API_KEY: "specific", AI_CHAT_API_KEY: "chat-only" };
  const ai = resolveAiConfig(env);
  assert.equal(ai.chat.apiKey, "chat-only");
  assert.equal(ai.embed.apiKey, "specific");
  assert.equal(resolveAiConfig({ AI_PROVIDER: "gemini", AI_API_KEY: "generic" }).embed.apiKey, "generic");
});

test("a preset provider ignores AI_BASE_URL with a warning, but a custom provider uses it", () => {
  const bad = resolveAiConfig({ AI_PROVIDER: "nvidia", AI_API_KEY: "k", AI_BASE_URL: "https://api.gemini.com/v1" });
  assert.equal(bad.chat.baseUrl, "https://integrate.api.nvidia.com/v1");
  assert.equal(bad.warnings.length, 1);
  assert.equal(resolveAiConfig({ AI_PROVIDER: "custom", AI_BASE_URL: "http://localhost:1/v1", AI_API_KEY: "k" }).chat.baseUrl, "http://localhost:1/v1");
  assert.throws(() => resolveAiConfig({ AI_CHAT_PROVIDER: "skynet" }), /not valid/);
});

// ---------- embeddings: input_type ----------
test("asymmetric embedding models get input_type=passage for documents and query for searches", async () => {
  const bodies = [];
  const client = createAiClient(cfg({ embed: { provider: "nvidia", baseUrl: "http://x", apiKey: "k", model: "nvidia/nemotron-3-embed-1b", inputTypes: true } }), async (_u, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    return { ok: true, json: async () => ({ data: body.input.map((_, index) => ({ index, embedding: [index] })) }) };
  });

  await client.embed(["stored note"]);
  await client.embed(["user question"], { inputType: "query" });
  assert.equal(bodies[0].input_type, "passage");
  assert.equal(bodies[1].input_type, "query");
  assert.equal(bodies[0].truncate, "END");
  assert.equal(bodies[0].dimensions, undefined);
  assert.equal(client.embedModel, "nvidia/nemotron-3-embed-1b");
});

test("providers without input types never receive the extra fields", async () => {
  let body;
  const client = createAiClient(cfg(), async (_u, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ data: [{ index: 0, embedding: [1] }] }) };
  });
  await client.embed(["x"], { inputType: "query" });
  assert.equal(body.input_type, undefined);
  assert.equal(body.truncate, undefined);
});

// ---------- chat model recovery ----------
test("a retired model (HTTP 404, exactly like gemini-2.5-flash) falls back to the next one and remembers it", async () => {
  const used = [];
  const client = createAiClient(cfg(), async (_u, init) => {
    const { model } = JSON.parse(init.body);
    used.push(model);
    if (model === "primary") return { ok: false, status: 404, text: async () => "This model is no longer available to new users." };
    return { ok: true, json: async () => ({ choices: [{ message: { content: `hello from ${model}` } }] }) };
  });

  assert.equal(await quiet(() => client.chat([{ role: "user", content: "hi" }])), "hello from alt-1");
  assert.deepEqual(used, ["primary", "alt-1"]);
  assert.equal(client.chatModel, "alt-1");

  used.length = 0;
  await client.chat([{ role: "user", content: "again" }]);
  assert.deepEqual(used, ["alt-1"], "the working model is used directly next time");
});

test("when every known model fails it discovers models from /models and tries sensible chat ones", async () => {
  const used = [];
  const client = createAiClient(cfg({ chat: { provider: "x", baseUrl: "http://x", apiKey: "k", model: "dead", maxTokens: 100, fallbackModels: [] } }), async (url, init) => {
    if (String(url).endsWith("/models")) return { ok: true, json: async () => ({ data: [{ id: "models/text-embedding-9" }, { id: "models/nice-flash-latest" }] }) };
    const { model } = JSON.parse(init.body);
    used.push(model);
    return model === "nice-flash-latest"
      ? { ok: true, json: async () => ({ choices: [{ message: { content: "found it" } }] }) }
      : { ok: false, status: 404, text: async () => "gone" };
  });

  assert.equal(await quiet(() => client.chat([{ role: "user", content: "hi" }])), "found it");
  assert.deepEqual(used, ["dead", "nice-flash-latest"], "embedding models must never be tried for chat");
});

test("a rejected API key (401) is not retried or switched to other models: it would fail the same way", async () => {
  let calls = 0;
  const client = createAiClient(cfg(), async () => { calls += 1; return { ok: false, status: 401, text: async () => "bad key" }; });
  await assert.rejects(() => quiet(() => client.chat([{ role: "user", content: "x" }])), /rejected the API key/);
  assert.equal(calls, 1);
});

test("HTTP 503 'high demand' is retried on the same model and succeeds (your exact ai:check failure)", async () => {
  let calls = 0;
  const client = createAiClient(cfg(), async () => {
    calls += 1;
    return calls < 3
      ? { ok: false, status: 503, text: async () => "This model is currently experiencing high demand." }
      : { ok: true, json: async () => ({ choices: [{ message: { content: "recovered" } }] }) };
  });
  assert.equal(await quiet(() => client.chat([{ role: "user", content: "hi" }])), "recovered");
  assert.equal(calls, 3);
  assert.equal(client.chatModel, "primary", "a temporary glitch must not permanently switch models");
});

test("HTTP 429 (Gemini quotas are per model) moves on to the next model", async () => {
  const used = [];
  const client = createAiClient(cfg(), async (_u, init) => {
    const { model } = JSON.parse(init.body);
    used.push(model);
    return model === "primary"
      ? { ok: false, status: 429, text: async () => "quota exceeded" }
      : { ok: true, json: async () => ({ choices: [{ message: { content: `via ${model}` } }] }) };
  });
  assert.equal(await quiet(() => client.chat([{ role: "user", content: "hi" }])), "via alt-1");
  assert.deepEqual(used, ["primary", "alt-1"], "429 is not retried on the same model");
});

test("if the whole primary provider is down, the backup provider answers", async () => {
  const hosts = [];
  const backup = { provider: "gemini", baseUrl: "http://backup", apiKey: "k2", model: "backup-model", maxTokens: 100, fallbackModels: [] };
  const client = createAiClient(cfg({ chatBackup: backup }), async (url, init) => {
    hosts.push(new URL(url).host);
    return url.startsWith("http://backup")
      ? { ok: true, json: async () => ({ choices: [{ message: { content: "backup answered" } }] }) }
      : { ok: false, status: 503, text: async () => "down" };
  });
  assert.equal(await quiet(() => client.chat([{ role: "user", content: "hi" }])), "backup answered");
  assert.ok(hosts.includes("x") && hosts.includes("backup"));
  assert.equal(client.describe().backup, "gemini:backup-model");
});

test("if primary AND backup fail, one clear error explains both", async () => {
  const backup = { provider: "gemini", baseUrl: "http://backup", apiKey: "k2", model: "b", maxTokens: 100, fallbackModels: [] };
  const client = createAiClient(cfg({ chatBackup: backup }), async () => ({ ok: false, status: 503, text: async () => "down" }));
  await assert.rejects(() => quiet(() => client.chat([{ role: "user", content: "x" }])), /Chat failed on x .* and on backup gemini/s);
});

// ---------- Groq ----------
test("groq preset: free chat via gpt-oss, no embeddings of its own", () => {
  const ai = resolveAiConfig({ AI_PROVIDER: "groq", GROQ_API_KEY: "gsk_1" });
  assert.equal(ai.chat.baseUrl, "https://api.groq.com/openai/v1");
  assert.equal(ai.chat.model, "openai/gpt-oss-120b");
  assert.ok(ai.chat.fallbackModels.includes("openai/gpt-oss-20b"));
  assert.equal(ai.embed.model, "", "Groq must never be asked for embeddings");
  assert.match(ai.warnings.join(" "), /no embeddings endpoint/);
});

test("groq + a Gemini key: embeddings automatically go to Gemini, no warning", () => {
  const ai = resolveAiConfig({ AI_PROVIDER: "groq", GROQ_API_KEY: "gsk_1", GEMINI_API_KEY: "g1" });
  assert.equal(ai.embed.provider, "gemini");
  assert.equal(ai.embed.model, "gemini-embedding-001");
  assert.equal(ai.embed.apiKey, "g1");
  assert.equal(ai.chat.apiKey, "gsk_1");
  assert.deepEqual(ai.warnings, []);
});

test("a backup chat provider uses its own key and endpoint, never the primary's", () => {
  const ai = resolveAiConfig({
    AI_CHAT_PROVIDER: "groq", GROQ_API_KEY: "gsk_1", AI_CHAT_API_KEY: "primary-only",
    AI_EMBED_PROVIDER: "gemini", GEMINI_API_KEY: "g1", AI_CHAT_BACKUP_PROVIDER: "gemini"
  });
  assert.equal(ai.chat.apiKey, "primary-only");
  assert.equal(ai.chatBackup.provider, "gemini");
  assert.equal(ai.chatBackup.apiKey, "g1");
  assert.equal(ai.chatBackup.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
  assert.equal(ai.chatBackup.model, "gemini-flash-latest");

  const missingKey = resolveAiConfig({ AI_PROVIDER: "groq", GROQ_API_KEY: "gsk_1", AI_CHAT_BACKUP_PROVIDER: "gemini" });
  assert.equal(missingKey.chatBackup, null);
  assert.match(missingKey.warnings.join(" "), /GEMINI_API_KEY/);
});

test("with no embedding model, embed() fails with a clear message (ask/search then use keyword mode)", async () => {
  const client = createAiClient(cfg({ embed: { provider: "groq", baseUrl: "http://x", apiKey: "k", model: "" } }), async () => { throw new Error("must not be called"); });
  await assert.rejects(() => client.embed(["x"]), /Groq has no embeddings/);
  assert.equal(client.describe().configured, false);
});

test("a 403 that mentions the model is treated as 'not available to your account'", async () => {
  const client = createAiClient(cfg(), async (_u, init) => {
    const { model } = JSON.parse(init.body);
    return model === "primary"
      ? { ok: false, status: 403, text: async () => "Function not found for account: model not entitled" }
      : { ok: true, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
  });
  assert.equal(await quiet(() => client.chat([{ role: "user", content: "x" }])), "ok");
});

test("when nothing works the error lists what was tried and how to fix it", async () => {
  const client = createAiClient(cfg(), async () => ({ ok: false, status: 404, text: async () => "gone" }));
  await assert.rejects(() => quiet(() => client.chat([{ role: "user", content: "x" }])), /tried: primary, alt-1, alt-2/);
});

test("probeChatModels reports which models really work", async () => {
  const client = createAiClient(cfg(), async (url, init) => {
    if (String(url).endsWith("/models")) return { ok: true, json: async () => ({ data: [{ id: "extra-flash" }] }) };
    const { model } = JSON.parse(init.body);
    return model === "alt-2" ? { ok: true, json: async () => ({ choices: [{ message: { content: "OK" } }] }) } : { ok: false, status: 404, text: async () => "no" };
  });
  const results = await quiet(() => client.probeChatModels());
  assert.deepEqual(results.map((r) => [r.model, r.ok]), [["primary", false], ["alt-1", false], ["alt-2", true], ["extra-flash", false]]);
  assert.ok(results.every((r) => r.provider === "x"));
});

test("preferChatModels drops non-chat models and puts -latest aliases first", () => {
  const ordered = preferChatModels(["nvidia/nemotron-3-embed-1b", "z-ai/glm-flux-image", "foo-model", "gemini-flash-latest", "meta/llama-3.1-8b-instruct", "nvidia/llama-nemotron-rerank-1b", "gemma-4-31b-it"]);
  assert.equal(ordered[0], "gemini-flash-latest");
  assert.ok(!ordered.some((m) => /embed|rerank|image/.test(m)));
  assert.ok(ordered.includes("meta/llama-3.1-8b-instruct"));
});

// ---------- Brevo IP block ----------
test("a Brevo 'unrecognised IP' rejection yields an actionable message with the IP and the fix link", async () => {
  const mailer = createMailer({ provider: "brevo", brevoKey: "k", from: { email: "a@b.co", name: "x" } }, async () => ({
    ok: false,
    status: 401,
    text: async () => '{"message":"We have detected you are using an unrecognised IP address 103.103.56.245. If you performed this action make sure to add the new IP address in this link: https://app.brevo.com/security/auth"}'
  }));
  await assert.rejects(
    () => quiet(() => mailer.send({ to: "a@b.co", subject: "s", html: "h", text: "t" })),
    (error) => /103\.103\.56\.245/.test(error.message) && /Authorized IPs/.test(error.message) && /Deactivate blocking/.test(error.message)
  );
});
