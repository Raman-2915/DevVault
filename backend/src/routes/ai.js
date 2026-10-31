import { Router } from "express";
import { HttpError, asyncHandler } from "../middleware/errors.js";
import { answerQuestion, embedQuery } from "../services/rag.js";
import { buildDebugMessages, parseStructuredDebug, buildComposeMessages, COMPOSE_PROMPTS } from "../services/prompts.js";
import { sanitizeSensitiveText } from "../lib/sanitize.js";

function readQuestion(body, key) {
  const value = body?.[key];

  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `\`${key}\` is required.`);
  }
  if (value.length > 1000) {
    throw new HttpError(400, `\`${key}\` is too long (max 1000 characters).`);
  }

  return value.trim();
}

function readLimit(body, fallback) {
  const limit = Number(body?.limit ?? fallback);
  return Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 20) : fallback;
}

export function createAiRouter({ ai, retrieve, listProfiles, SearchHistory }) {
  const router = Router();

  const filtersFrom = (body) => ({ project: body?.project, type: body?.type });

  router.post(
    "/search",
    asyncHandler(async (req, res) => {
      const query = readQuestion(req.body, "query");
      const { vector: queryVector, notice } = await embedQuery(ai, query);
      const results = await retrieve({
        userId: req.userId,
        queryVector,
        queryText: query,
        filters: filtersFrom(req.body),
        limit: readLimit(req.body, 10)
      });

      await SearchHistory.create({ userId: req.userId, query, mode: "semantic", resultCount: results.length });
      res.json({ results, degraded: Boolean(notice), notice });
    })
  );

  router.post(
    "/ask",
    asyncHandler(async (req, res) => {
      const question = readQuestion(req.body, "question");
      const result = await answerQuestion({
        ai,
        retrieve,
        listProfiles,
        userId: req.userId,
        question,
        filters: filtersFrom(req.body),
        limit: readLimit(req.body, 6)
      });

      await SearchHistory.create({ userId: req.userId, query: question, mode: "ask", resultCount: result.sources.length });
      res.json(result);
    })
  );

  router.post(
    "/compose",
    asyncHandler(async (req, res) => {
      const { kind, facts } = req.body || {};

      if (typeof kind !== "string" || !Object.hasOwn(COMPOSE_PROMPTS, kind)) {
        throw new HttpError(400, `\`kind\` must be one of: ${Object.keys(COMPOSE_PROMPTS).join(", ")}.`);
      }
      if (typeof facts !== "string" || !facts.trim() || facts.length > 20000) {
        throw new HttpError(400, "`facts` is required (max 20000 characters).");
      }

      const text = await ai.chat(buildComposeMessages(kind, sanitizeSensitiveText(facts)));
      res.json({ text });
    })
  );

  router.post(
    "/debug/structure",
    asyncHandler(async (req, res) => {
      const error = readQuestion(req.body, "error");
      const project = typeof req.body.project === "string" ? req.body.project.slice(0, 200) : "";
      const notes = typeof req.body.notes === "string" ? req.body.notes.slice(0, 2000) : "";

      // Stack traces often embed tokens/connection strings: sanitize before leaving the server.
      const raw = await ai.chat(
        buildDebugMessages({
          error: sanitizeSensitiveText(req.body.error),
          notes: sanitizeSensitiveText(notes),
          project
        })
      );

      try {
        res.json({ structured: parseStructuredDebug(raw) });
      } catch {
        throw new HttpError(502, "The AI response could not be understood. Please try again.");
      }
    })
  );

  return router;
}
