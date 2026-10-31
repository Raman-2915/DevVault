import mongoose from "mongoose";

export function cosine(a, b) {
  if (!a?.length || a.length !== b?.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

export function rankBySimilarity(queryVector, docs, { limit = 5, minScore = 0 } = {}) {
  return docs
    .map((doc) => ({ doc, score: cosine(queryVector, doc.embedding) }))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------- Hybrid ranking: semantic + keyword, merged with Reciprocal Rank Fusion ----------

const STOP_WORDS = new Set(
  "a an and are as at be by did do does for from have how i in is it me my of on or our that the this to use used using was what when where which who why with"
    .split(" ")
);

export function tokenize(text) {
  return [...new Set(
    String(text ?? "")
      .toLowerCase()
      .split(/[^a-z0-9_+#.]+/)
      .map((term) => term.replace(/^\.+|\.+$/g, ""))
      .filter((term) => term.length >= 2 && !STOP_WORDS.has(term))
  )];
}

// People type "postgre", "pg", "mongo", "db"; the stored text says "PostgreSQL", "MongoDB", "database".
const ALIASES = {
  postgres: ["postgresql"], postgre: ["postgresql"], pg: ["postgresql"], psql: ["postgresql"], pgsql: ["postgresql"],
  mongo: ["mongodb", "mongoose"], mongoose: ["mongodb"], db: ["database"], dbs: ["database"], databases: ["database"],
  js: ["javascript"], ts: ["typescript"], auth: ["authentication"], login: ["authentication"], orm: ["orm", "odm"],
  node: ["node.js", "express"], nodejs: ["express"], k8s: ["kubernetes"], sql: ["sql", "mysql", "postgresql", "sqlite"]
};

export function variantsOf(term) {
  return [term, ...(ALIASES[term] || [])];
}

export function keywordScore(terms, doc) {
  if (!terms.length) return { score: 0, coverage: 0 };

  const fields = [
    [String(doc.title ?? "").toLowerCase(), 3],
    [(doc.tags || []).join(" ").toLowerCase(), 2],
    [String(doc.project ?? "").toLowerCase(), 2],
    [String(doc.type ?? "").toLowerCase(), 2],
    [String(doc.content ?? "").toLowerCase(), 1]
  ];

  let score = 0;
  let matched = 0;

  for (const term of terms) {
    let hit = false;

    for (const variant of variantsOf(term)) {
      for (const [text, weight] of fields) {
        if (text.includes(variant)) {
          score += weight;
          hit = true;
        }
      }
    }

    if (hit) matched += 1;
  }

  return { score, coverage: matched / terms.length };
}

const RRF_K = 60;

export function hybridRank(queryVector, queryText, docs, { limit = 5, minScore = 0.25, minCoverage = 0.5, spread = 0.12 } = {}) {
  const terms = tokenize(queryText);

  const scored = docs.map((doc) => {
    const semantic = cosine(queryVector, doc.embedding);
    const keyword = keywordScore(terms, doc);
    return { doc, semantic, keyword: keyword.score, coverage: keyword.coverage };
  });

  const bySemantic = [...scored].sort((a, b) => b.semantic - a.semantic);
  const byKeyword = scored.filter((item) => item.keyword > 0).sort((a, b) => b.keyword - a.keyword);

  const fused = new Map();
  bySemantic.forEach((item, rank) => fused.set(item, 1 / (RRF_K + rank + 1)));
  byKeyword.forEach((item, rank) => fused.set(item, (fused.get(item) || 0) + 1 / (RRF_K + rank + 1)));

  // Embedding models give unrelated text a high baseline score (Gemini: ~0.5), so an absolute threshold is not
  // enough: semantic-only matches must also be close to the best semantic match.
  const best = Math.max(0, ...scored.map((item) => item.semantic));
  const semanticFloor = Math.max(minScore, best - spread);

  return scored
    .filter((item) => item.semantic >= semanticFloor || item.coverage >= minCoverage)
    .map((item) => ({
      ...item,
      fused: fused.get(item),
      matchedBy:
        item.semantic >= semanticFloor && item.coverage >= minCoverage
          ? "both"
          : item.semantic >= semanticFloor
            ? "semantic"
            : "keyword"
    }))
    .sort((a, b) => b.fused - a.fused)
    .slice(0, limit);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Only plain strings are accepted, so request bodies can never inject Mongo operators.
export function buildFilter(userId, { project, type } = {}) {
  const filter = { userId };

  if (typeof project === "string" && project.trim()) {
    filter.project = new RegExp(`^${escapeRegex(project.trim())}$`, "i");
  }

  if (typeof type === "string" && type.trim()) {
    filter.type = type.trim();
  }

  return filter;
}

const PUBLIC_FIELDS = "clientId project type title content tags source sourceFile sourceLine";

function toSource(item) {
  const { doc } = item;
  const score = item.semantic ?? item.score ?? 0;

  return {
    id: doc.clientId,
    project: doc.project,
    type: doc.type,
    title: doc.title,
    content: doc.content,
    tags: doc.tags,
    sourceFile: doc.sourceFile,
    sourceLine: doc.sourceLine,
    score: Number(score.toFixed(4)),
    matchedBy: item.matchedBy || "semantic"
  };
}

export function createRetriever({ KnowledgeEntry, atlasVectorIndex = "", minScore = 0.25 }) {
  return async function retrieve({ userId, queryVector, queryText = "", filters = {}, limit = 5 }) {
    const filter = buildFilter(userId, filters);

    if (atlasVectorIndex && queryVector) {
      // Atlas Vector Search (semantic only); userId/project/type must be filter fields in the index.
      const ownerId = new mongoose.Types.ObjectId(String(userId));
      filter.userId = ownerId;

      const rows = await KnowledgeEntry.aggregate([
        {
          $vectorSearch: {
            index: atlasVectorIndex,
            path: "embedding",
            queryVector,
            numCandidates: Math.max(limit * 20, 100),
            limit,
            filter: { userId: { $eq: ownerId } }
          }
        },
        { $addFields: { _score: { $meta: "vectorSearchScore" } } },
        { $match: filter },
        { $project: { embedding: 0 } }
      ]);

      return rows
        .map((doc) => ({ doc, semantic: doc._score }))
        .filter((item) => item.semantic >= minScore)
        .map(toSource);
    }

    // Entries without embeddings stay searchable by keyword (e.g. embedding quota hit during sync).
    const candidates = await KnowledgeEntry.find(filter)
      .select(`${PUBLIC_FIELDS} +embedding`)
      .limit(5000)
      .lean();

    return hybridRank(queryVector, queryText, candidates, { limit, minScore }).map(toSource);
  };
}

// One technology profile per project: always given to the AI for portfolio-wide questions
// ("which databases have I used across my projects?"), because similarity search alone can't cover every project.
export function createProfileLister({ KnowledgeEntry }) {
  return async function listProfiles({ userId, filters = {} }) {
    const filter = buildFilter(userId, filters);
    filter.type = "project-profile";

    const rows = await KnowledgeEntry.find(filter).select(PUBLIC_FIELDS).limit(40).lean();
    return rows.map((doc) => toSource({ doc, semantic: 1, matchedBy: "profile" }));
  };
}
