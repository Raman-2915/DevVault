import { test } from "node:test";
import assert from "node:assert/strict";
import { answerQuestion } from "../src/services/rag.js";
import { hybridRank } from "../src/services/retrieval.js";
import { createAiClient, AiError } from "../src/services/ai.js";

const docs = [
  { clientId: "a", title: "Shortify — JWT authentication", content: "jwt.sign in auth.js", tags: ["jwt"], type: "authentication", project: "Shortify" },
  { clientId: "b", title: "Render deploy", content: "render.yaml", tags: [], type: "deployment", project: "Shortify" }
];
const keywordRetrieve = async ({ queryVector, queryText }) =>
  hybridRank(queryVector, queryText, docs, { limit: 5, minScore: 0.25 }).map((r) => ({ ...r.doc, id: r.doc.clientId, score: 0, matchedBy: r.matchedBy }));

test("entries with no embedding are still found by keyword when the query has no vector", () => {
  const ranked = hybridRank(null, "where is jwt used", docs, { minScore: 0.25 });
  assert.deepEqual(ranked.map((r) => r.doc.clientId), ["a"]);
  assert.equal(ranked[0].matchedBy, "keyword");
});

test("ask still answers from keyword matches when embeddings are down", async () => {
  const ai = { embed: async () => { throw new AiError("quota"); }, chat: async () => "You used JWT in Shortify [1]." };
  const result = await answerQuestion({ ai, retrieve: keywordRetrieve, userId: "u", question: "where is jwt used" });
  assert.equal(result.grounded, true);
  assert.equal(result.degraded, true);
  assert.match(result.notice, /keyword matching/);
  assert.match(result.answer, /JWT/);
});

test("when the chat model is down, ask returns the matching entries instead of failing", async () => {
  const ai = { embed: async () => [[1]], chat: async () => { throw new AiError("HTTP 429"); } };
  const result = await answerQuestion({ ai, retrieve: keywordRetrieve, userId: "u", question: "jwt" });
  assert.equal(result.degraded, true);
  assert.match(result.answer, /closest entries/);
  assert.match(result.answer, /Shortify — JWT authentication/);
  assert.equal(result.sources.length, 1);
});

test("a provider that rejects `dimensions` is retried without it and the model tag updates", async () => {
  const bodies = [];
  const client = createAiClient(
    { provider: "x", chat: { baseUrl: "http://x", apiKey: "k", model: "c", maxTokens: 10 }, embed: { baseUrl: "http://x", apiKey: "k", model: "e", dimensions: 768 }, chatExtraBody: {} },
    async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      if (body.dimensions) return { ok: false, status: 400, text: async () => "dimensions not supported" };
      return { ok: true, json: async () => ({ data: body.input.map((_, index) => ({ index, embedding: [index, 1] })) }) };
    }
  );
  assert.equal(client.embedModel, "e@768");
  const vectors = await client.embed(["a", "b"]);
  assert.equal(vectors.length, 2);
  assert.equal(client.embedModel, "e", "tag must no longer claim 768 dims");
  assert.ok(bodies.at(-1).dimensions === undefined);
});

test("listModels strips the models/ prefix and tolerates failures", async () => {
  const ok = createAiClient(
    { provider: "x", chat: { baseUrl: "http://x", apiKey: "k", model: "c" }, embed: { baseUrl: "http://x", apiKey: "k", model: "e" }, chatExtraBody: {} },
    async () => ({ ok: true, json: async () => ({ data: [{ id: "models/gemini-2.5-flash" }, { id: "models/gemini-embedding-001" }] }) })
  );
  assert.deepEqual(await ok.listModels(), ["gemini-2.5-flash", "gemini-embedding-001"]);

  const down = createAiClient(
    { provider: "x", chat: { baseUrl: "http://x", apiKey: "k", model: "c" }, embed: { baseUrl: "http://x", apiKey: "k", model: "e" }, chatExtraBody: {} },
    async () => { throw new Error("network"); }
  );
  assert.deepEqual(await down.listModels(), []);
});
