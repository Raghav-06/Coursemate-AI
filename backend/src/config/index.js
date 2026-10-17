import "dotenv/config";
import path from "node:path";

const root = process.cwd();
const bool = (v, fallback = false) => (v === undefined || v === "" ? fallback : /^(1|true|yes|on)$/i.test(v));
const num = (v, fallback) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? fallback : Number(v));

const isProduction = process.env.NODE_ENV === "production";

// ---- AI (any provider via LangChain) -------------------------------------------
// Every AI job (LLM, embeddings, vision, transcription) talks to an
// OpenAI-compatible API (OpenAI, Anthropic, Gemini, Groq, OpenRouter, Mistral,
// Together, DeepSeek, xAI, Hugging Face, Ollama, LM Studio…); embeddings can
// also use Hugging Face's feature-extraction API. AI_PROVIDER / AI_API_KEY /
// AI_BASE_URL are shared by all jobs; each job can override them with its own
// <JOB>_PROVIDER / <JOB>_API_KEY / <JOB>_BASE_URL (JOB = LLM, EMBEDDING, VISION,
// TRANSCRIBE). See src/services/llm.js and embeddings.js.
const env = process.env;
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

// OpenAI-compatible base URL of each known provider, so setting the provider
// name is enough. Any other name ("custom") needs a base URL.
const PROVIDER_URLS = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  mistral: "https://api.mistral.ai/v1",
  together: "https://api.together.xyz/v1",
  deepseek: "https://api.deepseek.com/v1",
  xai: "https://api.x.ai/v1",
  huggingface: "https://router.huggingface.co/v1",
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
};
const providerName = (v) => (v ? v.trim().toLowerCase().replace(/[\s_-]+/g, "") : "");
const aiProblems = [];

// Shared settings. CHAT_API_KEY / CHAT_BASE_URL are the older names, still read.
const sharedProvider = providerName(env.AI_PROVIDER) || "openai";
const sharedBaseUrl =
  trimSlash(env.AI_BASE_URL) || trimSlash(env.CHAT_BASE_URL) || PROVIDER_URLS[sharedProvider];
const sharedApiKey = env.AI_API_KEY || env.CHAT_API_KEY;
if (!sharedBaseUrl) aiProblems.push(`AI: unknown AI_PROVIDER "${env.AI_PROVIDER}" — set AI_BASE_URL to its OpenAI-compatible URL.`);

/**
 * Resolves one job's provider, base URL and API key. Without overrides it uses
 * the shared settings; the shared key is only sent to the shared base URL.
 */
function endpoint(prefix, legacyPrefix) {
  const read = (name) => env[`${prefix}_${name}`] || (legacyPrefix ? env[`${legacyPrefix}_${name}`] : undefined);
  const provider = providerName(read("PROVIDER")) || sharedProvider;
  const ownProvider = provider !== sharedProvider;
  const baseUrl = trimSlash(read("BASE_URL")) || (ownProvider ? PROVIDER_URLS[provider] : sharedBaseUrl);
  if (!baseUrl && ownProvider) aiProblems.push(`AI: unknown ${prefix}_PROVIDER "${provider}" — set ${prefix}_BASE_URL.`);
  const apiKey =
    read("API_KEY") || (baseUrl === sharedBaseUrl ? sharedApiKey : undefined) || (isLocal(baseUrl) ? "not-needed" : undefined);
  return { provider, baseUrl, apiKey, keyName: read("API_KEY") || baseUrl !== sharedBaseUrl ? `${prefix}_API_KEY` : "AI_API_KEY" };
}

const llm = endpoint("LLM", "CHAT");
const llmModel = env.LLM_MODEL || env.CHAT_MODEL || (llm.provider === "openai" ? "gpt-4o-mini" : undefined);
if (!llmModel && llm.baseUrl) aiProblems.push(`AI: set LLM_MODEL to a model offered by ${llm.provider}.`);

// Embeddings: "huggingface" uses Hugging Face feature extraction (its base URL
// is an optional dedicated Inference Endpoint); every other provider uses an
// OpenAI-compatible /embeddings API.
const embeddingProvider = providerName(env.EMBEDDING_PROVIDER) || sharedProvider;
let embedding;
if (embeddingProvider === "huggingface") {
  embedding = {
    provider: "huggingface",
    baseUrl: trimSlash(env.EMBEDDING_BASE_URL) || undefined,
    apiKey: env.EMBEDDING_API_KEY || (sharedProvider === "huggingface" ? sharedApiKey : undefined),
    keyName: env.EMBEDDING_API_KEY || sharedProvider !== "huggingface" ? "EMBEDDING_API_KEY" : "AI_API_KEY",
  };
} else {
  embedding = endpoint("EMBEDDING");
}

const NO_EMBEDDINGS = ["anthropic", "groq", "deepseek", "xai"];
if (NO_EMBEDDINGS.includes(embedding.provider) && !env.EMBEDDING_BASE_URL) {
  aiProblems.push(`AI: ${embedding.provider} has no embeddings API — set EMBEDDING_PROVIDER (and EMBEDDING_API_KEY) to another provider.`);
}

const vision = endpoint("VISION");
const transcribe = endpoint("TRANSCRIBE");

const ai = {
  provider: hostOf(llm.baseUrl),
  // Reported to the UI when a key is missing.
  apiKey: llm.apiKey && embedding.apiKey ? llm.apiKey : undefined,
  apiKeyName: !llm.apiKey ? llm.keyName : embedding.keyName,
  problems: aiProblems,
  chat: {
    provider: llm.provider,
    apiKey: llm.apiKey,
    keyName: llm.keyName,
    baseUrl: llm.baseUrl,
    model: llmModel,
    // Empty = let the provider decide (some reasoning models reject these).
    temperature: optNum(env.LLM_TEMPERATURE ?? env.CHAT_TEMPERATURE),
    maxTokens: optNum(env.LLM_MAX_TOKENS ?? env.CHAT_MAX_TOKENS),
  },
  embedding: {
    provider: embedding.provider, // huggingface, or any OpenAI-compatible provider
    apiKey: embedding.apiKey,
    // For huggingface this is an optional dedicated Inference Endpoint URL.
    baseUrl: embedding.baseUrl,
    model: env.EMBEDDING_MODEL || "text-embedding-3-small",
    dimensions: optNum(env.EMBEDDING_DIMENSIONS),
    batchSize: num(env.EMBEDDING_BATCH_SIZE, 32),
  },
  // Reading handwritten notes, photos and scanned PDFs: any OpenAI-compatible
  // chat model that accepts images. Defaults to the LLM settings.
  vision: {
    provider: vision.provider,
    baseUrl: vision.baseUrl,
    apiKey: vision.apiKey,
    model: env.VISION_MODEL || llmModel,
    // Scanned PDF pages read per source (each page is one vision request).
    maxPages: num(env.VISION_MAX_PAGES, 60),
  },
  // Lecture recordings: an OpenAI-compatible /audio/transcriptions API (OpenAI
  // whisper-1, Groq whisper-large-v3-turbo, a local faster-whisper server…).
  transcribe: {
    provider: transcribe.provider,
    baseUrl: transcribe.baseUrl,
    apiKey: transcribe.apiKey,
    model: env.TRANSCRIBE_MODEL || "whisper-1",
    // Audio is split into pieces below the provider's upload limit (OpenAI and Groq: 25 MB).
    maxMb: num(env.TRANSCRIBE_MAX_MB, 24),
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
    mailFrom: process.env.MAIL_FROM || `CourseMate AI <${process.env.SMTP_USER || "no-reply@localhost"}>`,
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
    // Sources per course.
    sourcesPerNotebook: num(process.env.MAX_SOURCES_PER_NOTEBOOK, 50),
    unitsPerNotebook: num(process.env.MAX_UNITS_PER_NOTEBOOK, 50),
    // New flashcards a user starts per course per day (spaced repetition).
    newCardsPerDay: num(process.env.NEW_CARDS_PER_DAY, 20),
    uploadMaxMb: num(process.env.UPLOAD_MAX_MB, 200),
    // Shared courses: people per course (owner included) and how long an invite link works.
    membersPerNotebook: num(process.env.MAX_MEMBERS_PER_COURSE, 50),
    inviteTtlDays: num(process.env.INVITE_TTL_DAYS, 14),
    // Quiz battles: players per game.
    battlePlayers: num(process.env.MAX_BATTLE_PLAYERS, 30),
    // Previous chat messages replayed to the LLM so follow-ups have context.
    chatHistoryMessages: num(process.env.CHAT_HISTORY_MESSAGES, 6),
  },

  // ffmpeg (bundled via ffmpeg-static) converts and splits recordings and
  // resizes images. FFMPEG_PATH points at another binary.
  media: {
    ffmpegPath: process.env.FFMPEG_PATH || undefined,
  },

  paths: {
    // Uploaded files are kept here only while their text is extracted.
    uploadDir: path.resolve(root, process.env.UPLOAD_DIR || "./uploads"),
    // Original uploaded files, kept so a source can be re-processed (and, for
    // images, shown in the viewer). Deleted together with the source.
    originalsDir: path.resolve(root, process.env.ORIGINALS_DIR || path.join(process.env.UPLOAD_DIR || "./uploads", "originals")),
    // Built frontend to serve in production (optional).
    clientDist: path.resolve(root, process.env.CLIENT_DIST_DIR || "../frontend/dist"),
  },
};

/**
 * Which models the server uses, for Settings → AI & privacy: model names and
 * the host each request goes to (never keys). `local` means the host is this
 * machine (e.g. Ollama or LM Studio), so that data never leaves it.
 */
export function aiSummary() {
  const { chat, embedding, vision, transcribe } = config.ai;
  const entry = (model, url, extra = {}) => ({ model, host: url ? hostOf(url) : null, local: isLocal(url), ...extra });
  return {
    chat: entry(chat.model, chat.baseUrl),
    embeddings:
      embedding.provider === "huggingface"
        ? entry(embedding.model, embedding.baseUrl || "https://router.huggingface.co", { provider: "huggingface" })
        : entry(embedding.model, embedding.baseUrl, { provider: "openai-compatible" }),
    vision: entry(vision.model, vision.baseUrl),
    transcription: entry(transcribe.model, transcribe.baseUrl),
  };
}

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
  problems.push(...config.ai.problems);
  if (!sessionSecret) problems.push("Sessions: set SESSION_SECRET to a long random string.");
  return problems;
}
