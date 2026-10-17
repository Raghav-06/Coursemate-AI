import { completeJson } from "./llm.js";
import { cleanText, firstNumber, formatPassages } from "./studyContext.js";
import { marksFor } from "./marking.js";
import { EXAM_PROFILES } from "../config/examProfiles.js";

// Grading one answer of a practice session. Code decides whenever it can
// (options, integers, matching, numbers in the key's unit, exact words);
// the Nano model judges what needs judgement (another unit, a value written
// with its unit, a near-synonym); the Super model marks written answers
// against the rubric, citing the passages. Marks follow the exam's scheme.

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const DESCRIPTIVE_PASS = 0.6; // a written answer under 60% counts as wrong (for diagnosis)

/** The exam format of a bank question (marks, negative, partial marking). */
export function formatOfQuestion(q) {
  const f = EXAM_PROFILES[q.examType]?.formats.find((x) => x.id === q.format);
  return { type: q.type, marks: q.marks, negative: q.negative, partial: f?.partial, integer: f?.integer };
}

/** Whether an answer is filled in at all. */
export function isAttempted(type, a) {
  if (!a) return false;
  if (type === "mcq_single" || type === "mcq_multi") return Array.isArray(a.choice) && a.choice.length > 0;
  if (type === "numerical") return String(a.value ?? "").trim() !== "";
  if (type === "matching") return Object.values(a.pairs ?? {}).some(Boolean);
  return String(a.text ?? "").trim() !== "";
}

/**
 * A number typed by a student: "34.6", "3,500", "3e8", "3×10^8", "1/2",
 * "-0.25", optionally followed by a unit ("3.5 km"). → { value, unit } or null.
 */
export function parseNumber(text) {
  const s = String(text ?? "").trim().replace(/,(?=\d{3}\b)/g, "").replace(/−/g, "-");
  const m = s.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)(?:\s*(?:[x×*]|\\times)\s*10\s*\^\s*\{?([-+]?\d+)\}?)?(?:\s*\/\s*(\d*\.?\d+))?\s*(.*)$/i);
  if (!m) return null;
  let value = Number(m[1]);
  if (m[2]) value *= 10 ** Number(m[2]);
  if (m[3]) value /= Number(m[3]);
  return Number.isFinite(value) ? { value, unit: m[4].trim() } : null;
}

const UNIT_ALIASES = { metre: "m", meter: "m", metres: "m", meters: "m", second: "s", seconds: "s", sec: "s", kilogram: "kg", kilograms: "kg", newton: "n", newtons: "n", joule: "j", joules: "j", watt: "w", watts: "w", ms1: "m/s" };
const normUnit = (u) => {
  const s = String(u ?? "").toLowerCase().replace(/\s+/g, "").replace(/\^/g, "").replace(/[{}]/g, "").replace(/\\text/g, "").replace(/\\,/g, "");
  return UNIT_ALIASES[s] ?? s;
};

const NANO_PROMPT = [
  "You grade one answer in an exam. Decide strictly whether the student's answer is correct.",
  "Numbers: correct if, after converting units, it is within the accepted range; a missing unit is fine when the number matches the key's unit. Words: accept spelling slips and true synonyms, not a different or vaguer concept.",
].join("\n");

const RUBRIC_GRADER = [
  "You are a fair, strict examiner. Mark the student's written answer against the rubric, using the numbered source passages as the reference.",
  "Award each rubric point up to its marks (half marks allowed) only when the answer states it correctly. Cite the passage(s) that support each point. Then give 2-4 sentences of feedback to the student (\"you\"), citing passages as [n].",
].join("\n");

async function nanoJudge(q, studentText, keyText, language) {
  const out = await completeJson(
    NANO_PROMPT,
    `Question: ${q.stem.slice(0, 1500)}\n\nKey: ${keyText}\n\nStudent's answer: "${String(studentText).slice(0, 200)}"\n\nReturn JSON: {"correct": boolean, "reason": string}`,
    { task: "grade_objective", language }
  );
  if (typeof out?.correct !== "boolean") throw new Error("The grader gave no verdict.");
  return { correct: out.correct, reason: cleanText(out.reason, 300) || null };
}

/** { correct, by, reason } for numerical and one-word answers (and matching / options in code). */
async function judgeObjective(q, a, language) {
  if (q.type === "mcq_single" || q.type === "mcq_multi") {
    const chosen = [...new Set(a.choice)].sort();
    const key = q.answer.correct;
    return { correct: chosen.length === key.length && chosen.every((c, i) => c === key[i]), by: "code", chosen, key };
  }
  if (q.type === "matching") {
    return { correct: Object.entries(q.answer.pairs).every(([k, v]) => a.pairs?.[k] === v), by: "code" };
  }
  if (q.type === "numerical") {
    const { value, tolerance, unit } = q.answer;
    const typed = `${a.value ?? ""}${a.unit ? ` ${a.unit}` : ""}`.trim();
    const parsed = parseNumber(a.value);
    const studentUnit = a.unit?.trim() || parsed?.unit || "";
    if (parsed && (!studentUnit || !unit || normUnit(studentUnit) === normUnit(unit))) {
      return { correct: Math.abs(parsed.value - value) <= tolerance + 1e-9, by: "code" };
    }
    const keyText = `${value}${unit ? ` ${unit}` : ""} (accepted ± ${tolerance}${unit ? ` ${unit}` : ""})`;
    return { ...(await nanoJudge(q, typed, keyText, language)), by: "nano" };
  }
  // one_word
  const text = String(a.text ?? "").trim();
  if ([q.answer.text, ...(q.answer.accept ?? [])].some((k) => norm(k) === norm(text))) return { correct: true, by: "code" };
  const keyText = `"${q.answer.text}"${q.answer.accept?.length ? ` (also accepted: ${q.answer.accept.join(", ")})` : ""}`;
  return { ...(await nanoJudge(q, text, keyText, language)), by: "nano" };
}

/** Marks a written answer against the rubric with the question's cited passages. */
async function gradeDescriptive(q, a, language) {
  const passages = q.citations.map((c, i) => ({ number: c.number ?? i + 1, sourceTitle: c.sourceTitle, location: c.location, text: c.text }));
  const out = await completeJson(
    RUBRIC_GRADER,
    `Source passages:\n\n${formatPassages(passages)}\n\nQuestion (${q.marks} marks): ${q.stem}\n\nRubric:\n${q.answer.rubric.map((r, i) => `${i + 1}. ${r.point} (${r.marks} marks)`).join("\n")}\n\n` +
      `Student's answer:\n"""\n${String(a.text).slice(0, 12000)}\n"""\n\n` +
      'Return JSON: {"points": [{"point": number, "awarded": number, "passages": [number]}], "feedback": string}',
    { task: "grade_descriptive", language }
  );
  const valid = new Set(passages.map((p) => p.number));
  const points = q.answer.rubric.map((r, i) => {
    const got = (Array.isArray(out?.points) ? out.points : []).find((p) => firstNumber(p?.point) === i + 1);
    const awarded = Math.min(r.marks, Math.max(0, Math.round((Number(got?.awarded) || 0) * 2) / 2));
    return { point: r.point, marks: r.marks, awarded, passages: (Array.isArray(got?.passages) ? got.passages : []).map(firstNumber).filter((n) => valid.has(n)) };
  });
  const feedback = cleanText(out?.feedback, 2000).replace(/\[(\d+)\]/g, (m, n) => (valid.has(Number(n)) ? m : ""));
  const total = points.reduce((s, p) => s + p.awarded, 0);
  return { fraction: q.marks ? total / q.marks : 0, points, feedback };
}

/**
 * Grades one answer: → { attempted, correct, fraction, marks, grading }.
 * Unattempted questions score 0 with no model call.
 */
export async function gradeAnswer(q, a, { language } = {}) {
  const format = formatOfQuestion(q);
  if (!isAttempted(q.type, a)) return { attempted: false, correct: null, fraction: 0, marks: 0, grading: { by: "code", reason: "not answered" } };
  if (q.type === "descriptive") {
    const d = await gradeDescriptive(q, a, language);
    const marks = marksFor(format, { attempted: true, fraction: d.fraction });
    return { attempted: true, correct: d.fraction >= DESCRIPTIVE_PASS, fraction: marks / q.marks, marks, grading: { by: "super", points: d.points, feedback: d.feedback } };
  }
  const verdict = await judgeObjective(q, a, language);
  const marks = marksFor(format, { attempted: true, correct: verdict.correct, chosen: verdict.chosen, key: verdict.key });
  return {
    attempted: true,
    correct: verdict.correct,
    fraction: Math.max(0, marks) / q.marks,
    marks,
    grading: { by: verdict.by, ...(verdict.reason ? { reason: verdict.reason } : {}) },
  };
}
