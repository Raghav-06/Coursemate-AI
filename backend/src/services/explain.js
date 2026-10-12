import { completeJson } from "./llm.js";
import { asCitations, cleanText, firstNumber, formatPassages, retrievePassages } from "./studyContext.js";
import { matchTopic } from "./topics.js";

// Explain-it-back: the student explains a topic in their own words and the
// model compares the explanation with the course sources.

const PROMPT = [
  "You are a supportive but rigorous tutor. A college student has explained a topic in their own words. Compare their explanation with the numbered source passages, which are the ground truth.",
  "List: the points they got right, the important gaps (key ideas from the passages they left out), and any misconceptions (statements that contradict the passages). Cite the supporting passage numbers for every point. Do not count style or grammar against them.",
  "Score clarity 0-10 (how clear, well-organised and precise the explanation is) and accuracy 0-10 (how correct and complete it is against the passages).",
  "Write a one-sentence overall summary addressed to the student as \"you\", and ONE follow-up question that probes their weakest point, answerable from the passages.",
].join("\n");

const toPoints = (list, valid) =>
  (Array.isArray(list) ? list : [])
    .map((p) => {
      const text = cleanText(typeof p === "string" ? p : p?.point ?? p?.text, 600);
      const nums = (Array.isArray(p?.passages) ? p.passages : Array.isArray(p?.citations) ? p.citations : [])
        .map(firstNumber)
        .filter((n) => valid.has(n));
      return text ? { text, citations: [...new Set(nums)].slice(0, 6) } : null;
    })
    .filter(Boolean)
    .slice(0, 10);

const score10 = (value) => {
  const n = firstNumber(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round(n))) : null;
};

/**
 * Compares an explanation of `prompt` (a topic or question) with the sources.
 * Returns { clarity, accuracy, feedback: { summary, correctPoints, gaps,
 * misconceptions, followUp }, citations, topic }.
 */
export async function reviewExplanation({ sources, prompt, explanation, topics, language }) {
  const passages = await retrievePassages(sources, `${prompt}\n${explanation.slice(0, 1500)}`, { k: 8, fetchK: 40 });
  if (passages.length === 0) throw Object.assign(new Error("The chosen sources have no text to compare with."), { status: 409 });
  const topicList = topics.map((t) => `- ${t.name}`).join("\n");

  const out = await completeJson(
    PROMPT,
    `Source passages:\n\n${formatPassages(passages)}\n\n` +
      (topicList ? `Course topics:\n${topicList}\n\n` : "") +
      `What the student explains: ${prompt}\n\nStudent's explanation:\n"""\n${explanation}\n"""\n\n` +
      'Return JSON: {"summary": string, "correctPoints": [{"point": string, "passages": number[]}], "gaps": [{"point": string, "passages": number[]}], "misconceptions": [{"point": string, "passages": number[]}], "clarity": number, "accuracy": number, "followUp": string, "topic": string (from the course topics)}',
    { language }
  );

  const valid = new Set(passages.map((p) => p.number));
  const clarity = score10(out?.clarity);
  const accuracy = score10(out?.accuracy);
  const feedback = {
    summary: cleanText(out?.summary, 600),
    correctPoints: toPoints(out?.correctPoints ?? out?.correct_points, valid),
    gaps: toPoints(out?.gaps ?? out?.missingPoints, valid),
    misconceptions: toPoints(out?.misconceptions ?? out?.mistakes, valid),
    followUp: cleanText(out?.followUp ?? out?.follow_up ?? out?.followUpQuestion, 500),
  };
  if (clarity === null && accuracy === null && !feedback.correctPoints.length && !feedback.gaps.length) {
    throw Object.assign(new Error("The model didn't return usable feedback. Please try again."), { status: 502 });
  }
  return {
    clarity: clarity ?? 0,
    // Without an accuracy score, estimate it from the share of points that were right.
    accuracy:
      accuracy ??
      Math.round((10 * feedback.correctPoints.length) / Math.max(1, feedback.correctPoints.length + feedback.gaps.length + feedback.misconceptions.length)),
    feedback,
    citations: asCitations(passages),
    topic: matchTopic(topics, out?.topic, sources.find((s) => s.id === passages[0]?.sourceId)?.unitId ?? null),
  };
}
