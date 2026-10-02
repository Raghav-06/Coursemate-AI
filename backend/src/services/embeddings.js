import { OpenAIEmbeddings } from "@langchain/openai";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { config } from "../config/index.js";
import { assertApiKey } from "./llm.js";

// Embeddings go through LangChain. EMBEDDING_PROVIDER picks the client:
//   openai      — any OpenAI-compatible /embeddings API (OpenAI, Gemini, Mistral,
//                 Together, Voyage, Jina, Ollama, LM Studio…) at EMBEDDING_BASE_URL
//   huggingface — Hugging Face feature extraction (hf-inference, or a dedicated
//                 Inference Endpoint when EMBEDDING_BASE_URL is set)
const { embedding } = config.ai;

function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

// Sentence-transformers models return one pooled vector per input; a plain
// transformer returns per-token vectors, so mean-pool those ourselves.
function toSentenceVector(output) {
  if (typeof output[0] === "number") return Array.from(output);
  const tokens = output;
  const dims = tokens[0].length;
  const mean = new Array(dims).fill(0);
  for (const token of tokens) for (let i = 0; i < dims; i++) mean[i] += token[i] / tokens.length;
  return mean;
}

function createClient() {
  if (embedding.provider === "huggingface") {
    return new HuggingFaceInferenceEmbeddings({
      apiKey: embedding.apiKey,
      model: embedding.model,
      // A dedicated endpoint URL replaces the provider (the client rejects both).
      ...(embedding.baseUrl ? { endpointUrl: embedding.baseUrl } : { provider: "hf-inference" }),
      maxRetries: 5, // LangChain backs off on 429 / cold-start 503s
    });
  }
  if (embedding.provider === "openai") {
    return new OpenAIEmbeddings({
      apiKey: embedding.apiKey,
      model: embedding.model,
      configuration: { baseURL: embedding.baseUrl },
      ...(embedding.dimensions && { dimensions: embedding.dimensions }),
      // Plain floats: many OpenAI-compatible servers don't support base64.
      encodingFormat: "float",
      batchSize: embedding.batchSize,
      maxRetries: 5,
    });
  }
  throw Object.assign(new Error(`Unknown EMBEDDING_PROVIDER "${embedding.provider}" (use "openai" or "huggingface").`), {
    status: 500,
  });
}

let client = null;
function getClient() {
  assertApiKey();
  client ??= createClient();
  return client;
}

function explain(err) {
  const status = err.httpResponse?.status ?? err.status ?? err.response?.status;
  const detail = String(err.httpResponse?.body?.error ?? err.error?.message ?? err.message ?? "")
    .split("\n")[0]
    .slice(0, 300);
  const hint =
    status === 401 || status === 403
      ? " Check EMBEDDING_API_KEY (or CHAT_API_KEY if you share one key)."
      : status === 404 || status === 400 || status === 422
        ? ` Is "${embedding.model}" an embedding model served by this provider? Check EMBEDDING_MODEL and EMBEDDING_BASE_URL.`
        : "";
  return Object.assign(new Error(`Embedding request failed${status ? ` (${status})` : ""}: ${detail}${hint}`), {
    status: 502,
  });
}

/**
 * Wraps the LangChain embeddings client with batching (so ingestion can
 * report progress), pooling and L2-normalisation for cosine search.
 * Same shape as LangChain's Embeddings classes (embedDocuments / embedQuery).
 */
class Embeddings {
  async _embed(texts) {
    const embeddings = getClient();
    try {
      const output = await embeddings.embedDocuments(texts);
      return output.map((item) => normalize(toSentenceVector(item)));
    } catch (err) {
      throw explain(err);
    }
  }

  async embedDocuments(texts, onProgress) {
    const vectors = [];
    for (let i = 0; i < texts.length; i += embedding.batchSize) {
      vectors.push(...(await this._embed(texts.slice(i, i + embedding.batchSize))));
      onProgress?.(Math.min(1, (i + embedding.batchSize) / texts.length));
    }
    return vectors;
  }

  async embedQuery(text) {
    const [vector] = await this._embed([text]);
    return vector;
  }
}

let singleton = null;

export function getEmbeddings() {
  if (!singleton) singleton = new Embeddings();
  return singleton;
}

/**
 * Identifies the embedding space; vectors from different models can't be mixed,
 * so changing it re-embeds existing sources.
 */
export function embeddingModelId() {
  if (embedding.provider === "huggingface") return `huggingface:${embedding.model}`;
  const host = embedding.baseUrl ? new URL(embedding.baseUrl).host : "openai";
  return `${host}:${embedding.model}${embedding.dimensions ? `@${embedding.dimensions}` : ""}`;
}
