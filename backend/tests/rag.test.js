import { test } from "node:test";
import assert from "node:assert/strict";
import { answerQuestion, isSmallTalk, needsPortfolio, plainText, citedSources } from "../src/services/rag.js";
import { hybridRank, keywordScore, tokenize } from "../src/services/retrieval.js";
import { buildRagMessages, RAG_SYSTEM_PROMPT } from "../src/services/prompts.js";

const profile = (project, text) => ({ id: `p-${project}`, project, type: "project-profile", title: `${project} — technology profile`, content: text, tags: [], score: 1 });
const PROFILES = [
  profile("FindIt", "FindIt — technology profile.\nDatabases: PostgreSQL (via Prisma ORM)"),
  profile("Shortify", "Shortify — technology profile.\nDatabases: MongoDB (via Mongoose ODM)"),
  profile("Wanderlust", "Wanderlust — technology profile.\nDatabases: MongoDB (via Mongoose ODM)")
];

test("small talk is answered locally with the user's projects and example questions (no AI call, no sources)", async () => {
  let chatCalls = 0;
  const ai = { embed: async () => { throw new Error("must not embed"); }, chat: async () => { chatCalls++; return "x"; } };
  for (const greeting of ["hii", "Hello!", "hey", "thanks", "good morning"]) {
    assert.equal(isSmallTalk(greeting), true, greeting);
  }
  const result = await answerQuestion({ ai, retrieve: async () => [], listProfiles: async () => PROFILES, userId: "u", question: "hii" });
  assert.equal(chatCalls, 0);
  assert.match(result.answer, /FindIt, Shortify, Wanderlust/);
  assert.match(result.answer, /Which databases have I used/);
  assert.deepEqual(result.sources, []);
  assert.equal(result.smalltalk, true);
});

test("real questions are never mistaken for small talk", () => {
  for (const q of ["hi, which databases do I use?", "help me fix mongodb connection errors", "test results for FindIt"]) {
    assert.equal(isSmallTalk(q), false, q);
  }
});

test("portfolio questions are detected, narrow questions are not", () => {
  for (const q of [
    "which databases have i used in my all projects?",
    "have i used postgres in any project",
    "have i used mongoDb in any of my project? if yes then tell me how it works?",
    "compare the frameworks across my projects",
    "list all my projects"
  ]) assert.equal(needsPortfolio(q), true, q);

  for (const q of ["how did I fix the CORS error?", "explain the auth flow in FindIt", "what is a closure"]) {
    assert.equal(needsPortfolio(q), false, q);
  }
});

test("the exact failing questions from the screenshots now receive every project's profile", async () => {
  let seen;
  const ai = {
    embed: async () => [[1]],
    chat: async (messages) => { seen = messages[1].content; return "FindIt uses PostgreSQL [1]. Shortify and Wanderlust use MongoDB [2][3]."; }
  };
  // Similarity search alone returns irrelevant snippets, exactly like the screenshots.
  const noisy = [{ id: "n1", project: "sample-project", type: "project-documentation", title: "sample-project — README notes", content: "readme", score: 0.5 }];

  const result = await answerQuestion({ ai, retrieve: async () => noisy, listProfiles: async () => PROFILES, userId: "u", question: "have i used postgres in any project if yes tell me how it works?" });

  for (const name of ["FindIt", "Shortify", "Wanderlust"]) assert.match(seen, new RegExp(`${name} — technology profile`));
  assert.match(seen, /PostgreSQL \(via Prisma ORM\)/);
  assert.match(result.answer, /FindIt uses PostgreSQL/);
  assert.deepEqual(result.sources.map((s) => s.ref), [1, 2, 3]);
  assert.ok(!result.sources.some((s) => s.project === "sample-project"), "irrelevant snippets must not be shown as sources");
});

test("only the sources the answer cites are returned, keeping the citation numbers", () => {
  const sources = [{ title: "a" }, { title: "b" }, { title: "c" }, { title: "d" }];
  const cited = citedSources("Uses b [2] and d [4][2].", sources);
  assert.deepEqual(cited.map((s) => [s.ref, s.title]), [[2, "b"], [4, "d"]]);
  assert.deepEqual(citedSources("No citations here.", sources), []);
});

test("markdown from the model is flattened to plain text (no stray ** in the UI)", () => {
  assert.equal(plainText("Uses **Prisma ORM** with `pg`.\n# Heading\n* item"), "Uses Prisma ORM with pg.\nHeading\n- item");
});

test("the system prompt demands per-project coverage, citations, plain text and no 'provide files' replies", () => {
  assert.match(RAG_SYSTEM_PROMPT, /go through EVERY project profile/);
  assert.match(RAG_SYSTEM_PROMPT, /never ask the user to "provide files"/);
  assert.match(RAG_SYSTEM_PROMPT, /Do not use markdown/);
  assert.match(buildRagMessages("q", [{ title: "t", type: "project-profile", content: "c" }])[1].content, /Type: project-profile/);
});

// ---------- retrieval quality ----------
test("typing 'postgre' or 'pg' finds PostgreSQL entries; 'mongo' finds MongoDB", () => {
  const doc = { title: "FindIt — uses PostgreSQL (database)", content: "accessed via Prisma", tags: ["database", "postgresql"], type: "database", project: "FindIt" };
  const mongo = { title: "Shortify — technology profile", content: "Databases: MongoDB (via Mongoose ODM)", tags: [], type: "project-profile", project: "Shortify" };

  assert.ok(keywordScore(tokenize("have i used postgre"), doc).coverage > 0);
  assert.ok(keywordScore(["pg"], doc).coverage > 0);
  assert.ok(keywordScore(["mongo"], mongo).coverage > 0);
  assert.equal(keywordScore(["kubernetes"], doc).coverage, 0);
});

test("with a high embedding baseline, semantic-only matches far below the best one are dropped", () => {
  const q = [1, 0];
  const mk = (id, sim) => ({ id, title: id, content: "", tags: [], type: "x", embedding: [sim, Math.sqrt(1 - sim * sim)] });
  const docs = [mk("best", 0.9), mk("close", 0.85), mk("baseline-noise", 0.58), mk("noise2", 0.55)];
  const ranked = hybridRank(q, "zzz", docs, { limit: 10, minScore: 0.5 });
  assert.deepEqual(ranked.map((r) => r.doc.id), ["best", "close"]);
});
