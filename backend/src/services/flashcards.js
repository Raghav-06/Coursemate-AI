import { completeJson } from "./llm.js";
import { cleanText, formatPassages, resolvePassage, samplePassages } from "./studyContext.js";

export const CARD_COUNTS = [10, 20, 30];
export const DIFFICULTIES = ["easy", "medium", "hard"];

const DIFFICULTY_GUIDE = {
  easy: "Easy: definitions, key terms and single facts a student must recall.",
  medium: "Medium: mix definitions with how/why questions, mechanisms, comparisons and formulas.",
  hard: "Hard: application, multi-step reasoning, edge cases, derivations and distinctions students commonly confuse.",
};

const SYSTEM_PROMPT = [
  "You write flashcards that help college students revise for exams, using ONLY the numbered source passages provided.",
  "Each card has a short, specific question or prompt on the front (one idea per card) and a concise, complete answer on the back (1-3 sentences; keep formulas, units and technical terms exactly as in the sources).",
  "Give each card a short topic (2-5 words) and the number of the passage it is based on.",
  "Never invent facts that are not in the passages. Do not repeat the same idea twice. Spread the cards across all the passages.",
].join("\n");

/**
 * Generates up to `count` flashcards from the given sources. Returns
 * [{ front, back, topic, sourceId, location, quote }] — every card cites the
 * passage it came from.
 */
export async function generateCards({ sources, count, difficulty, focus }) {
  const passages = await samplePassages(sources, { max: Math.min(40, count + 10) });
  if (passages.length === 0) throw Object.assign(new Error("The chosen sources have no text to make cards from."), { status: 409 });

  const out = await completeJson(
    SYSTEM_PROMPT,
    `Source passages:\n\n${formatPassages(passages)}\n\n` +
      `Write exactly ${count} flashcards${focus ? ` for "${focus}"` : ""}.\n${DIFFICULTY_GUIDE[difficulty]}\n\n` +
      'Return JSON: {"cards": [{"front": string, "back": string, "topic": string, "passage": number}]}'
  );

  const raw = Array.isArray(out?.cards) ? out.cards : Array.isArray(out) ? out : [];
  const seen = new Set();
  const cards = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const front = cleanText(item.front ?? item.question, 500);
    const back = cleanText(item.back ?? item.answer, 2000);
    const key = front.toLowerCase().replace(/\W+/g, " ").trim();
    if (!front || !back || seen.has(key)) continue;
    seen.add(key);
    const passage = resolvePassage(passages, item.passage ?? item.source, `${front} ${back}`);
    cards.push({
      front,
      back,
      topic: cleanText(item.topic, 80) || null,
      sourceId: passage?.sourceId ?? null,
      location: passage?.location ?? null,
      quote: passage?.text ?? null,
    });
    if (cards.length >= count) break;
  }
  if (cards.length === 0) {
    throw Object.assign(new Error("The model didn't return any usable flashcards. Please try again."), { status: 502 });
  }
  return cards;
}
