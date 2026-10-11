import { listChunkTexts } from "../db/store.js";

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
  const n = Number.parseInt(String(number ?? "").replace(/[^\d]/g, ""), 10);
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

/** Trimmed single string, at most `max` characters ("" for anything else). */
export function cleanText(value, max) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\r\n?/g, "\n").trim().slice(0, max);
}
