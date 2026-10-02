import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { jsonrepair } from "jsonrepair";
import { config } from "../config/index.js";

// Chat goes through LangChain's ChatOpenAI, which works with any provider that
// exposes an OpenAI-compatible chat completions API (CHAT_BASE_URL), e.g.
// OpenAI, Anthropic, Gemini, Groq, OpenRouter, Mistral, Hugging Face or Ollama.
const { chat } = config.ai;
const REQUEST_TIMEOUT_MS = 180_000;
const MISSING_KEY = "MISSING_API_KEY";

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

let chatModel = null;
function getChatModel() {
  assertApiKey();
  chatModel ??= new ChatOpenAI({
    model: chat.model,
    apiKey: chat.apiKey,
    configuration: { baseURL: chat.baseUrl },
    ...(chat.temperature !== undefined && { temperature: chat.temperature }),
    ...(chat.maxTokens !== undefined && { maxTokens: chat.maxTokens }),
    timeout: REQUEST_TIMEOUT_MS,
    maxRetries: 2,
    streamUsage: false,
  });
  return chatModel;
}

// The codebase passes messages as [role, content] tuples (system | human | ai).
const MESSAGE_TYPES = { system: SystemMessage, human: HumanMessage, user: HumanMessage, ai: AIMessage, assistant: AIMessage };
const toMessages = (messages) => messages.map(([role, content]) => new (MESSAGE_TYPES[role] ?? HumanMessage)(content));

const textOf = (content) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => p?.text ?? "").join("") : "";

// Turns provider errors into a clear message for the UI.
function explain(err) {
  const status = err.status ?? err.response?.status;
  // First line only: LangChain appends a troubleshooting link after a blank line.
  const detail = String(err.error?.message ?? err.message ?? "").split("\n")[0].slice(0, 300);
  const hint =
    status === 401 || status === 403
      ? " Check CHAT_API_KEY."
      : status === 400 || status === 404 || status === 422
        ? ` Is "${chat.model}" a chat model served at ${chat.baseUrl}? Check CHAT_MODEL and CHAT_BASE_URL.`
        : status === 402 || status === 429
          ? " The provider rejected the request for quota, credits or rate limits."
          : "";
  return httpError(502, `Chat request to ${config.ai.provider} failed${status ? ` (${status})` : ""}: ${detail}${hint}`);
}

/** One-shot completion: system + user prompt → text. */
export async function complete(system, user) {
  try {
    const result = await getChatModel().invoke(toMessages([["system", system], ["human", user]]));
    return textOf(result.content).trim();
  } catch (err) {
    if (err.code === MISSING_KEY) throw err;
    throw explain(err);
  }
}

/** Streams text deltas for a list of [role, content] messages. */
export async function* streamCompletion(messages) {
  let stream;
  try {
    stream = await getChatModel().stream(toMessages(messages));
  } catch (err) {
    if (err.code === MISSING_KEY) throw err;
    throw explain(err);
  }
  try {
    for await (const chunk of stream) {
      const text = textOf(chunk.content);
      if (text) yield text;
    }
  } catch (err) {
    throw explain(err);
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
        fallback ??= { value };
      } catch {
        // try the next candidate
      }
    }
  }
  if (fallback) return fallback.value;
  throw new Error("The model did not return valid JSON.");
}

// Asks for a JSON object and parses it, retrying because smaller models
// occasionally emit a truncated or malformed object.
const JSON_ATTEMPTS = 3;
export async function completeJson(system, user) {
  let lastError;
  for (let attempt = 0; attempt < JSON_ATTEMPTS; attempt++) {
    try {
      const text = await complete(
        `${system}

Respond with a single valid JSON object and nothing else — no prose, no markdown code fences.`,
        user
      );
      return parseJsonLoose(text);
    } catch (err) {
      if (err.status) throw err; // HTTP/config errors won't fix themselves on retry
      lastError = err;
    }
  }
  throw lastError;
}
