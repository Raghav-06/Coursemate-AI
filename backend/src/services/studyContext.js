import { listChunkTexts } from "../db/store.js";
import { ensureCurrentEmbeddings, loadMergedStore, mmrSearch } from "./vectorStore.js";

// Numbered source passages for generation prompts (flashcards, quizzes,
// topics…). The model refers to passages by number; we turn the number back
// into a citation (source + page/slide + quote), the same shape chat uses.

/**
 * Up to `max` passages spread evenly across the sources (each source gets a
 * share proportional to its length, at least one), in reading order.
 */
export async function samplePassages(sources, { max = 24 } = {}) {
  const titles = new Map(sources.map((s) => [s.id, s.title]));
  const chunks = await listChunkTexts(sources.map((s) => s.id));
  const bySource = new Map();
  for (const c of chunks) {
    if (!bySource.has(c.sourceId)) bySource.set(c.sourceId, []);
    bySource.get(c.sourceId).push(c);
  }

  const total = chunks.length;
  const picked = [];
  for (const [sourceId, list] of bySource) {
    const share = Math.max(1, Math.round((list.length / Math.max(1, total)) * max));
    const step = list.length / Math.min(share, list.length);
    for (let i = 0; i < Math.min(share, list.length); i++) picked.push({ ...list[Math.floor(i * step)], sourceTitle: titles.get(sourceId) });
  }
  return picked.slice(0, Math.max(max, bySource.size)).map((p, i) => ({ ...p, number: i + 1 }));
}

/** Passages formatted for a prompt: "[3] (from "Lecture 5", p. 12)\n…". */
export function formatPassages(passages) {
  return passages
    .map((p) => `[${p.number}] (from "${p.sourceTitle}"${p.location ? `, ${p.location}` : ""})\n${p.text}`)
    .join("\n\n");
}

/** The citation stored with a generated item. */
export function citationOf(passage) {
  if (!passage) return null;
  return {
    sourceId: passage.sourceId,
    sourceTitle: passage.sourceTitle,
    location: passage.location ?? null,
    start: passage.start ?? null,
    end: passage.end ?? null,
    text: passage.text,
  };
}

const words = (s) => new Set(String(s).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);

/**
 * The passage a model's answer refers to: the number it gave when valid,
 * else the passage sharing the most words with `text`.
 */
export function resolvePassage(passages, number, text) {
  const n = firstNumber(number);
  const exact = passages.find((p) => p.number === n);
  if (exact) return exact;
  const target = words(text);
  let best = null;
  let bestScore = 0;
  for (const p of passages) {
    let score = 0;
    for (const w of words(p.text)) if (target.has(w)) score += 1;
    if (score > bestScore) [best, bestScore] = [p, score];
  }
  return best;
}

/**
 * The first number in a model value: 3, "3", "[3]", "Passage 3", "3/5" → 3;
 * NaN when there is none. (Stripping non-digits would turn "3/5" into 35.)
 */
export function firstNumber(value) {
  const match = String(value ?? "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

/** Trimmed single string, at most `max` characters ("" for anything else). */
export function cleanText(value, max) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\r\n?/g, "\n").trim().slice(0, max);
}

/**
 * The passages most relevant to `queryText` across the sources (MMR, as chat
 * uses), numbered from 1 — for grading and topic-focused generation.
 */
export async function retrievePassages(sources, queryText, { k = 8, fetchK = 30 } = {}) {
  const titles = new Map(sources.map((s) => [s.id, s.title]));
  await ensureCurrentEmbeddings(sources);
  const store = await loadMergedStore(sources.map((s) => s.id));
  const docs = await mmrSearch(store, queryText, { k, fetchK });
  return docs.map((doc, i) => ({
    number: i + 1,
    sourceId: doc.metadata.sourceId,
    sourceTitle: titles.get(doc.metadata.sourceId) ?? doc.metadata.source,
    chunk: doc.metadata.chunk,
    start: doc.metadata.start ?? null,
    end: doc.metadata.end ?? null,
    location: doc.metadata.location ?? null,
    text: doc.pageContent,
  }));
}

/** Passages as chat-style citations ({ number, sourceId, sourceTitle, chunk, start, end, location, text }). */
export const asCitations = (passages) =>
  passages.map((p) => ({
    number: p.number,
    sourceId: p.sourceId,
    sourceTitle: p.sourceTitle,
    chunk: p.chunk ?? null,
    start: p.start ?? null,
    end: p.end ?? null,
    location: p.location ?? null,
    text: p.text,
  }));
