import { Router } from "express";
import bcrypt from "bcryptjs";
import { HttpError, asyncHandler } from "../middleware/errors.js";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const str = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

function present(row) {
  return {
    id: row.clientId,
    project: row.project,
    type: row.type,
    title: row.title,
    content: row.content,
    tags: row.tags || [],
    source: row.source,
    sourceFile: row.sourceFile,
    sourceLine: row.sourceLine,
    embedded: Boolean(row.embeddingModel),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function countBy(rows, getKeys) {
  const counts = new Map();

  for (const row of rows) {
    for (const key of getKeys(row)) {
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function createDataRouter({ User, Project, KnowledgeEntry, DebugEntry, SearchHistory }) {
  const router = Router();

  router.get(
    "/me",
    asyncHandler(async (req, res) => {
      const user = await User.findOne({ _id: req.userId });
      if (!user) throw new HttpError(401, "Account no longer exists.");
      res.json({ user: { id: String(user._id), name: user.name, email: user.email } });
    })
  );

  // Permanently delete the account and everything stored for it.
  router.delete(
    "/me",
    asyncHandler(async (req, res) => {
      const password = req.body?.password;
      if (typeof password !== "string") throw new HttpError(400, "Your password is required to delete the account.");

      const user = await User.findOne({ _id: req.userId }).select("+passwordHash");
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new HttpError(401, "Incorrect password.");

      const owner = { userId: req.userId };
      await Promise.all([
        KnowledgeEntry.deleteMany(owner),
        Project.deleteMany(owner),
        DebugEntry.deleteMany(owner),
        SearchHistory.deleteMany(owner)
      ]);
      await User.deleteOne({ _id: req.userId });

      res.json({ deleted: true });
    })
  );

  router.get(
    "/knowledge",
    asyncHandler(async (req, res) => {
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const filter = { userId: req.userId };

      // Query-string values are only honoured when they are plain strings.
      if (str(req.query.project)) filter.project = new RegExp(`^${escapeRegex(str(req.query.project))}$`, "i");
      if (str(req.query.type)) filter.type = str(req.query.type);
      if (str(req.query.tag)) filter.tags = str(req.query.tag);

      if (str(req.query.q)) {
        const pattern = new RegExp(escapeRegex(str(req.query.q).slice(0, 100)), "i");
        filter.$or = [{ title: pattern }, { content: pattern }, { tags: pattern }];
      }

      const [total, rows] = await Promise.all([
        KnowledgeEntry.countDocuments(filter),
        KnowledgeEntry.find(filter)
          .select("-embedding")
          .sort({ updatedAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean()
      ]);

      res.json({ items: rows.map(present), total, page, pages: Math.max(Math.ceil(total / limit), 1) });
    })
  );

  router.get(
    "/knowledge/:id",
    asyncHandler(async (req, res) => {
      const row = await KnowledgeEntry.findOne({ userId: req.userId, clientId: String(req.params.id) })
        .select("-embedding")
        .lean();
      if (!row) throw new HttpError(404, "Entry not found.");
      res.json({ entry: present(row) });
    })
  );

  router.delete(
    "/knowledge/:id",
    asyncHandler(async (req, res) => {
      const clientId = String(req.params.id);
      const result = await KnowledgeEntry.deleteOne({ userId: req.userId, clientId });
      if (!result.deletedCount) throw new HttpError(404, "Entry not found.");
      await DebugEntry.deleteMany({ userId: req.userId, knowledgeClientId: clientId });
      res.json({ deleted: true });
    })
  );

  router.get(
    "/projects",
    asyncHandler(async (req, res) => {
      const [projects, entries] = await Promise.all([
        Project.find({ userId: req.userId }).sort({ analyzedAt: -1 }).lean(),
        KnowledgeEntry.find({ userId: req.userId }).select("project").lean()
      ]);

      const entryCounts = new Map(countBy(entries, (e) => [e.project]).map((c) => [c.name, c.count]));

      res.json({
        projects: projects.map((p) => ({
          id: p.clientId,
          name: p.name,
          languages: p.languages,
          technologies: p.technologies,
          frameworks: p.frameworks,
          databases: p.databases,
          authenticationLibraries: p.authenticationLibraries,
          architecture: p.architecture,
          packageManager: p.packageManager,
          summary: p.summary,
          analyzedAt: p.analyzedAt,
          entryCount: entryCounts.get(p.name) || 0
        }))
      });
    })
  );

  // Removes a project, all knowledge entries filed under it, and its debugging history.
  router.delete(
    "/projects/:id",
    asyncHandler(async (req, res) => {
      const clientId = String(req.params.id);
      const project = await Project.findOne({ userId: req.userId, clientId }).lean();
      if (!project) throw new HttpError(404, "Project not found.");

      const owner = { userId: req.userId };
      const entries = await KnowledgeEntry.deleteMany({ ...owner, $or: [{ projectClientId: clientId }, { project: project.name }] });
      await DebugEntry.deleteMany({ ...owner, project: project.name });
      await Project.deleteOne({ ...owner, clientId });

      res.json({ deleted: true, entries: entries.deletedCount || 0 });
    })
  );

  router.get(
    "/stats",
    asyncHandler(async (req, res) => {
      const [entries, projects, recent] = await Promise.all([
        KnowledgeEntry.find({ userId: req.userId }).select("project type tags embeddingModel").limit(20000).lean(),
        Project.find({ userId: req.userId }).select("name languages frameworks databases").lean(),
        SearchHistory.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(10).lean()
      ]);

      res.json({
        totals: {
          entries: entries.length,
          projects: projects.length,
          embedded: entries.filter((e) => e.embeddingModel).length
        },
        technology: {
          languages: countBy(projects, (p) => p.languages || []).slice(0, 8),
          frameworks: countBy(projects, (p) => p.frameworks || []).slice(0, 10),
          // "PostgreSQL (Prisma ORM)" counts as PostgreSQL
          databases: countBy(projects, (p) => (p.databases || []).map((d) => String(d).replace(/\s*\(.*\)\s*$/, ""))).slice(0, 8)
        },
        byType: countBy(entries, (e) => [e.type]),
        byProject: countBy(entries, (e) => [e.project]),
        topTags: countBy(entries, (e) => e.tags || []).slice(0, 20),
        recentSearches: recent.map((r) => ({ query: r.query, mode: r.mode, resultCount: r.resultCount, createdAt: r.createdAt }))
      });
    })
  );

  return router;
}
