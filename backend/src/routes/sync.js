import { Router } from "express";
import { createHash } from "node:crypto";
import { HttpError, asyncHandler } from "../middleware/errors.js";
import { sanitizeSensitiveText } from "../lib/sanitize.js";

const MAX_PROJECTS = 200;
const MAX_ENTRIES = 200;

const text = (value, max) => sanitizeSensitiveText(String(value ?? "")).slice(0, max);
const list = (value, max = 50, itemMax = 100) =>
  Array.isArray(value)
    ? value.filter((v) => typeof v === "string").slice(0, max).map((v) => v.slice(0, itemMax))
    : [];

export function hashEntry(entry) {
  return createHash("sha256")
    .update([entry.title, entry.type, entry.project, entry.content, (entry.tags || []).join(",")].join("|"))
    .digest("hex");
}

export function embeddingText(entry) {
  return `${entry.title}\nType: ${entry.type}\nProject: ${entry.project || "none"}\n${entry.content}`;
}

export function cleanProject(raw) {
  if (!raw || typeof raw.id !== "string") return null;

  return {
    clientId: raw.id.slice(0, 100),
    name: text(raw.name, 200) || "Unnamed project",
    languages: list(raw.languages),
    technologies: list(raw.technologies),
    frameworks: list(raw.frameworks),
    dependencies: list(raw.dependencies, 300),
    databases: list(raw.databases),
    authenticationLibraries: list(raw.authenticationLibraries),
    architecture: list(raw.architecture, 50, 300),
    packageManager: text(raw.packageManager, 30),
    summary: text(raw.summary, 4000),
    analyzedAt: raw.analyzedAt ? new Date(raw.analyzedAt) : undefined
  };
}

export function cleanEntry(raw) {
  if (!raw || typeof raw.id !== "string" || typeof raw.title !== "string" || typeof raw.content !== "string") {
    return null;
  }

  const entry = {
    clientId: raw.id.slice(0, 100),
    projectClientId: typeof raw.projectId === "string" ? raw.projectId.slice(0, 100) : undefined,
    project: text(raw.project, 200) || undefined,
    type: text(raw.type, 60) || "general",
    title: text(raw.title, 300),
    content: text(raw.content, 20000),
    tags: list(raw.tags, 20, 40),
    source: text(raw.source, 30) || undefined,
    sourceFile: text(raw.sourceFile, 300) || undefined,
    sourceLine: Number.isInteger(raw.sourceLine) ? raw.sourceLine : undefined
  };

  if (!entry.title || !entry.content) return null;

  entry.contentHash = hashEntry(entry);

  if (raw.debug && typeof raw.debug === "object") {
    entry.debug = {
      error: text(raw.debug.error, 20000),
      cause: text(raw.debug.cause, 5000),
      solution: text(raw.debug.solution, 10000)
    };
  }

  return entry;
}

export function createSyncRouter({ Project, KnowledgeEntry, DebugEntry, ai }) {
  const router = Router();

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const { projects = [], knowledge = [] } = req.body || {};

      if (!Array.isArray(projects) || !Array.isArray(knowledge)) {
        throw new HttpError(400, "`projects` and `knowledge` must be arrays.");
      }
      if (projects.length > MAX_PROJECTS || knowledge.length > MAX_ENTRIES) {
        throw new HttpError(413, `Send at most ${MAX_PROJECTS} projects and ${MAX_ENTRIES} entries per request.`);
      }

      const userId = req.userId;
      const cleanProjects = projects.map(cleanProject).filter(Boolean);
      const entries = knowledge.map(cleanEntry).filter(Boolean);

      if (cleanProjects.length) {
        await Project.bulkWrite(
          cleanProjects.map((project) => ({
            updateOne: {
              filter: { userId, clientId: project.clientId },
              update: { $set: { ...project, userId } },
              upsert: true
            }
          }))
        );
      }

      const stats = { projects: cleanProjects.length, created: 0, updated: 0, unchanged: 0, embedded: 0, embeddingFailed: 0, skipped: knowledge.length - entries.length };

      if (entries.length) {
        const existing = await KnowledgeEntry.find({
          userId,
          clientId: { $in: entries.map((e) => e.clientId) }
        })
          .select("clientId contentHash embeddingModel")
          .lean();

        const known = new Map(existing.map((doc) => [doc.clientId, doc]));
        const needsEmbedding = [];

        for (const entry of entries) {
          const prior = known.get(entry.clientId);

          if (!prior) stats.created += 1;
          else if (prior.contentHash !== entry.contentHash) stats.updated += 1;
          else stats.unchanged += 1;

          // Re-embed when new, changed, or embedded by a different model (vectors are not comparable across models).
          if (!prior || prior.contentHash !== entry.contentHash || prior.embeddingModel !== ai.embedModel) {
            needsEmbedding.push(entry);
          }
        }

        const vectors = new Map();

        if (needsEmbedding.length) {
          try {
            const result = await ai.embed(needsEmbedding.map(embeddingText));
            needsEmbedding.forEach((entry, i) => vectors.set(entry.clientId, result[i]));
            stats.embedded = vectors.size;
          } catch (error) {
            // Keep the data; embeddings are retried on the next sync.
            stats.embeddingFailed = needsEmbedding.length;
            stats.embeddingError = error.message;
          }
        }

        await KnowledgeEntry.bulkWrite(
          entries.map((entry) => {
            const { debug, ...fields } = entry;
            const set = { ...fields, userId };

            if (vectors.has(entry.clientId)) {
              set.embedding = vectors.get(entry.clientId);
              set.embeddingModel = ai.embedModel;
            }

            return {
              updateOne: {
                filter: { userId, clientId: entry.clientId },
                update: { $set: set },
                upsert: true
              }
            };
          })
        );

        const debugEntries = entries.filter((entry) => entry.debug);

        if (debugEntries.length) {
          await DebugEntry.bulkWrite(
            debugEntries.map((entry) => ({
              updateOne: {
                filter: { userId, knowledgeClientId: entry.clientId },
                update: {
                  $set: { userId, knowledgeClientId: entry.clientId, project: entry.project, tags: entry.tags, ...entry.debug }
                },
                upsert: true
              }
            }))
          );
        }
      }

      res.json(stats);
    })
  );

  // Reindex: re-embed entries whose vectors came from a different/no model (e.g. after switching AI provider).
  router.post(
    "/reindex",
    asyncHandler(async (req, res) => {
      const filter = { userId: req.userId, embeddingModel: { $ne: ai.embedModel } };
      const total = await KnowledgeEntry.countDocuments(filter);
      const stale = await KnowledgeEntry.find(filter).select("clientId title type project content").limit(100).lean();

      if (stale.length === 0) {
        return res.json({ reindexed: 0, remaining: 0, model: ai.embedModel });
      }

      const vectors = await ai.embed(stale.map(embeddingText));

      await KnowledgeEntry.bulkWrite(
        stale.map((entry, i) => ({
          updateOne: {
            filter: { userId: req.userId, clientId: entry.clientId },
            update: { $set: { embedding: vectors[i], embeddingModel: ai.embedModel } }
          }
        }))
      );

      res.json({ reindexed: stale.length, remaining: Math.max(total - stale.length, 0), model: ai.embedModel });
    })
  );

  // Prune: make the cloud mirror this machine by deleting entries whose id is not in keepIds.
  router.post(
    "/prune",
    asyncHandler(async (req, res) => {
      const { keepIds } = req.body || {};

      if (!Array.isArray(keepIds) || keepIds.some((id) => typeof id !== "string")) {
        throw new HttpError(400, "`keepIds` must be an array of strings.");
      }
      if (keepIds.length === 0) {
        throw new HttpError(400, "Refusing to prune with an empty keep-list (that would delete everything).");
      }

      const filter = { userId: req.userId, clientId: { $nin: keepIds } };
      const result = await KnowledgeEntry.deleteMany(filter);
      await DebugEntry.deleteMany({ userId: req.userId, knowledgeClientId: { $nin: keepIds } });

      res.json({ deleted: result.deletedCount || 0 });
    })
  );

  // Pull: every entry the user owns (without embeddings) so a second machine can merge.
  router.get(
    "/pull",
    asyncHandler(async (req, res) => {
      const rows = await KnowledgeEntry.find({ userId: req.userId }).limit(10000).lean();

      res.json({
        knowledge: rows.map((row) => ({
          id: row.clientId,
          projectId: row.projectClientId,
          project: row.project,
          type: row.type,
          title: row.title,
          content: row.content,
          tags: row.tags,
          source: row.source,
          sourceFile: row.sourceFile,
          sourceLine: row.sourceLine,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        }))
      });
    })
  );

  return router;
}
