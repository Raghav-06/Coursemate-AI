import { completeJson } from "./llm.js";
import { asCitations, cleanText, firstNumber, formatPassages, retrievePassages } from "./studyContext.js";
import { EXAM_PROFILES, courseProfile } from "../config/examProfiles.js";

// Self-checked practice questions. The Super model writes questions for
// knowledge-map nodes in the exam's formats (key, solution, difficulty,
// expected time, node tags, [n] citations to the passages it was given).
// Before a student sees one:
//   1. code validators: options distinct, the right number of correct
//      options, numeric answer parses with a sane tolerance and a unit, no
//      answer leaked in the stem, at least one cited passage that exists;
//   2. self-check: a SEPARATE Super call (fresh context, no key, no solution)
//      solves it from the same passages; accepted only if its answer matches
//      the key (exact for options, within tolerance for numbers); for
//      descriptive questions the rubric must be covered by the passages.
// A rejected question is regenerated with the reason (max 2 retries), then
// discarded. Every attempt is recorded in `verification`.

export const DIFFICULTIES = ["easy", "medium", "hard"];
export const MAX_COUNT = 15;
const MAX_RETRIES = 2;
const CONCURRENCY = 4;
const IDS = ["A", "B", "C", "D"];
const RUBRIC_COVERAGE = 0.8; // share of rubric marks the passages must support

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, " ").trim();
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** The profile questions are written for: the course's, or University when it has none. */
export function profileFor(notebook) {
  return courseProfile(notebook.examType, notebook.examSettings) ?? { type: "university", ...EXAM_PROFILES.university };
}

/**
 * The formats of `count` questions: the requested format ids in turn, or the
 * profile's mock-test mix (largest remainder), so practice looks like the exam.
 */
export function pickFormats(profile, count, requested) {
  const known = (requested ?? []).map((id) => profile.formats.find((f) => f.id === id)).filter(Boolean);
  if (known.length) return Array.from({ length: count }, (_, i) => known[i % known.length]);
  const pattern = profile.mock?.perSubject ?? profile.mock?.whole ?? profile.formats.map((f) => ({ format: f.id, count: 1 }));
  const total = pattern.reduce((s, p) => s + p.count, 0);
  const shares = pattern.map((p) => ({ format: profile.formats.find((f) => f.id === p.format), exact: (p.count / total) * count }));
  const picked = shares.map((s) => ({ ...s, n: Math.floor(s.exact) }));
  let left = count - picked.reduce((s, p) => s + p.n, 0);
  for (const p of [...picked].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)))) {
    if (left-- <= 0) break;
    p.n += 1;
  }
  return picked.flatMap((p) => Array.from({ length: p.n }, () => p.format)).filter(Boolean);
}

// ---- Prompts -----------------------------------------------------------------------

const SHAPES = {
  mcq_single: '"options": [{"id": "A", "text": string}, … 4 options], "correct": ["<the one correct id>"]',
  mcq_multi: '"options": [{"id": "A", "text": string}, … 4 options], "correct": [every correct id — one or more]',
  numerical: '"answer": {"value": number, "tolerance": number (accepted ± range), "unit": string (SI unit, or "none" if dimensionless)}',
  matching: '"left": [{"id": "P", "text": string}, … 4 items], "right": [{"id": "1", "text": string}, … 4 or 5 items], "pairs": {"P": "1", …}',
  one_word: '"answerText": string (1-4 words), "accept": [other accepted spellings]',
  descriptive: '"modelAnswer": string (Markdown), "rubric": [{"point": string, "marks": number}] (marks add up to the question\'s marks)',
};

const GEN_PROMPT = [
  "You are an expert paper-setter for Indian competitive and university exams (JEE, NEET, GATE, UPSC, university). Write original practice questions, answerable from the numbered source passages provided — never copy a question from them verbatim.",
  "Each question tests the knowledge-map node(s) it is tagged with, in the requested format, at the requested difficulty, in the style of the named exam.",
  "MCQ distractors are plausible (typical mistakes and misconceptions), similar in length, and clearly wrong. Numerical answers are exact values with a small tolerance and SI units. The stem must not reveal the answer.",
  "Write math in LaTeX: inline $...$, display $$...$$. The full solution is step by step in Markdown and cites the passages it relies on as [n].",
  "expectedSeconds: how long a well-prepared student needs.",
].join("\n");

const SOLVE_PROMPT = [
  "You are a top student taking an exam. Solve the question below independently, using the numbered source passages and your knowledge. Work it out carefully, then give only your final answer in the requested JSON.",
].join("\n");

const RUBRIC_PROMPT = [
  "You check a marking rubric against study material. For each numbered rubric point, decide whether the numbered source passages support it (the point can be learnt and marked from them). Be strict.",
].join("\n");

function slotListing(slots, nodes) {
  return slots
    .map((s, i) => `Q${i + 1}: format "${s.format.id}" — ${s.format.label} (${s.format.type}${s.format.type === "descriptive" ? `, ${s.format.marks} marks, about ${s.format.words ?? 150} words` : ""}${s.format.integer ? ", integer answer" : ""}); difficulty ${s.difficulty}; node ${nodes.indexOf(s.node) + 1}`)
    .join("\n");
}

const nodeListing = (nodes) => nodes.map((n, i) => `${i + 1}. ${n.path ?? n.name}${n.description ? ` — ${n.description}` : ""}`).join("\n");

function generationUser({ profile, nodes, passages, slots, avoid, retry }) {
  const types = [...new Set(slots.map((s) => s.format.type))];
  return (
    `Exam: ${profile.name}\n\nKnowledge-map nodes:\n${nodeListing(nodes)}\n\nSource passages:\n\n${formatPassages(passages)}\n\n` +
    (avoid.length ? `Do not repeat these existing questions:\n${avoid.map((s) => `- ${s.slice(0, 160)}`).join("\n")}\n\n` : "") +
    (retry ? `A previous version of this question was rejected: ${retry}\nWrite a NEW, unambiguous question with a correct key.\n\n` : "") +
    `Write these questions:\n${slotListing(slots, nodes)}\n\n` +
    `Fields by format type:\n${types.map((t) => `- ${t}: ${SHAPES[t]}`).join("\n")}\n\n` +
    'Return JSON: {"questions": [{"slot": number, "format": string, "difficulty": string, "nodes": [node numbers], "stem": string, …fields for its type…, "solution": string, "expectedSeconds": number, "passages": [passage numbers]}]}'
  );
}

// ---- Normalising and validating ------------------------------------------------------

const list = (v) => (Array.isArray(v) ? v : []);
const optionText = (o) => cleanText(typeof o === "string" ? o : o?.text, 600);

/** Model options + correct ids → shuffled options with ids A-D and the correct ids. */
function normaliseOptions(item) {
  const raw = list(item.options).slice(0, 6);
  const options = raw.map((o, i) => ({ id: cleanText(o?.id, 4).toUpperCase() || IDS[i], text: optionText(o) }));
  const correctRaw = list(item.correct ?? item.answer?.correct ?? item.correctOptions).map((c) => cleanText(String(c), 4).toUpperCase());
  const correctIdx = new Set(options.map((o, i) => (correctRaw.includes(o.id) ? i : -1)).filter((i) => i >= 0));
  const order = options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const shuffled = order.map((i, k) => ({ id: IDS[k] ?? String(k + 1), text: options[i].text }));
  const correct = order.map((i, k) => (correctIdx.has(i) ? shuffled[k].id : null)).filter(Boolean);
  return { options: shuffled, correct, problems: correctRaw.length && !correct.length ? ["the key names no listed option"] : [] };
}

/**
 * One generated item → { question, problems }. `question` is null when the
 * item is unusable; `problems` (validator failures) reject it.
 */
export function normaliseQuestion(item, { slot, nodes, passages, profile }) {
  const problems = [];
  if (!item || typeof item !== "object") return { question: null, problems: ["not an object"] };
  const format = slot.format;
  const stem = cleanText(item.stem ?? item.question, 3000);
  if (stem.length < 10) problems.push("stem missing or too short");
  const valid = new Set(passages.map((p) => p.number));
  const cited = [...new Set(list(item.passages).map(firstNumber).filter((n) => valid.has(n)))];
  const solutionRaw = cleanText(item.solution ?? item.explanation, 6000);
  for (const m of solutionRaw.matchAll(/\[(\d+)\]/g)) if (valid.has(Number(m[1])) && !cited.includes(Number(m[1]))) cited.push(Number(m[1]));
  const solution = solutionRaw.replace(/\[(\d+)\]/g, (m, n) => (valid.has(Number(n)) ? m : ""));
  if (!cited.length) problems.push("cites no source passage that exists");
  if (!solution && format.type !== "descriptive") problems.push("no solution");

  const nodeIds = [...new Set(list(item.nodes).map((n) => nodes[firstNumber(n) - 1]?.id).filter(Boolean))];
  if (!nodeIds.includes(slot.node.id)) nodeIds.unshift(slot.node.id);
  const difficulty = DIFFICULTIES.includes(item.difficulty) ? item.difficulty : slot.difficulty;
  const seconds = firstNumber(item.expectedSeconds ?? item.expected_seconds);
  const expectedSeconds = Math.round(clamp(Number.isFinite(seconds) ? seconds : format.seconds ?? 120, 15, 1800));

  let options = null;
  let answer;
  const stemNorm = norm(stem);
  if (format.type === "mcq_single" || format.type === "mcq_multi") {
    const o = normaliseOptions(item);
    problems.push(...o.problems);
    options = o.options;
    if (options.length !== 4) problems.push(`needs exactly 4 options (got ${options.length})`);
    if (options.some((x) => !x.text)) problems.push("an option is empty");
    if (new Set(options.map((x) => norm(x.text))).size !== options.length) problems.push("options are not distinct");
    if (format.type === "mcq_single" && o.correct.length !== 1) problems.push(`needs exactly 1 correct option (got ${o.correct.length})`);
    if (format.type === "mcq_multi" && (o.correct.length < 1 || o.correct.length > 4)) problems.push("needs 1-4 correct options");
    for (const id of o.correct) {
      const text = norm(options.find((x) => x.id === id)?.text);
      if (text.length >= 6 && !/^[\d.\s]+$/.test(text) && stemNorm.includes(text)) problems.push("the correct option is given away in the stem");
    }
    answer = { correct: o.correct.sort() };
  } else if (format.type === "numerical") {
    const a = item.answer ?? {};
    const value = typeof a.value === "number" ? a.value : Number(String(a.value ?? a).replace(/[,\s]/g, ""));
    if (!Number.isFinite(value)) problems.push("numeric answer doesn't parse");
    if (format.integer && Number.isFinite(value) && !Number.isInteger(value)) problems.push("answer must be an integer");
    let tolerance = Math.abs(Number(a.tolerance));
    const cap = Math.max(Math.abs(value) * 0.05, 0.05);
    if (!Number.isFinite(tolerance)) tolerance = format.integer ? 0 : Math.max(Math.abs(value) * 0.01, 0.01);
    tolerance = format.integer ? 0 : Math.min(tolerance, cap);
    const unit = cleanText(a.unit, 30);
    // An integer-type answer may be a pure number; otherwise the unit must be given (or "none").
    const dimensionless = /^(none|dimensionless|unitless|-)$/i.test(unit) || (format.integer && !unit);
    if (!unit && !dimensionless) problems.push("unit missing");
    if (/\banswer\s+is\b/i.test(stem) || (Number.isFinite(value) && unit && !dimensionless && stem.includes(`${value} ${unit}`))) problems.push("the answer is given away in the stem");
    answer = { value, tolerance: Math.round(tolerance * 1e6) / 1e6, unit: dimensionless ? "" : unit };
  } else if (format.type === "matching") {
    const left = list(item.left).slice(0, 6).map((x, i) => ({ id: cleanText(x?.id, 4).toUpperCase() || "PQRST"[i], text: optionText(x) }));
    const right = list(item.right).slice(0, 7).map((x, i) => ({ id: cleanText(x?.id, 4) || String(i + 1), text: optionText(x) }));
    const pairs = {};
    for (const [k, v] of Object.entries(item.pairs ?? {})) pairs[cleanText(k, 4).toUpperCase()] = cleanText(String(v), 4);
    if (left.length < 3 || right.length < left.length) problems.push("matching needs 3+ items and as many answers");
    if (new Set(left.map((x) => x.id)).size !== left.length || new Set(right.map((x) => x.id)).size !== right.length) problems.push("duplicate ids in a list");
    if (left.some((x) => !right.some((r) => r.id === pairs[x.id]))) problems.push("a List-I item has no valid match");
    if (new Set([...left.map((x) => norm(x.text)), ...right.map((x) => norm(x.text))]).size !== left.length + right.length) problems.push("items are not distinct");
    options = { left, right };
    answer = { pairs: Object.fromEntries(left.map((x) => [x.id, pairs[x.id] ?? null])) };
  } else if (format.type === "one_word") {
    const text = cleanText(item.answerText ?? item.answer?.text ?? item.answer, 60);
    if (!text || text.split(/\s+/).length > 4) problems.push("one-word answer missing or too long");
    if (norm(text).length >= 4 && stemNorm.includes(norm(text))) problems.push("the answer is given away in the stem");
    answer = { text, accept: list(item.accept).map((a) => cleanText(a, 60)).filter(Boolean).slice(0, 6) };
  } else {
    const modelAnswer = cleanText(item.modelAnswer ?? item.answer?.modelAnswer, 8000).replace(/\[(\d+)\]/g, (m, n) => (valid.has(Number(n)) ? m : ""));
    let rubric = list(item.rubric)
      .map((r) => ({ point: cleanText(typeof r === "string" ? r : r?.point, 300), marks: Math.max(0, Number(r?.marks) || 0) }))
      .filter((r) => r.point)
      .slice(0, 12);
    if (!modelAnswer) problems.push("model answer missing");
    if (rubric.length < 2) problems.push("rubric needs at least 2 points");
    const total = rubric.reduce((s, r) => s + r.marks, 0);
    // Scale the rubric to the format's marks (half marks).
    rubric = rubric.map((r) => ({ ...r, marks: total ? Math.round(((r.marks / total) * format.marks) * 2) / 2 : Math.round((format.marks / rubric.length) * 2) / 2 }));
    answer = { modelAnswer, rubric };
  }

  const citationList = asCitations(passages.filter((p) => cited.includes(p.number)));
  return {
    question: {
      nodeIds,
      examType: profile.type ?? null,
      format: format.id,
      type: format.type,
      difficulty,
      stem,
      options,
      answer,
      solution: solution || (format.type === "descriptive" ? answer.modelAnswer : null),
      citations: citationList,
      expectedSeconds,
      marks: format.marks,
      negative: Math.round(format.negative * 100) / 100,
    },
    problems: [...new Set(problems)],
  };
}

// ---- Self-check --------------------------------------------------------------------

function solverPrompt(q, passages) {
  const head = `Source passages:\n\n${formatPassages(passages)}\n\nQuestion:\n${q.stem}\n\n`;
  if (q.type === "mcq_single" || q.type === "mcq_multi") {
    return (
      head +
      q.options.map((o) => `(${o.id}) ${o.text}`).join("\n") +
      `\n\n${q.type === "mcq_single" ? "Exactly one option is correct." : "One or more options are correct; choose all correct ones."}\nReturn JSON: {"correct": [option ids], "confidence": number (0-1)}`
    );
  }
  if (q.type === "numerical") return `${head}Give the numerical answer.\nReturn JSON: {"value": number, "unit": string, "confidence": number (0-1)}`;
  if (q.type === "matching") {
    return (
      head +
      `List-I:\n${q.options.left.map((x) => `(${x.id}) ${x.text}`).join("\n")}\nList-II:\n${q.options.right.map((x) => `(${x.id}) ${x.text}`).join("\n")}\n\n` +
      'Match every List-I item to one List-II item.\nReturn JSON: {"pairs": {"<List-I id>": "<List-II id>", …}, "confidence": number (0-1)}'
    );
  }
  return `${head}Answer in one word or a short phrase.\nReturn JSON: {"answer": string, "confidence": number (0-1)}`;
}

const sameWord = (a, b) => norm(a).replace(/\s+/g, "") === norm(b).replace(/\s+/g, "");

/** Whether the solver's answer matches the key: { match, solverAnswer, reason }. Pure. */
export function compareAnswer(q, out) {
  if (q.type === "mcq_single" || q.type === "mcq_multi") {
    const chosen = [...new Set(list(out?.correct ?? out?.answer).map((c) => cleanText(String(c), 4).toUpperCase()))].sort();
    const match = chosen.length === q.answer.correct.length && chosen.every((c, i) => c === q.answer.correct[i]);
    return { match, solverAnswer: { correct: chosen }, reason: match ? null : `an independent solve chose ${chosen.join(", ") || "nothing"}, not the key ${q.answer.correct.join(", ")}` };
  }
  if (q.type === "numerical") {
    const value = typeof out?.value === "number" ? out.value : Number(String(out?.value ?? "").replace(/[,\s]/g, ""));
    const match = Number.isFinite(value) && Math.abs(value - q.answer.value) <= q.answer.tolerance + 1e-9;
    return { match, solverAnswer: { value: Number.isFinite(value) ? value : null, unit: cleanText(out?.unit, 30) }, reason: match ? null : `an independent solve got ${Number.isFinite(value) ? value : "no number"}, not ${q.answer.value} ± ${q.answer.tolerance}` };
  }
  if (q.type === "matching") {
    const pairs = {};
    for (const [k, v] of Object.entries(out?.pairs ?? {})) pairs[cleanText(k, 4).toUpperCase()] = cleanText(String(v), 4);
    const match = Object.entries(q.answer.pairs).every(([k, v]) => pairs[k] === v);
    return { match, solverAnswer: { pairs }, reason: match ? null : "an independent solve matched the lists differently" };
  }
  const text = cleanText(out?.answer ?? out?.text, 80);
  const match = [q.answer.text, ...q.answer.accept].some((a) => sameWord(a, text));
  return { match, solverAnswer: { text }, reason: match ? null : `an independent solve answered "${text}", not "${q.answer.text}"` };
}

/** The independent check of one question (never sees the key or solution). */
async function selfCheck(q, passages, language) {
  if (q.type === "descriptive") {
    const out = await completeJson(
      RUBRIC_PROMPT,
      `Source passages:\n\n${formatPassages(passages)}\n\nQuestion (${q.marks} marks): ${q.stem}\n\nRubric:\n${q.answer.rubric.map((r, i) => `${i + 1}. ${r.point} (${r.marks} marks)`).join("\n")}\n\n` +
        'Return JSON: {"points": [{"point": number, "supported": boolean, "passage": number | null}]}',
      { task: "self_check", language }
    );
    const supported = new Set(list(out?.points).filter((p) => p?.supported === true).map((p) => firstNumber(p.point) - 1));
    const marks = q.answer.rubric.reduce((s, r, i) => s + (supported.has(i) ? r.marks : 0), 0);
    const share = q.marks ? marks / q.marks : 0;
    const match = share >= RUBRIC_COVERAGE - 1e-9;
    return { match, solverAnswer: { supportedPoints: [...supported].map((i) => i + 1).sort((a, b) => a - b), coverage: Math.round(share * 100) / 100 }, reason: match ? null : `the sources support only ${Math.round(share * 100)}% of the rubric` };
  }
  const out = await completeJson(SOLVE_PROMPT, solverPrompt(q, passages), { task: "self_check", language });
  return compareAnswer(q, out);
}

// ---- Generation ----------------------------------------------------------------------

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    })
  );
  return results;
}

/** Generated items by slot (1-based "slot" field, else in order). */
function bySlot(out, count) {
  const raw = list(out?.questions ?? out);
  const result = new Array(count).fill(null);
  raw.forEach((item, i) => {
    const s = firstNumber(item?.slot) - 1;
    const index = Number.isInteger(s) && s >= 0 && s < count && !result[s] ? s : result.indexOf(null);
    if (index >= 0 && !result[index]) result[index] = item;
  });
  return result;
}

/**
 * Generates `count` self-checked questions for `nodes` (knowledge-map nodes
 * with a `path`). `sources`: the course's ready notes/syllabus. Returns
 * { questions: [...] (verified and rejected, ready to store), verified, rejected }.
 * `onProgress({ done, total })` after each question settles.
 */
export async function generateQuestions({ notebook, nodes, sources, count, formatIds, difficulty, avoid = [], language, onProgress }) {
  const profile = profileFor(notebook);
  const passages = await retrievePassages(sources, nodes.map((n) => `${n.path ?? n.name}. ${n.description ?? ""}`).join("\n"), { k: Math.min(16, 6 + count), fetchK: 60 });
  if (!passages.length) throw Object.assign(new Error("Your notes have no text about these topics to write questions from."), { status: 409 });
  const formats = pickFormats(profile, count, formatIds);
  const slots = formats.map((format, i) => ({
    format,
    node: nodes[i % nodes.length],
    difficulty: difficulty === "mixed" || !difficulty ? DIFFICULTIES[i % 3] : difficulty,
  }));

  const first = bySlot(await completeJson(GEN_PROMPT, generationUser({ profile, nodes, passages, slots, avoid, retry: null }), { task: "generate_questions", language }), slots.length);
  let done = 0;
  const settled = await mapLimit(slots, CONCURRENCY, async (slot, i) => {
    const attempts = [];
    let item = first[i];
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        try {
          const retry = attempts.at(-1).reasons.join("; ");
          item = bySlot(await completeJson(GEN_PROMPT, generationUser({ profile, nodes, passages, slots: [slot], avoid, retry }), { task: "generate_questions", language }), 1)[0];
        } catch (err) {
          attempts.push({ attempt: attempt + 1, reasons: [`regeneration failed: ${err.message.slice(0, 120)}`] });
          continue;
        }
      }
      const { question, problems } = normaliseQuestion(item, { slot, nodes, passages, profile });
      if (!question || problems.length) {
        attempts.push({ attempt: attempt + 1, reasons: problems.length ? problems : ["missing from the model's reply"], stem: question?.stem?.slice(0, 200) });
        continue;
      }
      let check;
      try {
        check = await selfCheck(question, passages, language);
      } catch (err) {
        check = { match: false, solverAnswer: null, reason: `the self-check failed: ${err.message.slice(0, 120)}` };
      }
      attempts.push({ attempt: attempt + 1, reasons: check.match ? [] : [check.reason], solverAnswer: check.solverAnswer, stem: question.stem.slice(0, 200) });
      if (check.match) {
        onProgress?.({ done: ++done, total: slots.length });
        return { ...question, verified: true, verification: { status: "verified", attempts: attempts.length, solverAnswer: check.solverAnswer, history: attempts } };
      }
      if (attempt === MAX_RETRIES) {
        onProgress?.({ done: ++done, total: slots.length });
        return { ...question, verified: false, verification: { status: "rejected", attempts: attempts.length, solverAnswer: check.solverAnswer, reasons: check.reason ? [check.reason] : [], history: attempts } };
      }
    }
    onProgress?.({ done: ++done, total: slots.length });
    return null; // never produced a valid question: discarded (nothing to store)
  });
  const questions = settled.filter(Boolean);
  return { questions, verified: questions.filter((q) => q.verified).length, rejected: slots.length - questions.filter((q) => q.verified).length };
}
