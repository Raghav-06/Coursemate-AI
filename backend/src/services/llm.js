import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { jsonrepair } from "jsonrepair";
import { config } from "../config/index.js";
import { languageInstruction } from "./language.js";
import { modelSettings, tierFor } from "./modelRouter.js";
import { currentAiContext } from "./aiContext.js";
import { logAiCall } from "../db/aiCalls.js";

// Chat goes through LangChain's ChatOpenAI, which works with any provider that
// exposes an OpenAI-compatible chat completions API (the AI_PROVIDER / LLM_PROVIDER
// default URL, or AI_BASE_URL / LLM_BASE_URL), e.g. OpenAI, Anthropic, Gemini,
// Groq, OpenRouter, Mistral, Hugging Face or Ollama.
//
// Calls name their `task`; modelRouter.js maps it to a tier (Nano / Super /
// Ultra, each its own endpoint and model) or the default LLM model. `tier`
// picks one directly. Every call is logged in ai_calls (no prompt text).
const { chat } = config.ai;
const REQUEST_TIMEOUT_MS = 180_000;
const MISSING_KEY = "MISSING_API_KEY";
const INVALID_JSON = "INVALID_JSON";

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function assertApiKey() {
  if (!config.ai.apiKey) {
    throw Object.assign(
      httpError(503, `${config.ai.apiKeyName} is not set. Add your provider's API key to backend/.env and restart the server.`),
      { code: MISSING_KEY }
    );
  }
}

const envPrefix = (s) => (s.tier === "default" ? "LLM" : `MODEL_${s.tier.toUpperCase()}`);

// One cached client per tier ("default" = the LLM settings).
const chatModels = new Map();
function getChatModel(s) {
  if (s.tier === "default") assertApiKey();
  else if (!s.apiKey) {
    throw Object.assign(httpError(503, `${s.keyName} is not set (the ${s.tier} model tier). Add it to backend/.env and restart the server.`), {
      code: MISSING_KEY,
    });
  }
  if (!chatModels.has(s.tier)) {
    chatModels.set(
      s.tier,
      new ChatOpenAI({
        model: s.model,
        apiKey: s.apiKey,
        configuration: { baseURL: s.baseUrl },
        ...(s.temperature !== undefined && { temperature: s.temperature }),
        ...(s.maxTokens !== undefined && { maxTokens: s.maxTokens }),
        timeout: REQUEST_TIMEOUT_MS,
        maxRetries: 2,
        streamUsage: false,
      })
    );
  }
  return chatModels.get(s.tier);
}

// The codebase passes messages as [role, content] tuples (system | human | ai).
const MESSAGE_TYPES = { system: SystemMessage, human: HumanMessage, user: HumanMessage, ai: AIMessage, assistant: AIMessage };
const toMessages = (messages) => messages.map(([role, content]) => new (MESSAGE_TYPES[role] ?? HumanMessage)(content));

const textOf = (content) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => p?.text ?? "").join("") : "";

// Reasoning models (e.g. Nemotron with thinking on) may put their reasoning
// in <think>…</think> before the answer; only the answer is used.
const stripThinking = (text) => text.replace(/^\s*<think>[\s\S]*?(<\/think>|$)/, "");

const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

// Turns provider errors into a clear message for the UI.
function explain(err, s = { tier: "default", ...chat }) {
  const status = err.status ?? err.response?.status;
  // First line only: LangChain appends a troubleshooting link after a blank line.
  const detail = String(err.error?.message ?? err.message ?? "").split("\n")[0].slice(0, 300);
  const prefix = envPrefix(s);
  const hint =
    status === 401 || status === 403
      ? ` Check ${s.keyName}.`
      : status === 400 || status === 404 || status === 422
        ? s.tier === "default"
          ? ` Is "${s.model}" a chat model served at ${s.baseUrl}? Check LLM_MODEL and AI_PROVIDER / AI_BASE_URL.`
          : ` Is "${s.model}" a chat model served at ${s.baseUrl}? Check ${prefix}_MODEL and ${prefix}_BASE_URL.`
        : status === 402 || status === 429
          ? " The provider rejected the request for quota, credits or rate limits."
          : "";
  const what = s.tier === "default" ? "Chat request" : `${s.tier[0].toUpperCase()}${s.tier.slice(1)} model request`;
  return httpError(502, `${what} to ${hostOf(s.baseUrl)} failed${status ? ` (${status})` : ""}: ${detail}${hint}`);
}

// Short, prompt-free code for ai_calls.error_code.
function errorCode(err) {
  if (err.aiErrorCode) return err.aiErrorCode;
  if (err.code === MISSING_KEY) return "missing_key";
  if (err.code === INVALID_JSON) return "invalid_json";
  const status = err.status ?? err.response?.status;
  if (status && status !== 502) return String(status);
  if (/timeout|timed out|aborted/i.test(`${err.name} ${err.message}`)) return "timeout";
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|Connection error/i.test(err.message ?? "")) return "network";
  return "error";
}

/** Settings and log fields of a call from its options. */
function callSetup({ tier, task = "other", userId, notebookId } = {}) {
  const s = modelSettings(tier ?? tierFor(task));
  const context = currentAiContext();
  return { s, log: { tier: s.tier, model: s.model, task, userId: userId ?? context.userId, notebookId: notebookId ?? context.notebookId } };
}

/** The system prompt as a tier sends it: its prefix line (if any), then the prompt and language instruction. */
function systemFor(s, system, language) {
  const localized = withLanguage(system, language);
  return s.systemPrefix ? `${s.systemPrefix}\n${localized}` : localized;
}

/**
 * Adds the response-language instruction (see language.js) to a system
 * prompt. Every AI feature passes the user's language through here.
 */
export function withLanguage(system, language) {
  const instruction = languageInstruction(language);
  return instruction ? `${system}\n\n${instruction}` : system;
}

/**
 * One call: system + user prompt → text (parsed by `parse` when given, so a
 * reply that can't be parsed is logged as failed). Logs it in ai_calls.
 */
async function invoke(system, user, options, parse) {
  const { s, log } = callSetup(options);
  const started = Date.now();
  let failure = null;
  try {
    let text;
    try {
      const result = await getChatModel(s).invoke(toMessages([["system", systemFor(s, system, options.language)], ["human", user]]));
      text = stripThinking(textOf(result.content)).trim();
    } catch (err) {
      if (err.code === MISSING_KEY) throw err;
      throw Object.assign(explain(err, s), { aiErrorCode: errorCode(err) });
    }
    return parse ? parse(text) : text;
  } catch (err) {
    failure = err;
    throw err;
  } finally {
    logAiCall({ ...log, latencyMs: Date.now() - started, ok: !failure, errorCode: failure ? errorCode(failure) : null });
  }
}

/**
 * One-shot completion: system + user prompt → text. Options: `language` (the
 * response language), `task` (see modelRouter.js) or `tier`, and optionally
 * `userId` / `notebookId` for the log (default: the request's).
 */
export async function complete(system, user, options = {}) {
  return invoke(system, user, options);
}

/** Streams text deltas for a list of [role, content] messages (the language applies to the system message). */
export async function* streamCompletion(messages, options = {}) {
  const { s, log } = callSetup({ task: "chat", ...options });
  const started = Date.now();
  let failure = null;
  try {
    let stream;
    try {
      const localized = messages.map(([role, content], i) => (i === 0 && role === "system" ? [role, systemFor(s, content, options.language)] : [role, content]));
      stream = await getChatModel(s).stream(toMessages(localized));
    } catch (err) {
      if (err.code === MISSING_KEY) throw err;
      throw Object.assign(explain(err, s), { aiErrorCode: errorCode(err) });
    }
    // Hide a leading <think>…</think> block from reasoning models.
    let head = "";
    let thinking = null; // null = undecided, true = inside the block, false = answer
    try {
      for await (const chunk of stream) {
        let text = textOf(chunk.content);
        if (!text) continue;
        if (thinking !== false) {
          head += text;
          if (thinking === null) {
            const trimmed = head.trimStart();
            if (trimmed.length < 7 && "<think>".startsWith(trimmed)) continue;
            thinking = trimmed.startsWith("<think>");
          }
          if (thinking) {
            const end = head.indexOf("</think>");
            if (end === -1) continue;
            thinking = false;
            text = head.slice(end + 8).replace(/^\s+/, "");
          } else {
            thinking = false;
            text = head;
          }
          if (!text) continue;
        }
        yield text;
      }
    } catch (err) {
      throw Object.assign(explain(err, s), { aiErrorCode: errorCode(err) });
    }
  } catch (err) {
    failure = err;
    throw err;
  } finally {
    logAiCall({ ...log, latencyMs: Date.now() - started, ok: !failure, errorCode: failure ? errorCode(failure) : null });
  }
}

// ---- Vision (handwritten notes, photos, scanned pages) ----------------------

let visionModel = null;
function getVisionModel() {
  const { vision } = config.ai;
  if (!vision.apiKey) {
    throw httpError(503, "Reading images needs a vision model: set VISION_API_KEY (or AI_API_KEY) in backend/.env.");
  }
  visionModel ??= new ChatOpenAI({
    model: vision.model,
    apiKey: vision.apiKey,
    configuration: { baseURL: vision.baseUrl },
    ...(chat.maxTokens !== undefined && { maxTokens: chat.maxTokens }),
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 2,
    streamUsage: false,
  });
  return visionModel;
}

function explainVision(err) {
  const { vision } = config.ai;
  const status = err.status ?? err.response?.status;
  const detail = String(err.error?.message ?? err.message ?? "").split("\n")[0].slice(0, 300);
  const hint =
    status === 401 || status === 403
      ? " Check VISION_API_KEY."
      : status === 400 || status === 404 || status === 415 || status === 422
        ? ` "${vision.model}" at ${vision.baseUrl} may not accept images — set VISION_MODEL (and VISION_PROVIDER / VISION_BASE_URL) to a vision model.`
        : status === 402 || status === 429
          ? " The provider rejected the request for quota, credits or rate limits."
          : "";
  return httpError(502, `Image reading with ${vision.model} failed${status ? ` (${status})` : ""}: ${detail}${hint}`);
}

/** Sends images (data URLs) with a prompt to the vision model; returns its text. */
export async function completeVision(system, prompt, imageUrls) {
  const model = getVisionModel();
  const context = currentAiContext();
  const started = Date.now();
  let failure = null;
  try {
    const result = await model.invoke([
      new SystemMessage(system),
      new HumanMessage({
        content: [{ type: "text", text: prompt }, ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } }))],
      }),
    ]);
    return stripThinking(textOf(result.content)).trim();
  } catch (err) {
    failure = err;
    throw explainVision(err);
  } finally {
    logAiCall({
      tier: "vision",
      model: config.ai.vision.model,
      task: "ocr",
      userId: context.userId,
      notebookId: context.notebookId,
      latencyMs: Date.now() - started,
      ok: !failure,
      errorCode: failure ? errorCode(failure) : null,
    });
  }
}

// Candidate JSON snippets in a model reply: the whole text, a ```json fenced
// block, and the outermost {...} slice (to the end of the text if the reply
// was cut off before the closing brace).
function jsonCandidates(text) {
  const candidates = [text.trim()];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1].trim());
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1) candidates.push(end > start ? text.slice(start, end + 1) : text.slice(start));
  return [...new Set(candidates.filter(Boolean))];
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Parses JSON strictly first, then lets jsonrepair fix what smaller models get
// wrong (trailing commas, single quotes, truncation…). Prefers an object result.
function parseJsonLoose(text) {
  const candidates = jsonCandidates(text);
  let fallback;
  for (const parse of [JSON.parse, (c) => JSON.parse(jsonrepair(c))]) {
    for (const candidate of candidates) {
      try {
        const value = parse(candidate);
        if (isObject(value)) return value;
        // A bare list is usable; a bare string or number (jsonrepair turns prose into one) is not.
        if (Array.isArray(value)) fallback ??= { value };
      } catch {
        // try the next candidate
      }
    }
  }
  if (fallback) return fallback.value;
  throw new Error("The model did not return valid JSON.");
}

// Asks for a JSON object and parses it, retrying because smaller models
// occasionally emit a truncated or malformed object. Options as complete().
const JSON_ATTEMPTS = 3;
const parseOrFlag = (text) => {
  try {
    return parseJsonLoose(text);
  } catch (err) {
    throw Object.assign(err, { code: INVALID_JSON });
  }
};
export async function completeJson(system, user, options = {}) {
  let lastError;
  for (let attempt = 0; attempt < JSON_ATTEMPTS; attempt++) {
    try {
      return await invoke(
        `${withLanguage(system, options.language)}

Respond with a single valid JSON object and nothing else — no prose, no markdown code fences.`,
        user,
        { ...options, language: undefined },
        parseOrFlag
      );
    } catch (err) {
      if (err.status) throw err; // HTTP/config errors won't fix themselves on retry
      lastError = err;
    }
  }
  throw lastError;
}
