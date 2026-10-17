import { completeJson } from "./llm.js";
import { cleanText } from "./studyContext.js";
import { updateSource } from "../db/store.js";

// After an upload is processed, the Nano model guesses what it is — the
// syllabus, notes, or a past paper. When that differs from the kind the user
// picked, it is stored as suggested_kind and the sources panel offers to
// switch (the user decides; nothing changes on its own).

const PROMPT = [
  "You sort documents uploaded to an exam-prep course into one of three kinds:",
  "syllabus — the official list of units/topics to study, often with the exam scheme or marks distribution;",
  "notes — study material: lecture notes, textbook chapters, slides, worked examples, explanations;",
  "past_paper — an exam or question paper: numbered questions for students to answer, often with marks and instructions.",
].join("\n");
const KINDS = { syllabus: "syllabus", notes: "material", material: "material", past_paper: "past_paper", "past paper": "past_paper" };
const MIN_CONFIDENCE = 0.6;

/** The kind a document looks like: { kind: material | syllabus | past_paper, confidence } or null. */
export async function classifyText(title, text) {
  const sample = text.length > 3500 ? `${text.slice(0, 2500)}\n[…]\n${text.slice(Math.floor(text.length / 2), Math.floor(text.length / 2) + 1000)}` : text;
  const out = await completeJson(PROMPT, `Title: ${title}\n\nText:\n"""\n${sample}\n"""\n\nReturn JSON: {"kind": "syllabus" | "notes" | "past_paper", "confidence": number (0-1)}`, {
    task: "classify_source",
  });
  const kind = KINDS[cleanText(out?.kind, 20).toLowerCase()];
  const confidence = Number(out?.confidence);
  if (!kind) return null;
  return { kind, confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5 };
}

/** Stores a suggestion when the document looks like a different kind (soft-fails). */
export async function suggestKind(source, text) {
  try {
    const guess = await classifyText(source.title, text);
    const suggested = guess && guess.kind !== source.kind && guess.confidence >= MIN_CONFIDENCE ? guess.kind : null;
    await updateSource(source.id, { suggestedKind: suggested });
    return suggested;
  } catch (err) {
    console.warn(`Classifying source ${source.id} failed: ${err.message}`);
    return null;
  }
}
