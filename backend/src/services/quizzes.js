import { completeJson } from "./llm.js";
import { cleanText, formatPassages, resolvePassage, retrievePassages, samplePassages } from "./studyContext.js";
import { matchTopic } from "./topics.js";

export const QUIZ_COUNTS = [5, 10, 15, 20];
export const QUIZ_DIFFICULTIES = ["easy", "medium", "hard"];

const DIFFICULTY_GUIDE = {
  easy: "Easy: recall of definitions, facts and terms.",
  medium: "Medium: understanding — explain why/how, compare, interpret formulas and examples.",
  hard: "Hard: application and analysis — multi-step problems, edge cases, and options that differ in subtle but important ways.",
};

const SYSTEM_PROMPT = [
  "You write multiple-choice exam questions for college students, using ONLY the numbered source passages provided.",
  "Each question has exactly 4 options with exactly one correct answer. Wrong options must be plausible (common misconceptions), similar in length and style to the correct one, and clearly wrong according to the passages. Avoid \"all of the above\" / \"none of the above\".",
  "Give the 0-based index of the correct option, a 1-2 sentence explanation of why it is right (and why a tempting wrong option is wrong), the passage number it is based on, and its topic.",
  "When a list of course topics is given, the topic MUST be copied exactly from that list.",
  "Keep technical terms, formulas and units exactly as in the passages. Do not repeat questions.",
].join("\n");

function shuffled(options, answerIndex) {
  const order = options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { options: order.map((i) => options[i]), answerIndex: order.indexOf(answerIndex) };
}

// The model's answer as an option index: 0-3, "B", or the option's text.
function answerIndexOf(item, options) {
  const raw = item.answer ?? item.answerIndex ?? item.correct ?? item.correctIndex;
  if (Number.isInteger(raw) && raw >= 0 && raw < options.length) return raw;
  const text = String(raw ?? "").trim();
  if (/^[A-Da-d]$/.test(text)) return text.toUpperCase().charCodeAt(0) - 65;
  if (/^\d$/.test(text) && Number(text) < options.length) return Number(text);
  const byText = options.findIndex((o) => o.toLowerCase() === text.toLowerCase());
  return byText;
}

/**
 * Generates `count` validated MCQs. `topics` are the course topics (questions
 * are tagged with one); `focusTopics` narrows the questions to those topics.
 */
export async function generateQuizQuestions({ sources, topics, focusTopics = [], count, difficulty, language }) {
  const passages = focusTopics.length
    ? await retrievePassages(sources, focusTopics.map((t) => `${t.name}. ${t.description ?? ""}`).join("\n"), { k: Math.min(24, count + 8), fetchK: 60 })
    : await samplePassages(sources, { max: Math.min(30, count + 10) });
  if (passages.length === 0) throw Object.assign(new Error("The chosen sources have no text to make questions from."), { status: 409 });

  const topicList = (focusTopics.length ? focusTopics : topics).map((t) => `- ${t.name}`).join("\n");
  const out = await completeJson(
    SYSTEM_PROMPT,
    `Source passages:\n\n${formatPassages(passages)}\n\n` +
      (topicList ? `Course topics:\n${topicList}\n\n` : "") +
      (focusTopics.length ? `Only ask about these topics: ${focusTopics.map((t) => t.name).join("; ")}.\n` : "") +
      `Write exactly ${count} questions.\n${DIFFICULTY_GUIDE[difficulty]}\n\n` +
      'Return JSON: {"questions": [{"question": string, "options": [string, string, string, string], "answer": number, "explanation": string, "topic": string, "passage": number}]}',
    { language }
  );

  const raw = Array.isArray(out?.questions) ? out.questions : Array.isArray(out) ? out : [];
  const unitOf = new Map(sources.map((s) => [s.id, s.unitId ?? null]));
  const seen = new Set();
  const questions = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const question = cleanText(item.question, 600);
    const options = Array.isArray(item.options) ? item.options.map((o) => cleanText(typeof o === "object" ? o?.text : o, 300)) : [];
    if (!question || options.length !== 4 || options.some((o) => !o)) continue;
    if (new Set(options.map((o) => o.toLowerCase())).size !== 4) continue;
    const answer = answerIndexOf(item, options);
    if (answer < 0 || answer > 3) continue;
    const key = question.toLowerCase().replace(/\W+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);

    const passage = resolvePassage(passages, item.passage, `${question} ${options[answer]}`);
    const topic = matchTopic(focusTopics.length ? focusTopics : topics, item.topic, unitOf.get(passage?.sourceId));
    questions.push({
      question,
      ...shuffled(options, answer),
      explanation: cleanText(item.explanation, 1200) || null,
      topicId: topic?.id ?? null,
      topic: topic?.name ?? (cleanText(item.topic, 80) || null),
      sourceId: passage?.sourceId ?? null,
      location: passage?.location ?? null,
      quote: passage?.text ?? null,
    });
    if (questions.length >= count) break;
  }
  if (questions.length === 0) throw Object.assign(new Error("The model didn't return any usable questions. Please try again."), { status: 502 });
  return questions;
}
