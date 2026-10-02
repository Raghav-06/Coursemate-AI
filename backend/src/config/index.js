import "dotenv/config";
import path from "node:path";

const root = process.cwd();
const bool = (v, fallback = false) => (v === undefined || v === "" ? fallback : /^(1|true|yes|on)$/i.test(v));
const num = (v, fallback) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? fallback : Number(v));

const isProduction = process.env.NODE_ENV === "production";

// ---- AI (any provider via LangChain) -------------------------------------------
// Chat talks to any OpenAI-compatible API (OpenAI, Anthropic, Gemini, Groq,
// OpenRouter, Mistral, Together, DeepSeek, Hugging Face, Ollama…). Embeddings
// use an OpenAI-compatible API too, or Hugging Face's feature-extraction API.
// See src/services/llm.js and embeddings.js.
const trimSlash = (v) => (v ? v.replace(/\/+$/, "") : v);
const optNum = (v) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? undefined : Number(v));
// Local servers (Ollama, LM Studio, vLLM…) usually don't need an API key.
const isLocal = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)(:|\/|$)/i.test(url ?? "");
const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

const chatBaseUrl = trimSlash(process.env.CHAT_BASE_URL) || "https://api.openai.com/v1";
const chatApiKey = process.env.CHAT_API_KEY || (isLocal(chatBaseUrl) ? "not-needed" : undefined);

const embeddingProvider = (process.env.EMBEDDING_PROVIDER || "openai").toLowerCase();
const embeddingBaseUrl =
  trimSlash(process.env.EMBEDDING_BASE_URL) || (embeddingProvider === "openai" ? chatBaseUrl : undefined);
const embeddingApiKey =
  process.env.EMBEDDING_API_KEY ||
  process.env.CHAT_API_KEY ||
  (embeddingProvider === "openai" && isLocal(embeddingBaseUrl) ? "not-needed" : undefined);

const ai = {
  provider: hostOf(chatBaseUrl),
  // Reported to the UI when a key is missing.
  apiKey: chatApiKey && embeddingApiKey ? chatApiKey : undefined,
  apiKeyName: !chatApiKey ? "CHAT_API_KEY" : "EMBEDDING_API_KEY",
  chat: {
    apiKey: chatApiKey,
    baseUrl: chatBaseUrl,
    model: process.env.CHAT_MODEL || "gpt-4o-mini",
    // Empty = let the provider decide (some reasoning models reject these).
    temperature: optNum(process.env.CHAT_TEMPERATURE),
    maxTokens: optNum(process.env.CHAT_MAX_TOKENS),
  },
  embedding: {
    provider: embeddingProvider, // openai (any OpenAI-compatible /embeddings API) | huggingface
    apiKey: embeddingApiKey,
    // For huggingface this is an optional dedicated Inference Endpoint URL.
    baseUrl: embeddingBaseUrl,
    model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
    dimensions: optNum(process.env.EMBEDDING_DIMENSIONS),
    batchSize: num(process.env.EMBEDDING_BATCH_SIZE, 32),
  },
};
ai.chatModel = ai.chat.model;
ai.embeddingModel = ai.embedding.model;

export const config = {
  env: process.env.NODE_ENV || "development",
  isProduction,
  port: num(process.env.PORT, 3000),

  // Where the React app is served from. OAuth sends users back here, and in
  // production CORS only allows this origin.
  clientUrl: (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, ""),

  db: {
    url: process.env.DATABASE_URL,
    host: process.env.PGHOST || "127.0.0.1",
    port: num(process.env.PGPORT, 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || "askai",
    ssl: bool(process.env.PGSSL),
    sslRejectUnauthorized: bool(process.env.PGSSL_REJECT_UNAUTHORIZED, true),
    poolMax: num(process.env.PG_POOL_MAX, 10),
  },

  auth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackUrl: process.env.GOOGLE_CALLBACK_URL || "http://localhost:5173/auth/google/callback",
    },
    sessionSecret: process.env.SESSION_SECRET,
    sessionMaxAgeDays: num(process.env.SESSION_MAX_AGE_DAYS, 30),
    cookieName: process.env.SESSION_COOKIE_NAME || "askai.sid",
    cookieSecure: bool(process.env.COOKIE_SECURE, isProduction),
    cookieSameSite: process.env.COOKIE_SAME_SITE || "lax",
    // Optional comma-separated allow-list, e.g. "example.com,school.edu".
    allowedDomains: (process.env.ALLOWED_EMAIL_DOMAINS || "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  },

  // Email + password accounts: verification codes are emailed over SMTP.
  email: {
    smtp: {
      host: process.env.SMTP_HOST,
      port: num(process.env.SMTP_PORT, 587),
      secure: bool(process.env.SMTP_SECURE, process.env.SMTP_PORT === "465"),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    mailFrom: process.env.MAIL_FROM || `Ask AI <${process.env.SMTP_USER || "no-reply@localhost"}>`,
    codeTtlMinutes: num(process.env.EMAIL_CODE_TTL_MINUTES, 10),
    resendSeconds: num(process.env.EMAIL_CODE_RESEND_SECONDS, 60),
    maxAttempts: num(process.env.EMAIL_CODE_MAX_ATTEMPTS, 5),
    passwordMinLength: num(process.env.PASSWORD_MIN_LENGTH, 8),
  },

  ai,

  chunk: {
    size: num(process.env.CHUNK_SIZE, 1000),
    overlap: num(process.env.CHUNK_OVERLAP, 200),
  },

  // Retrieval runs across every selected source in a notebook, so it pulls a
  // wider candidate pool than a single-document setup would.
  mmr: {
    k: num(process.env.MMR_K, 8),
    fetchK: num(process.env.MMR_FETCH_K, 30),
    lambda: num(process.env.MMR_LAMBDA, 0.6),
  },

  limits: {
    // NotebookLM caps a notebook at 50 sources.
    sourcesPerNotebook: num(process.env.MAX_SOURCES_PER_NOTEBOOK, 50),
    uploadMaxMb: num(process.env.UPLOAD_MAX_MB, 200),
    // Previous chat messages replayed to the LLM so follow-ups have context.
    chatHistoryMessages: num(process.env.CHAT_HISTORY_MESSAGES, 6),
  },

  paths: {
    // Uploaded files are kept here only while their text is extracted.
    uploadDir: path.resolve(root, process.env.UPLOAD_DIR || "./uploads"),
    // Built frontend to serve in production (optional).
    clientDist: path.resolve(root, process.env.CLIENT_DIST_DIR || "../frontend/dist"),
  },
};

/** Settings without which the server cannot run; returns human-readable problems. */
export function configProblems() {
  const problems = [];
  const { google, sessionSecret } = config.auth;
  if (!config.db.url && !config.db.password && !process.env.PGUSER) {
    problems.push("Database: set DATABASE_URL (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE).");
  }
  if (!google.clientId || !google.clientSecret) {
    problems.push("Google OAuth: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (until then only email sign-in works).");
  }
  if (!config.email.smtp.host) {
    problems.push("Email: SMTP_HOST is not set — verification codes will be printed to this console instead of emailed.");
  }
  if (!sessionSecret) problems.push("Sessions: set SESSION_SECRET to a long random string.");
  return problems;
}
