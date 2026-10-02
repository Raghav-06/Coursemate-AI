import fs from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { notebooksRouter } from "./routes/notebooks.routes.js";
import { sourcesRouter } from "./routes/sources.routes.js";
import { arxivRouter } from "./routes/arxiv.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { configurePassport, googleConfigured } from "./auth/passport.js";
import { pool } from "./db/pool.js";
import { emailConfigured } from "./services/mailer.js";
import { config } from "./config/index.js";

export function createApp() {
  const app = express();
  const { auth } = config;
  if (config.isProduction && !auth.sessionSecret) throw new Error("SESSION_SECRET must be set in production.");

  // Behind a reverse proxy (Render, Railway, Nginx…) so secure cookies work.
  if (config.isProduction) app.set("trust proxy", 1);

  // Cookies must travel with API calls, so CORS names the client origin
  // explicitly. (In dev, Vite proxies /api and /auth, so calls are same-origin.)
  app.use(cors({ origin: config.clientUrl, credentials: true }));
  app.use(express.json({ limit: "10mb" }));

  // Sessions are stored in Postgres (user_sessions table).
  const PgStore = connectPgSimple(session);
  app.use(
    session({
      name: auth.cookieName,
      secret: auth.sessionSecret || "dev-only-insecure-secret-change-me",
      store: new PgStore({ pool, tableName: "user_sessions" }),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: auth.cookieSecure,
        sameSite: auth.cookieSameSite,
        maxAge: auth.sessionMaxAgeDays * 24 * 60 * 60 * 1000,
      },
    })
  );

  const passport = configurePassport();
  app.use(passport.initialize());
  app.use(passport.session());

  app.get("/health", (req, res) =>
    res.json({
      status: "ok",
      aiProvider: config.ai.provider,
      apiKeyConfigured: Boolean(config.ai.apiKey),
      apiKeyName: config.ai.apiKeyName,
      chatModel: config.ai.chatModel,
      googleAuthConfigured: googleConfigured(),
      emailConfigured: emailConfigured(),
      maxSources: config.limits.sourcesPerNotebook,
    })
  );

  app.use("/auth", authRouter);

  // Everything under /api needs a signed-in user.
  app.use("/api", requireAuth);
  app.use("/api/notebooks", notebooksRouter);
  app.use("/api/sources", sourcesRouter);
  app.use("/api/arxiv", arxivRouter);
  app.use("/api", (_req, res) => res.status(404).json({ message: "Not found." }));

  // Production: serve the built React app from the same origin.
  const indexHtml = path.join(config.paths.clientDist, "index.html");
  if (config.isProduction && fs.existsSync(indexHtml)) {
    app.use(express.static(config.paths.clientDist));
    app.get("*", (_req, res) => res.sendFile(indexHtml));
  }

  app.use((_req, res) => res.status(404).json({ message: "Not found." }));
  app.use(errorHandler);

  return app;
}
