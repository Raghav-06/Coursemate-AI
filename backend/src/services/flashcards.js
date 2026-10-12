import { completeJson } from "./llm.js";
import { cleanText, formatPassages, resolvePassage, retrievePassages, samplePassages } from "./studyContext.js";
import { matchTopic } from "./topics.js";

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
  "Give each card a short topic (2-5 words) and the number of the passage it is based on. When a list of course topics is given, copy the topic exactly from it.",
  "Never invent facts that are not in the passages. Do not repeat the same idea twice. Spread the cards across all the passages.",
].join("\n");

/**
 * Generates up to `count` flashcards from the given sources. Returns
 * [{ front, back, topic, sourceId, location, quote }] — every card cites the
 * passage it came from. `topics` (course topics) tag the cards; `focusTopics`
 * limits them to those topics.
 */
export async function generateCards({ sources, count, difficulty, focus, topics = [], focusTopics = [], language }) {
  const passages = focusTopics.length
    ? await retrievePassages(sources, focusTopics.map((t) => `${t.name}. ${t.description ?? ""}`).join("\n"), { k: Math.min(30, count + 8), fetchK: 60 })
    : await samplePassages(sources, { max: Math.min(40, count + 10) });
  const topicList = (focusTopics.length ? focusTopics : topics).map((t) => `- ${t.name}`).join("\n");
  if (passages.length === 0) throw Object.assign(new Error("The chosen sources have no text to make cards from."), { status: 409 });

  const out = await completeJson(
    SYSTEM_PROMPT,
    `Source passages:\n\n${formatPassages(passages)}\n\n` +
      (topicList ? `Course topics:\n${topicList}\n\n` : "") +
      `Write exactly ${count} flashcards${focus ? ` for "${focus}"` : ""}.\n${DIFFICULTY_GUIDE[difficulty]}\n\n` +
      'Return JSON: {"cards": [{"front": string, "back": string, "topic": string, "passage": number}]}',
    { language }
  );

  const raw = Array.isArray(out?.cards) ? out.cards : Array.isArray(out) ? out : [];
  const unitOf = new Map(sources.map((s) => [s.id, s.unitId ?? null]));
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
    // Prefer the topic of the unit the passage comes from; a deck about one
    // topic tags every card with it when the model's topic doesn't match.
    const matched =
      matchTopic(focusTopics.length ? focusTopics : topics, item.topic, unitOf.get(passage?.sourceId)) ??
      (focusTopics.length === 1 ? focusTopics[0] : null);
    cards.push({
      front,
      back,
      topic: matched?.name ?? (cleanText(item.topic, 80) || null),
      topicId: matched?.id ?? null,
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
