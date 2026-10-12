import { completeJson } from "./llm.js";
import { asCitations, cleanText, firstNumber, formatPassages, retrievePassages, samplePassages } from "./studyContext.js";
import { matchTopic } from "./topics.js";

// Answer-writing practice: exam-style questions worth 2, 5 or 10 marks, and
// grading of a student's written answer against the course sources.

export const MARKS = [2, 5, 10];

const MARK_GUIDE = {
  2: "2 marks: a short answer — a definition, a fact or one key point (about 30-60 words).",
  5: "5 marks: a structured answer with several points, an example or a short derivation (about 120-200 words).",
  10: "10 marks: a long answer — explain, analyse and connect ideas, with diagrams described in words, examples and a conclusion (about 300-500 words).",
};

/** Exam-style written questions for practice: [{ question, marks, topicId, topic }]. */
export async function generateWrittenQuestions({ sources, topics, focusTopics = [], marks, count, language }) {
  const passages = focusTopics.length
    ? await retrievePassages(sources, focusTopics.map((t) => t.name).join("\n"), { k: 16, fetchK: 50 })
    : await samplePassages(sources, { max: 24 });
  if (passages.length === 0) throw Object.assign(new Error("The chosen sources have no text to make questions from."), { status: 409 });
  const topicList = (focusTopics.length ? focusTopics : topics).map((t) => `- ${t.name}`).join("\n");

  const out = await completeJson(
    [
      "You set written exam questions for college students, answerable ONLY from the numbered source passages provided.",
      "Write questions in the style of university exams (\"Explain…\", \"Derive…\", \"Compare…\", \"With an example, describe…\"), matching the marks: the more marks, the broader the question.",
      "When a list of course topics is given, copy each question's topic exactly from it.",
    ].join("\n"),
    `Source passages:\n\n${formatPassages(passages)}\n\n` +
      (topicList ? `Course topics:\n${topicList}\n\n` : "") +
      `Write ${count} different questions worth ${marks} marks each.\n${MARK_GUIDE[marks]}\n\n` +
      'Return JSON: {"questions": [{"question": string, "topic": string}]}',
    { language }
  );
  const raw = Array.isArray(out?.questions) ? out.questions : Array.isArray(out) ? out : [];
  const seen = new Set();
  const questions = [];
  for (const item of raw) {
    const question = cleanText(typeof item === "string" ? item : item?.question, 800);
    const key = question.toLowerCase().replace(/\W+/g, " ").trim();
    if (!question || seen.has(key)) continue;
    seen.add(key);
    const topic = matchTopic(focusTopics.length ? focusTopics : topics, item?.topic);
    questions.push({ question, marks, topicId: topic?.id ?? null, topic: topic?.name ?? null });
    if (questions.length >= count) break;
  }
  if (questions.length === 0) throw Object.assign(new Error("The model didn't return any usable questions. Please try again."), { status: 502 });
  return questions;
}

const GRADER_PROMPT = [
  "You are a fair, strict university examiner. Grade the student's answer to an exam question using ONLY the numbered source passages as the marking scheme.",
  "Award marks for each correct, relevant point; deduct nothing for style, but give no marks for points that are wrong, irrelevant or not supported by the passages. Half marks are allowed.",
  "List: the correct points the student made, the important points they missed, and any mistakes or misconceptions. Cite the supporting passage numbers for every point.",
  "Then write a model answer worth full marks, in Markdown, citing passages inline as [n] after each sentence that uses them (like [2] or [1][3]). Never cite a number that was not provided.",
  "Address the student as \"you\". Keep technical terms and formulas exactly as in the sources.",
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
    .slice(0, 12);

/**
 * Grades a written answer: retrieves the passages relevant to the question,
 * asks the model to mark against them, and validates the result. Returns
 * { score, feedback: { correctPoints, missingPoints, mistakes, modelAnswer }, citations, topic }.
 */
export async function gradeAnswer({ sources, question, marks, answer, topics, language }) {
  const passages = await retrievePassages(sources, question, { k: 8, fetchK: 40 });
  if (passages.length === 0) throw Object.assign(new Error("The chosen sources have no text to grade against."), { status: 409 });
  const topicList = topics.map((t) => `- ${t.name}`).join("\n");

  const out = await completeJson(
    GRADER_PROMPT,
    `Source passages:\n\n${formatPassages(passages)}\n\n` +
      (topicList ? `Course topics:\n${topicList}\n\n` : "") +
      `Question (${marks} marks): ${question}\n\nStudent's answer:\n"""\n${answer}\n"""\n\n` +
      `Return JSON: {"score": number (0-${marks}), "correctPoints": [{"point": string, "passages": number[]}], "missingPoints": [{"point": string, "passages": number[]}], "mistakes": [{"point": string, "passages": number[]}], "modelAnswer": string, "topic": string (from the course topics)}`,
    { language }
  );

  const valid = new Set(passages.map((p) => p.number));
  const rawScore = firstNumber(out?.score ?? out?.marks);
  const score = Number.isFinite(rawScore) ? Math.min(marks, Math.max(0, Math.round(rawScore * 2) / 2)) : 0;
  // Drop citations of passages that weren't provided.
  const modelAnswer = cleanText(out?.modelAnswer ?? out?.model_answer, 6000).replace(/\[(\d+)\]/g, (m, n) => (valid.has(Number(n)) ? m : ""));
  if (!modelAnswer && !Array.isArray(out?.correctPoints) && !Array.isArray(out?.missingPoints)) {
    throw Object.assign(new Error("The model didn't return a usable grade. Please try again."), { status: 502 });
  }
  return {
    score,
    feedback: {
      correctPoints: toPoints(out?.correctPoints ?? out?.correct_points, valid),
      missingPoints: toPoints(out?.missingPoints ?? out?.missing_points, valid),
      mistakes: toPoints(out?.mistakes, valid),
      modelAnswer,
    },
    citations: asCitations(passages),
    // Units can share topic names: prefer the unit of the best-matching passage.
    topic: matchTopic(topics, out?.topic, sources.find((s) => s.id === passages[0]?.sourceId)?.unitId ?? null),
  };
}
