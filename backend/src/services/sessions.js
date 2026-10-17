import { generateQuestions, pickFormats, profileFor } from "./questionGen.js";
import { gradeAnswer, isAttempted } from "./sessionGrading.js";
import { nodesWithPaths, questionSources } from "./questionJobs.js";
import { nodeMastery, subtreeIds } from "./knowledgeMap.js";
import { listNodes, nodeEvents } from "../db/knowledgeMap.js";
import { insertBankQuestions, listBankQuestions } from "../db/questionBank.js";
import { addTopicEvents } from "../db/practice.js";
import { recordActivity } from "../db/exams.js";
import { diagnoseSession } from "./diagnosis.js";
import { sessionDiagnoses } from "../db/diagnoses.js";
import {
  claimSession,
  createSession,
  getSession,
  seenQuestionIds,
  sessionAnswers,
  sessionQuestions,
  setSessionQuestions,
  updateAnswer,
  updateSession,
} from "../db/sessions.js";

// Practice sessions: topic drill (instant feedback), mixed practice, timed
// sectional test and full mock in the exam pattern (count, duration and
// marking from the profile). Questions come from the verified bank; missing
// ones are generated (and self-checked) while the session is "preparing".

export const SESSION_KINDS = ["drill", "mixed", "sectional", "mock"];
const KIND_TITLE = { drill: "Topic drill", mixed: "Mixed practice", sectional: "Sectional test", mock: "Full mock" };
const GEN_CHUNK = 10;
const GRADE_CONCURRENCY = 4;
const GRACE_MS = 5000;

const preparing = new Map(); // sessionId → { done, total }

/** Seconds per question in the exam's pattern (for timing a sectional test). */
function patternSecondsPerQuestion(profile) {
  const m = profile.mock ?? {};
  if (m.perSubject) return (m.minutesPerSubject * 60) / m.perSubject.reduce((s, p) => s + p.count, 0);
  if (m.whole) return (m.minutes * 60) / m.whole.reduce((s, p) => s + p.count, 0);
  return 120;
}

/**
 * The questions a session needs: [{ format, section, scope (node ids) }],
 * its duration and title. `scopeNodes` = chosen nodes (or all subjects).
 */
export function planSession({ kind, profile, nodes, chosen, count, minutes }) {
  const scopeOf = (ids) => [...new Set(ids.flatMap((id) => subtreeIds(nodes, id)))];
  const chosenScope = chosen.length ? scopeOf(chosen.map((n) => n.id)) : nodes.map((n) => n.id);
  const named = chosen.map((n) => n.name).slice(0, 3).join(", ");
  if (kind === "mock") {
    const m = profile.mock;
    const subjects = nodes.filter((n) => n.level === "subject");
    if (m.perSubject) {
      const wanted = subjects.filter((s) => profile.subjects.some((p) => p.toLowerCase() === s.name.toLowerCase()));
      const list = wanted.length ? wanted : subjects;
      const slots = list.flatMap((s) =>
        m.perSubject.flatMap((p) => Array.from({ length: p.count }, () => ({ format: profile.formats.find((f) => f.id === p.format), section: s.name, scope: scopeOf([s.id]) })))
      );
      return { slots, durationSeconds: m.minutesPerSubject * 60 * Math.max(1, list.length), title: `${profile.name} full mock` };
    }
    const all = nodes.map((n) => n.id);
    const slots = m.whole.flatMap((p) => {
      const format = profile.formats.find((f) => f.id === p.format);
      return Array.from({ length: p.count }, () => ({ format, section: format.label, scope: all }));
    });
    return { slots, durationSeconds: m.minutes * 60, title: `${profile.name} full mock` };
  }
  const slots = pickFormats(profile, count).map((format) => ({ format, section: null, scope: chosenScope }));
  const durationSeconds =
    minutes > 0 ? minutes * 60 : kind === "sectional" ? Math.round((patternSecondsPerQuestion(profile) * count) / 60) * 60 || 60 : null;
  return { slots, durationSeconds, title: `${KIND_TITLE[kind]}${named ? `: ${named}` : ""}` };
}

/** Bank questions for the slots (fresh ones first); null where none fits. */
function pickFromBank(slots, bank, seen, examType) {
  const used = new Set();
  // A format id means different marking in another exam (e.g. "mcq" is +4/−1 in JEE Main, +3/−1 in JEE Advanced).
  bank = bank.filter((q) => (q.examType ?? "university") === examType);
  const ordered = [...bank].sort((a, b) => Number(seen.has(a.id)) - Number(seen.has(b.id)) || Math.random() - 0.5);
  return slots.map((slot) => {
    const scope = new Set(slot.scope);
    const q = ordered.find((x) => !used.has(x.id) && x.format === slot.format.id && x.nodeIds.some((id) => scope.has(id)));
    if (!q) return null;
    used.add(q.id);
    return q;
  });
}

/** Topic nodes of a scope to generate for: high exam weight and weak first. */
function generationNodes(nodes, scopeIds, mastery) {
  const scope = new Set(scopeIds);
  const topics = nodes.filter((n) => scope.has(n.id) && n.level === "topic");
  const pool = topics.length ? topics : nodes.filter((n) => scope.has(n.id) && n.level !== "subject");
  const priority = (n) => (n.weight ?? 0.5) * 0.5 + (1 - (mastery.get(n.id)?.score ?? 0.4)) * 0.5;
  return [...pool].sort((a, b) => priority(b) - priority(a)).slice(0, 5);
}

/**
 * Fills a session: picks from the bank, generates what's missing (chunks
 * per format and scope), then sets status ready (or error if nothing fits).
 */
async function prepare(session, { notebook, userId, plan, language }) {
  const progress = { done: 0, total: plan.slots.length };
  preparing.set(session.id, progress);
  try {
    const nodes = await listNodes(notebook.id);
    const [seen, events] = await Promise.all([seenQuestionIds(notebook.id, userId), nodeEvents(notebook.id, userId)]);
    const seenSet = new Set(seen);
    const allScope = [...new Set(plan.slots.flatMap((s) => s.scope))];
    let bank = await listBankQuestions(notebook.id, { nodeIds: allScope, limit: 2000 });
    let picked = pickFromBank(plan.slots, bank, seenSet, plan.examType);
    progress.done = picked.filter(Boolean).length;

    const missing = plan.slots.map((s, i) => (picked[i] ? null : { ...s, index: i })).filter(Boolean);
    if (missing.length) {
      const sources = await questionSources(notebook.id);
      const mastery = nodeMastery(nodes, events);
      const groups = new Map();
      for (const m of missing) {
        const key = `${m.format.id}|${m.scope.join(",")}`;
        if (!groups.has(key)) groups.set(key, { format: m.format, scope: m.scope, count: 0 });
        groups.get(key).count += 1;
      }
      for (const g of groups.values()) {
        const genNodes = await nodesWithPaths(notebook.id, generationNodes(nodes, g.scope, mastery).map((n) => n.id));
        if (!genNodes.length || !sources.length) continue;
        for (let left = g.count; left > 0; left -= GEN_CHUNK) {
          try {
            const result = await generateQuestions({ notebook, nodes: genNodes, sources, count: Math.min(GEN_CHUNK, left), formatIds: [g.format.id], difficulty: "mixed", language });
            await insertBankQuestions(notebook.id, userId, result.questions);
            progress.done += result.verified;
          } catch (err) {
            console.warn(`Generating questions for session ${session.id} failed: ${err.message}`);
          }
        }
      }
      bank = await listBankQuestions(notebook.id, { nodeIds: allScope, limit: 2000 });
      picked = pickFromBank(plan.slots, bank, seenSet, plan.examType);
    }
    const chosen = plan.slots.map((s, i) => (picked[i] ? { questionId: picked[i].id, section: s.section } : null)).filter(Boolean);
    if (!chosen.length) {
      await updateSession(session.id, { status: "error", error: "No questions could be prepared — add notes for these topics (or check the AI settings) and try again." });
      return;
    }
    await setSessionQuestions(session.id, chosen);
    // A shorter test keeps the pattern's time per question.
    const duration = session.durationSeconds && chosen.length < plan.slots.length ? Math.max(60, Math.round((session.durationSeconds * chosen.length) / plan.slots.length / 60) * 60) : undefined;
    await updateSession(session.id, { status: "ready", durationSeconds: duration, error: chosen.length < plan.slots.length ? `Only ${chosen.length} of ${plan.slots.length} questions could be prepared.` : null });
  } catch (err) {
    console.warn(`Preparing session ${session.id} failed: ${err.message}`);
    await updateSession(session.id, { status: "error", error: err.message.slice(0, 300) });
  } finally {
    preparing.delete(session.id);
  }
}

/** A drill on given bank questions (follow-ups of a diagnosis, "Fix this"): ready at once. */
export async function createQuestionDrill({ notebook, userId, questions, title }) {
  const session = await createSession({
    notebookId: notebook.id,
    userId,
    kind: "drill",
    examType: profileFor(notebook).type,
    title,
    nodeIds: [...new Set(questions.flatMap((q) => q.nodeIds))].slice(0, 5),
    status: "ready",
    settings: { count: questions.length, instantFeedback: true, followUp: true },
  });
  await setSessionQuestions(session.id, questions.map((q) => ({ questionId: q.id, section: null })));
  return { ...session, questionCount: questions.length };
}

/** Creates a session and starts preparing it (in the background). */
export async function createPracticeSession({ notebook, userId, kind, chosen, count, minutes, language }) {
  const profile = profileFor(notebook);
  const nodes = await listNodes(notebook.id);
  const plan = { ...planSession({ kind, profile, nodes, chosen, count, minutes }), examType: profile.type };
  if (!plan.slots.length) throw Object.assign(new Error("This exam pattern has no questions for the course's subjects."), { status: 409 });
  const session = await createSession({
    notebookId: notebook.id,
    userId,
    kind,
    examType: profile.type,
    title: plan.title,
    nodeIds: chosen.map((n) => n.id),
    durationSeconds: plan.durationSeconds,
    status: "preparing",
    settings: { count: plan.slots.length, instantFeedback: kind === "drill", minutes: minutes || null },
  });
  prepare(session, { notebook, userId, plan, language });
  return session;
}

// ---- Clock -------------------------------------------------------------------------

/** Seconds left on the test clock (null when untimed or not started). */
export function remainingSeconds(session, now = Date.now()) {
  if (!session.durationSeconds || !session.startedAt) return null;
  return Math.max(0, Math.round(session.durationSeconds - (now - Date.parse(session.startedAt)) / 1000));
}

export const timeIsUp = (session) => session.status === "active" && remainingSeconds(session) === 0;

export async function startSession(session) {
  if (session.status === "active") return;
  if (session.status !== "ready") throw Object.assign(new Error(session.status === "preparing" ? "The questions are still being prepared." : "This session can't be started."), { status: 409 });
  await claimSession(session.id, ["ready"], "active", ", started_at = NOW()");
}

// ---- Answers -----------------------------------------------------------------------

const MAX_TEXT = 12_000;

/** Validates an answer for a question's type (throws { status: 400 }). */
export function cleanAnswer(q, raw) {
  const fail = (m) => Object.assign(new Error(m), { status: 400 });
  if (raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw fail("answer must be an object.");
  if (q.type === "mcq_single" || q.type === "mcq_multi") {
    const ids = new Set(q.options.map((o) => o.id));
    if (!Array.isArray(raw.choice) || raw.choice.some((c) => !ids.has(c))) throw fail("choice must list option ids.");
    const choice = [...new Set(raw.choice)].sort();
    if (q.type === "mcq_single" && choice.length > 1) throw fail("Pick one option.");
    return { choice };
  }
  if (q.type === "numerical") {
    if (raw.value !== undefined && typeof raw.value !== "string" && typeof raw.value !== "number") throw fail("value must be text or a number.");
    return { value: String(raw.value ?? "").slice(0, 40), unit: typeof raw.unit === "string" ? raw.unit.slice(0, 20) : "" };
  }
  if (q.type === "matching") {
    const left = new Set(q.options.left.map((x) => x.id));
    const right = new Set(q.options.right.map((x) => x.id));
    const pairs = {};
    for (const [k, v] of Object.entries(raw.pairs ?? {})) {
      if (!left.has(k) || (v !== "" && !right.has(v))) throw fail("pairs must match List-I ids to List-II ids.");
      if (v) pairs[k] = v;
    }
    return { pairs };
  }
  if (typeof raw.text !== "string") throw fail("text must be a string.");
  return { text: raw.text.slice(0, q.type === "one_word" ? 80 : MAX_TEXT) };
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const CONFIDENCE = ["sure", "unsure", "guess"];

/**
 * Saves what the student did on a question: answer (counts changes and the
 * clock when answered), total time spent on it, confidence, working text.
 * With `check` (drills), grades it now and locks it.
 */
export async function saveAnswer(session, position, body, { language } = {}) {
  const items = await sessionQuestions(session.id, { withKey: Boolean(body.check) });
  const item = items.find((i) => i.position === position);
  if (!item) throw Object.assign(new Error("That question isn't in this session."), { status: 404 });
  const current = (await sessionAnswers(session.id)).find((a) => a.position === position);
  if (current.locked) throw Object.assign(new Error("This answer was already checked."), { status: 409 });
  const patch = {};
  if (body.answer !== undefined) {
    const answer = cleanAnswer(item.question, body.answer);
    if (!same(answer, current.answer)) {
      patch.answer = answer;
      if (isAttempted(item.question.type, current.answer)) patch.answerChanges = current.answerChanges + 1;
      patch.answeredAt = new Date();
      patch.timeRemainingS = remainingSeconds(session);
    }
  }
  if (body.timeSpentMs !== undefined) {
    const t = Number(body.timeSpentMs);
    if (!Number.isFinite(t) || t < 0) throw Object.assign(new Error("timeSpentMs must be a number of milliseconds."), { status: 400 });
    const elapsed = session.startedAt ? Date.now() - Date.parse(session.startedAt) + GRACE_MS : t;
    patch.timeSpentMs = Math.round(Math.min(Math.max(t, current.timeSpentMs), elapsed));
  }
  if (body.confidence !== undefined) {
    if (body.confidence !== null && !CONFIDENCE.includes(body.confidence)) throw Object.assign(new Error("confidence must be sure, unsure or guess."), { status: 400 });
    patch.confidence = body.confidence;
  }
  if (body.workingText !== undefined) {
    if (body.workingText !== null && typeof body.workingText !== "string") throw Object.assign(new Error("workingText must be text."), { status: 400 });
    patch.workingText = body.workingText ? body.workingText.slice(0, 4000) : null;
  }
  let saved = Object.keys(patch).length ? await updateAnswer(session.id, position, patch) : current;
  if (body.check) {
    if (!session.settings.instantFeedback) throw Object.assign(new Error("Answers are checked when you submit the test."), { status: 409 });
    const graded = await gradeAnswer(item.question, saved.answer, { language });
    saved = await updateAnswer(session.id, position, { ...graded, locked: true });
    await recordEvidence(session, [{ ...saved, question: item.question }]);
    if (saved.correct === false) diagnoseSession(session, { language, positions: [position] });
    return { ...saved, key: item.question.answer, solution: item.question.solution };
  }
  return saved;
}

// ---- Finishing -----------------------------------------------------------------------

async function mapLimit(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/** Mastery evidence per tagged node (and its linked course topic) for graded answers. */
async function recordEvidence(session, graded) {
  const nodes = await listNodes(session.notebookId);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const events = [];
  for (const a of graded) {
    if (!a.attempted) continue;
    for (const nodeId of a.question.nodeIds) {
      const node = byId.get(nodeId);
      if (node) events.push({ nodeId, topicId: node.topicId, kind: "practice", score: a.fraction ?? (a.correct ? 1 : 0), weight: a.question.type === "descriptive" ? Math.min(3, a.question.marks / 5 + 0.5) : 1 });
    }
  }
  await addTopicEvents(session.userId, events);
}

/**
 * Submits a session: grades every answer not checked yet, totals the marks
 * and records mastery evidence and activity. One caller wins (status claim).
 */
export async function finishSession(session, { tz, language } = {}) {
  if (!(await claimSession(session.id, ["active", "ready"], "grading", ", finished_at = NOW()"))) {
    if (session.status === "finished" || session.status === "grading") return;
    throw Object.assign(new Error("This session can't be submitted."), { status: 409 });
  }
  try {
    const [items, answers] = await Promise.all([sessionQuestions(session.id, { withKey: true }), sessionAnswers(session.id)]);
    const byPos = new Map(items.map((i) => [i.position, i.question]));
    const toGrade = answers.filter((a) => !a.locked);
    const graded = [];
    await mapLimit(toGrade, GRADE_CONCURRENCY, async (a) => {
      const q = byPos.get(a.position);
      let result;
      try {
        result = await gradeAnswer(q, a.answer, { language });
      } catch (err) {
        result = { attempted: isAttempted(q.type, a.answer), correct: null, fraction: 0, marks: 0, grading: { by: "error", reason: `Couldn't be graded: ${err.message.slice(0, 200)}` } };
      }
      graded.push({ ...(await updateAnswer(session.id, a.position, { ...result, locked: true })), question: q });
    });
    await recordEvidence(session, graded.filter((g) => g.correct !== null));
    const all = await sessionAnswers(session.id);
    const score = Math.round(all.reduce((s, a) => s + (a.marks ?? 0), 0) * 100) / 100;
    const maxScore = Math.round(items.reduce((s, i) => s + i.question.marks, 0) * 100) / 100;
    await updateSession(session.id, { status: "finished", score, maxScore });
    const attempted = all.filter((a) => a.attempted).length;
    if (attempted && tz) await recordActivity(session.userId, tz, "practice", attempted);
    // Why each wrong answer went wrong (in the background; results show it when ready).
    diagnoseSession({ ...session, status: "finished", finishedAt: new Date().toISOString() }, { language });
  } catch (err) {
    await updateSession(session.id, { status: "active" });
    throw err;
  }
}

// ---- Reading -------------------------------------------------------------------------

/** The session for the player: questions (keys only for checked drill answers), your answers, the clock. */
export async function sessionView(session) {
  const [items, answers] = await Promise.all([sessionQuestions(session.id, { withKey: session.status === "finished" || session.settings.instantFeedback }), sessionAnswers(session.id)]);
  const reveal = (pos) => session.status === "finished" || answers.find((a) => a.position === pos)?.locked;
  return {
    ...session,
    remainingSeconds: remainingSeconds(session),
    preparing: preparing.get(session.id) ?? null,
    questions: items.map(({ position, section, question }) => {
      if (reveal(position)) return { position, section, question };
      const { answer, solution, verification, ...rest } = question;
      return { position, section, question: rest };
    }),
    answers,
  };
}

/** Results: score with the exam's marking, accuracy, time per question vs expected, and each solution. */
export async function sessionResults(session) {
  const [items, answers, nodes, diagnoses] = await Promise.all([
    sessionQuestions(session.id, { withKey: true }),
    sessionAnswers(session.id),
    listNodes(session.notebookId),
    sessionDiagnoses(session.id),
  ]);
  const nodeName = new Map(nodes.map((n) => [n.id, n.name]));
  const rows = items.map(({ position, section, question }) => {
    const a = answers.find((x) => x.position === position);
    return { position, section, question, ...a, nodeNames: question.nodeIds.map((id) => nodeName.get(id)).filter(Boolean), diagnosis: diagnoses.find((d) => d.position === position) ?? null };
  });
  const attempted = rows.filter((r) => r.attempted);
  const correct = attempted.filter((r) => r.correct);
  const elapsed = session.startedAt && session.finishedAt ? Math.round((Date.parse(session.finishedAt) - Date.parse(session.startedAt)) / 1000) : null;
  const timeUsed = elapsed !== null && session.durationSeconds ? Math.min(elapsed, session.durationSeconds) : elapsed;
  const bySection = new Map();
  for (const r of rows) {
    const key = r.section ?? "All";
    const s = bySection.get(key) ?? { section: key, marks: 0, maxMarks: 0, attempted: 0, correct: 0, questions: 0 };
    s.marks += r.marks ?? 0;
    s.maxMarks += r.question.marks;
    s.questions += 1;
    if (r.attempted) s.attempted += 1;
    if (r.correct) s.correct += 1;
    bySection.set(key, s);
  }
  return {
    session,
    summary: {
      score: session.score,
      maxScore: session.maxScore,
      questions: rows.length,
      attempted: attempted.length,
      correct: correct.length,
      wrong: attempted.length - correct.length,
      accuracy: attempted.length ? Math.round((correct.length / attempted.length) * 100) / 100 : null,
      negativeMarks: Math.round(rows.reduce((s, r) => s + Math.min(0, r.marks ?? 0), 0) * 100) / 100,
      timeUsedSeconds: timeUsed,
      expectedSeconds: rows.reduce((s, r) => s + r.question.expectedSeconds, 0),
      sections: [...bySection.values()].map((s) => ({ ...s, marks: Math.round(s.marks * 100) / 100 })),
    },
    rows,
  };
}

export { getSession };
