import { completeJson } from "./llm.js";
import { cleanText, firstNumber } from "./studyContext.js";
import { courseProgress, refreshUnitTopics } from "./topics.js";
import { topicExamWeight } from "./pastPapers.js";
import { listUnits } from "../db/store.js";
import { listTopics } from "../db/practice.js";
import { cardsInScope, deletePlanItems, listPlanItems, moveItems, replacePlan } from "../db/exams.js";

// Day-by-day revision plans. Dates, phases and counts are computed here from
// topic mastery, how often topics come up in past papers and the cards due;
// the model only orders the topics (prerequisites first) and writes a short
// focus tip for each.

export const TASK_TYPES = ["read", "flashcards", "quiz", "answer", "past_paper"];
const MAX_PLAN_DAYS = 90;
const LEARN_SHARE = 0.65; // first part of the plan covers every topic; the rest reviews
const QUIZ_QUESTIONS = 5;
const MAX_TASKS_PER_DAY = 8; // besides the daily flashcards

// ---- Dates ("YYYY-MM-DD", calendar arithmetic in UTC) ---------------------------------

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The study days of a plan: today up to the day before the exam (at most MAX_PLAN_DAYS, the last ones). */
export function planDays(today, examDate) {
  const last = examDate > today ? addDays(examDate, -1) : today;
  const count = Math.min(MAX_PLAN_DAYS, daysBetween(today, last) + 1);
  const first = addDays(last, -(count - 1));
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}

// ---- Priorities ---------------------------------------------------------------------

/**
 * Topics in scope with { mastery, examWeight, priority } — weak and
 * often-examined topics first. Unpractised topics count as fairly weak.
 */
export function prioritise(topics, masteryById, weightById) {
  const weights = [...weightById.values()];
  const maxCount = Math.max(1, ...weights.map((w) => w.count));
  const maxMarks = Math.max(1, ...weights.map((w) => w.totalMarks));
  return topics
    .map((t) => {
      const mastery = masteryById.get(t.id) ?? null;
      const w = weightById.get(t.id);
      const examWeight = w ? 0.5 * (w.count / maxCount) + 0.5 * (w.totalMarks / maxMarks) : 0;
      const weakness = mastery === null ? 0.7 : 1 - mastery;
      return { ...t, mastery, examCount: w?.count ?? 0, examWeight, priority: 0.6 * weakness + 0.4 * examWeight };
    })
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

const ORDER_PROMPT = [
  "You plan a college student's revision before an exam.",
  "Given the exam topics (with the student's mastery and how often each appears in past papers), order them for studying: foundations and prerequisites before topics that build on them, otherwise weakest and most-examined first.",
  "For each topic write one short, specific tip (max 20 words) on what to focus on.",
].join("\n");

/** Topic order and tips from the model; falls back to priority order without tips. */
async function orderTopics(exam, ranked, language) {
  if (ranked.length === 0) return { order: [], tips: new Map() };
  const listing = ranked
    .map(
      (t, i) =>
        `${i + 1}. ${t.name}${t.unitTitle ? ` (${t.unitTitle})` : ""} — mastery ${t.mastery === null ? "not practised" : `${Math.round(t.mastery * 100)}%`}` +
        (t.examCount ? `, asked ${t.examCount}× in past papers` : "")
    )
    .join("\n");
  try {
    const out = await completeJson(
      ORDER_PROMPT,
      `Exam: ${exam.name}\n\nTopics:\n${listing}\n\nReturn JSON: {"order": [topic numbers], "tips": [{"topic": number, "tip": string}]}`,
      { language }
    );
    const seen = new Set();
    const order = [];
    for (const n of Array.isArray(out?.order) ? out.order : []) {
      const i = firstNumber(n) - 1;
      if (ranked[i] && !seen.has(i)) {
        seen.add(i);
        order.push(ranked[i]);
      }
    }
    for (const [i, t] of ranked.entries()) if (!seen.has(i)) order.push(t); // anything the model left out
    const tips = new Map();
    for (const item of Array.isArray(out?.tips) ? out.tips : []) {
      const t = ranked[firstNumber(item?.topic) - 1];
      const tip = cleanText(item?.tip, 200);
      if (t && tip) tips.set(t.id, tip);
    }
    return { order, tips };
  } catch (err) {
    console.warn(`Plan ordering failed, using priority order: ${err.message}`);
    return { order: ranked, tips: new Map() };
  }
}

// ---- Building the plan ---------------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Pure planner: { days, ordered topics (with priority), tips, cards, hasPapers }
 * → [{ date, position, type, unitId, topicId, title, details, targetCount }].
 */
export function layoutPlan({ days, topics, tips = new Map(), cards = { due: 0, fresh: 0, total: 0 }, hasPapers = false }) {
  const n = days.length;
  const byDay = days.map(() => []);
  const add = (dayIndex, item) => byDay[clamp(dayIndex, 0, n - 1)].push(item);
  const tip = (t, fallback) => tips.get(t.id) ?? fallback;

  // Daily flashcards: today's due cards, then an even share of the new ones.
  if (cards.total > 0) {
    const daily = clamp(Math.ceil(cards.fresh / n) + 10, 10, 60);
    days.forEach((_, i) => {
      const target = i === 0 ? clamp(Math.max(cards.due, daily), 5, 100) : daily;
      add(i, { type: "flashcards", title: `Review ${target} flashcards`, details: "Due cards first, then new ones.", targetCount: target });
    });
  }

  // Learn phase: every topic once — read it, quiz it the next day, and write
  // an answer for weak or often-examined topics a little later.
  const learnDays = n <= 2 ? n : Math.max(1, Math.round(n * LEARN_SHARE));
  const heavy = new Set(topics.filter((t, i) => t.examCount > 0 || i < Math.ceil(topics.length * 0.4)).map((t) => t.id));
  topics.forEach((t, i) => {
    const readDay = Math.floor((i * learnDays) / topics.length);
    const base = { unitId: t.unitId ?? null, topicId: t.id };
    if (n <= 2) {
      // Cramming: a quick quiz per topic tells you where to look.
      add(readDay, { ...base, type: "quiz", title: `Quiz: ${t.name}`, details: tip(t, "Quick check — read up on anything you get wrong."), targetCount: QUIZ_QUESTIONS });
      if (hasPapers && t.examCount > 0) add(readDay, { ...base, type: "past_paper", title: `Past-paper questions: ${t.name}`, details: `Asked ${t.examCount}× before.`, targetCount: Math.min(3, t.examCount) });
      return;
    }
    add(readDay, { ...base, type: "read", title: `Read & summarise: ${t.name}`, details: tip(t, "Go through your notes, then ask the chat to explain anything unclear.") });
    add(Math.min(readDay + 1, learnDays - 1), { ...base, type: "quiz", title: `Quiz: ${t.name}`, details: `${QUIZ_QUESTIONS} questions — aim for 4/5.`, targetCount: QUIZ_QUESTIONS });
    if (heavy.has(t.id)) {
      const marks = t.examCount > 1 ? 10 : 5;
      add(Math.min(readDay + 2, n - 1), { ...base, type: "answer", title: `Write a ${marks}-mark answer: ${t.name}`, details: "Write it without notes, then compare with the graded feedback.", targetCount: marks });
    }
  });

  // Review phase: the weakest / most important topics again, past-paper practice.
  const review = [...topics].sort((a, b) => b.priority - a.priority);
  const examined = review.filter((t) => t.examCount > 0);
  let r = 0;
  let p = 0;
  for (let d = learnDays; d < n; d++) {
    const last = d === n - 1;
    if (last && n > 2) {
      add(d, { type: "quiz", title: "Mixed quiz on all exam topics", details: "A final check across everything — revise any topic you get wrong.", targetCount: 15 });
    }
    for (let k = 0; k < (last ? 1 : 2) && review.length; k++) {
      const t = review[r++ % review.length];
      add(d, { unitId: t.unitId ?? null, topicId: t.id, type: "quiz", title: `Quiz: ${t.name}`, details: "Second pass — focus on what you missed last time.", targetCount: QUIZ_QUESTIONS });
    }
    if (hasPapers && examined.length) {
      const t = examined[p++ % examined.length];
      add(d, { unitId: t.unitId ?? null, topicId: t.id, type: "past_paper", title: `Past-paper questions: ${t.name}`, details: `Asked ${t.examCount}× before — practise a real exam question.`, targetCount: Math.min(3, t.examCount) });
    }
  }

  // A short runway would cram too much into a day: keep the most important
  // topics' tasks (a mixed quiz, without a topic, always stays).
  const priority = new Map(topics.map((t) => [t.id, t.priority ?? 0]));
  const rankOf = (item) => (item.topicId ? priority.get(item.topicId) ?? 0 : Infinity);
  const capped = byDay.map((items) => {
    const cards = items.filter((it) => it.type === "flashcards");
    const rest = items.filter((it) => it.type !== "flashcards");
    if (rest.length <= MAX_TASKS_PER_DAY) return items;
    const keep = new Set([...rest].sort((a, b) => rankOf(b) - rankOf(a)).slice(0, MAX_TASKS_PER_DAY));
    return [...cards, ...rest.filter((it) => keep.has(it))];
  });

  const order = { flashcards: 0, read: 1, quiz: 2, answer: 3, past_paper: 4 };
  return capped.flatMap((items, i) =>
    items
      .sort((a, b) => order[a.type] - order[b.type])
      .map((item, position) => ({ unitId: null, topicId: null, targetCount: null, ...item, date: days[i], position }))
  );
}

/** Generates (or regenerates) an exam's plan from `today`, keeping tasks already done. `language`: for the tips. */
export async function generatePlan(exam, userId, today, { language } = {}) {
  const units = await listUnits(exam.notebookId);
  const unitIds = new Set(units.map((u) => u.id));
  const chosen = exam.unitIds.map((u) => (u === "general" ? null : u)).filter((u) => u === null || unitIds.has(u));
  const scope = chosen.length ? chosen : [...units.map((u) => u.id), null];
  await Promise.all(scope.map((u) => refreshUnitTopics(exam.notebookId, u).catch(() => {})));

  const [allTopics, progress, weights, cards] = await Promise.all([
    listTopics(exam.notebookId),
    courseProgress(exam.notebookId, userId),
    topicExamWeight(exam.notebookId),
    cardsInScope(exam.notebookId, userId, chosen.length ? chosen : null),
  ]);
  const topics = allTopics.filter((t) => scope.includes(t.unitId));
  if (topics.length === 0) {
    throw Object.assign(new Error("There are no topics in the chosen units yet. Add course material (and wait for it to finish processing) first."), { status: 409 });
  }
  const mastery = new Map(progress.units.flatMap((u) => u.topics).map((t) => [t.id, t.mastery]));
  const unitTitle = new Map(units.map((u) => [u.id, u.title]));
  const ranked = prioritise(
    topics.map((t) => ({ ...t, unitTitle: t.unitId ? unitTitle.get(t.unitId) : "General" })),
    mastery,
    weights
  );
  const { order, tips } = await orderTopics(exam, ranked, language);
  const items = layoutPlan({ days: planDays(today, exam.examDate), topics: order, tips, cards, hasPapers: weights.size > 0 });
  await replacePlan(exam.id, items);
  return items.length;
}

/**
 * Re-plans missed days: undone tasks dated before today move onto the
 * remaining days (each to the day with the fewest tasks, earliest first).
 * Returns how many tasks moved.
 */
export async function replanMissed(exam, today) {
  const items = await listPlanItems(exam.id);
  const missed = items.filter((i) => !i.done && i.date < today && i.type !== "flashcards");
  const staleCards = items.filter((i) => !i.done && i.date < today && i.type === "flashcards");
  const days = planDays(today, exam.examDate);
  const load = new Map(days.map((d) => [d, items.filter((i) => i.date === d && i.type !== "flashcards").length]));
  const nextPos = new Map(days.map((d) => [d, Math.max(-1, ...items.filter((i) => i.date === d).map((i) => i.position)) + 1]));
  const moves = missed.map((item) => {
    const date = days.reduce((best, d) => (load.get(d) < load.get(best) ? d : best), days[0]);
    load.set(date, load.get(date) + 1);
    const position = nextPos.get(date);
    nextPos.set(date, position + 1);
    return { id: item.id, date, position };
  });
  // Missed flashcard sessions aren't stacked up — today's due count covers them.
  if (staleCards.length) await deletePlanItems(staleCards.map((i) => i.id));
  await moveItems(moves);
  return moves.length;
}
