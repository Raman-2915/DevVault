import fs from "node:fs";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

import { requireAuth } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errors.js";
import { createAuthRouter } from "./routes/auth.js";
import { createSyncRouter } from "./routes/sync.js";
import { createAiRouter } from "./routes/ai.js";
import { createDataRouter } from "./routes/data.js";
import { createMailer } from "./services/email.js";
import { AiError } from "./services/ai.js";

export function createApp({ config, models, ai, retrieve, listProfiles, mailer }) {
  const app = express();

  app.set("trust proxy", 1); // Render sits behind a proxy
  // helmet's default CSP adds `upgrade-insecure-requests`, which breaks plain-http localhost in some browsers.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), "upgrade-insecure-requests": null }
      }
    })
  );
  app.use(cors({ exposedHeaders: ["X-DevVault-Token"] }));
  app.use(express.json({ limit: "2mb" }));

  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: config.rateLimits?.auth ?? 60, standardHeaders: true, legacyHeaders: false });
  const aiLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
  const syncLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });

  const rateLimits = config.rateLimits || {};
  const sensitiveLimiter = rateLimit({ windowMs: 15 * 60_000, limit: rateLimits.sensitive ?? 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many attempts. Please wait a few minutes." } });
  const emailConfig = config.email || { required: false, appUrl: "http://localhost:5000", provider: "console" };
  const mail = mailer || createMailer(emailConfig);

  const jwtConfig = { secret: config.jwtSecret, expiresIn: config.jwtExpiresIn };
  const auth = requireAuth(config.jwtSecret, models.User, jwtConfig);

  app.get("/api/health", (_req, res) => res.json({ status: "ok", ai: ai.describe?.() }));

  app.use("/api/auth", authLimiter, createAuthRouter({ User: models.User, jwtConfig, mailer: mail, emailConfig, limiters: { sensitive: sensitiveLimiter } }));
  app.use("/api/sync", auth, syncLimiter, createSyncRouter({ ...models, ai }));
  app.use("/api", auth, createDataRouter(models));
  app.use("/api", auth, aiLimiter, createAiRouter({ ai, retrieve, listProfiles, SearchHistory: models.SearchHistory }));

  // Serve the built React dashboard (dashboard/dist) from the same origin, if present.
  const dashboardIndex = config.dashboardDir && path.join(config.dashboardDir, "index.html");

  if (dashboardIndex && fs.existsSync(dashboardIndex)) {
    app.use(express.static(config.dashboardDir));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(dashboardIndex));
  }

  app.use((_req, res) => res.status(404).json({ error: "Not found." }));

  app.use((error, req, res, next) => {
    if (error instanceof AiError) {
      return res.status(error.status).json({ error: error.message });
    }
    errorHandler(error, req, res, next);
  });

  return app;
}
