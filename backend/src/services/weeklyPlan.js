import { completeJson } from "./llm.js";
import { cleanText, firstNumber } from "./studyContext.js";
import { nodeMastery } from "./knowledgeMap.js";
import { profileFor } from "./questionGen.js";
import { addDays, daysBetween } from "./examPlan.js";
import { getNotebook } from "../db/store.js";
import { listEdges, listNodes, nodeEvents } from "../db/knowledgeMap.js";
import { listDiagnoses } from "../db/diagnoses.js";
import { addPlanChange, applyReplan, cardsInScope, listPlanItems, replaceWeekItems, setPlanState } from "../db/exams.js";

// The agent's weekly plan and daily replanning.
//   Weekly (Ultra, at the start of each study week or on demand; next week's straight away when
//     this week has no study days left): Ultra orders the week's focus
//     topics (high exam weight × low mastery, diagnosed misconceptions) and
//     words a reason for each; CODE computes and enforces everything else —
//     days, the student's minutes per weekday, rest day, session length,
//     prerequisites before dependants, task durations and counts, spaced
//     revision, one full mock.
//   Daily (Super, on the first visit of the day or the daily job): code
//     adjusts today and the rest of the week from yesterday — missed and skipped
//     tasks, new diagnoses, mastery changes — and Super explains each change in one line.

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DEFAULT_MINUTES = { mon: 120, tue: 120, wed: 120, thu: 120, fri: 120, sat: 180, sun: 180 };
export const WEEKLY_TASK_TYPES = ["learn", "drill", "timed_test", "revise_mistakes", "flashcards", "mock"];
const MAX_TOPICS = 12;
const FLASHCARD_MIN = 10;
const DRILL_MIN = 20;
const SPACED_MIN = 10;
const REVIEW_MIN = 15;
const RECENT_DIAGNOSIS_DAYS = 14;
const ORDER = { flashcards: 0, revise_mistakes: 1, learn: 2, drill: 3, timed_test: 4, mock: 5 };

export const weekdayOf = (date) => WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
/** First day of the study week holding `date` (weeks start on `startsOn`, Monday by default). */
export const weekStartOf = (date, startsOn = "mon") => addDays(date, -((WEEKDAYS.indexOf(weekdayOf(date)) - WEEKDAYS.indexOf(startsOn) + 7) % 7));
export const mondayOf = (date) => weekStartOf(date, "mon");

/** The study days left this week: today → the week's last day, before the exam, without the rest day. */
export function weekDays(today, examDate, restDay, startsOn = "mon") {
  const lastDay = WEEKDAYS[(WEEKDAYS.indexOf(startsOn) + 6) % 7];
  const days = [];
  for (let d = today; d < examDate; d = addDays(d, 1)) {
    if (weekdayOf(d) !== restDay) days.push(d);
    if (weekdayOf(d) === lastDay) break;
  }
  return days;
}

/**
 * The days a weekly plan made today covers: the rest of this week, or all of
 * next week when this week has no study days left (e.g. today is the rest day
 * and the week's last day). Returns { start, days }.
 */
export function planDays(exam, today) {
  const days = weekDays(today, exam.examDate, exam.restDay, exam.weekStartsOn);
  if (days.length) return { start: today, days };
  const next = addDays(weekStartOf(today, exam.weekStartsOn), 7);
  const nextDays = weekDays(next, exam.examDate, exam.restDay, exam.weekStartsOn);
  return nextDays.length ? { start: next, days: nextDays } : { start: today, days };
}

export const minutesFor = (exam, date) => (exam.studyMinutes ?? DEFAULT_MINUTES)[weekdayOf(date)] ?? 0;

/** Topics in the given order, but each after its prerequisites that are also in the list. */
export function prerequisitesFirst(topics, edges) {
  const ids = new Set(topics.map((t) => t.id));
  const placed = new Set();
  const result = [];
  const rest = [...topics];
  while (rest.length) {
    const i = rest.findIndex((t) => edges.every((e) => e.to !== t.id || !ids.has(e.from) || placed.has(e.from)));
    const [t] = rest.splice(i === -1 ? 0 : i, 1); // a cycle can't block the plan
    placed.add(t.id);
    result.push(t);
  }
  return result;
}

/**
 * Pure layout of a week. `topics`: ordered focus topics ({ id, name, status,
 * reason, parentId }); `reviews`: [{ nodeId, name, diagnosisIds, count }];
 * `spaced`: topics to revisit; → [{ date, position, type, minutes, … }].
 */
export function layoutWeek({ days, budgets, sessionMinutes = 45, topics, reviews = [], spaced = [], hasCards = false, mock = null, sectional = null }) {
  const slots = days.map((date, i) => ({ date, cap: budgets[i], used: 0, items: [] }));
  const place = (item, from = 0) => {
    for (let i = Math.max(0, from); i < slots.length; i++) {
      if (slots[i].used + item.minutes <= slots[i].cap) {
        slots[i].used += item.minutes;
        slots[i].items.push(item);
        return i;
      }
    }
    return -1;
  };
  const learnMin = Math.min(sessionMinutes, 40);
  const drillMin = Math.min(sessionMinutes, DRILL_MIN);

  if (hasCards) slots.forEach((_, i) => place({ type: "flashcards", minutes: FLASHCARD_MIN, title: "Flashcards due today", reason: "Spaced repetition keeps formulas and facts fresh." }, i));

  // A full mock on the roomiest day late in the week (when the exam has one and it fits).
  if (mock && slots.length >= 3) {
    const lateFirst = slots.map((s, i) => ({ s, i })).filter(({ i }) => i >= Math.floor(slots.length / 2)).sort((a, b) => b.s.cap - b.s.used - (a.s.cap - a.s.used));
    const target = lateFirst.find(({ s }) => s.cap - s.used >= mock.minutes);
    if (target) place({ type: "mock", minutes: mock.minutes, title: mock.title, reason: "A full paper under real timing and marking.", payload: { kind: "mock" } }, target.i);
  }

  for (const r of reviews) {
    place({ type: "revise_mistakes", minutes: REVIEW_MIN, nodeId: r.nodeId, title: `Fix mistakes: ${r.name}`, reason: r.reason, payload: { diagnosisIds: r.diagnosisIds } }, 0);
  }

  topics.slice(0, MAX_TOPICS).forEach((t, i) => {
    const start = Math.floor((i * slots.length) / Math.max(1, Math.min(topics.length, MAX_TOPICS)));
    if (t.status === "not_started" || t.status === "weak") {
      const at = place({ type: "learn", minutes: learnMin, nodeId: t.id, title: `Learn: ${t.name}`, reason: t.reason, payload: { nodeId: t.id } }, start);
      place({ type: "drill", minutes: drillMin, nodeId: t.id, title: `Drill: ${t.name}`, reason: "Practise right after learning it.", targetCount: 10, payload: { kind: "drill", nodeIds: [t.id], count: 10 } }, at === -1 ? start : at + 1);
    } else {
      place({ type: "drill", minutes: drillMin, nodeId: t.id, title: `Drill: ${t.name}`, reason: t.reason, targetCount: 10, payload: { kind: "drill", nodeIds: [t.id], count: 10 } }, start);
    }
  });

  if (sectional) place({ type: "timed_test", minutes: sectional.minutes, nodeId: sectional.nodeId, title: `Timed test: ${sectional.name}`, reason: "Exam pace and marking on this chapter.", targetCount: sectional.count, payload: { kind: "sectional", nodeIds: [sectional.nodeId], count: sectional.count } }, Math.floor(slots.length / 2));

  for (const t of spaced) {
    place({ type: "drill", minutes: SPACED_MIN, nodeId: t.id, title: `Quick revision: ${t.name}`, reason: t.reason, targetCount: 5, payload: { kind: "drill", nodeIds: [t.id], count: 5 } }, Math.min(2, slots.length - 1));
  }

  return slots.flatMap((s) => s.items.sort((a, b) => ORDER[a.type] - ORDER[b.type]).map((it, position) => ({ ...it, date: s.date, position })));
}

// ---- Inputs --------------------------------------------------------------------------

/** Topic nodes with mastery, weight, recent diagnoses, prerequisite links; plus the profile. */
async function planInputs(exam, userId, today) {
  const [notebook, nodes, edges, events, diagnoses, cards] = await Promise.all([
    getNotebook(exam.notebookId),
    listNodes(exam.notebookId),
    listEdges(exam.notebookId),
    nodeEvents(exam.notebookId, userId),
    listDiagnoses(exam.notebookId, userId, { since: `${addDays(today, -RECENT_DIAGNOSIS_DAYS)}T00:00:00Z` }),
    cardsInScope(exam.notebookId, userId, null),
  ]);
  const mastery = nodeMastery(nodes, events);
  const usable = diagnoses.filter((d) => d.status === "ready" && d.feedback !== "not_right");
  const topics = nodes
    .filter((n) => n.level === "topic")
    .map((n) => {
      const m = mastery.get(n.id);
      const diag = usable.filter((d) => d.nodeIds.includes(n.id) || d.revisitNodeId === n.id);
      const weakness = m?.score === null || m?.score === undefined ? 0.7 : 1 - m.score;
      return {
        id: n.id,
        name: n.name,
        parentId: n.parentId,
        weight: n.weight,
        status: m?.status ?? "not_started",
        score: m?.score ?? null,
        attempts: m?.attempts ?? 0,
        lastPractisedAt: m?.lastPractisedAt ?? null,
        diagnoses: diag,
        priority: (n.weight ?? 0.5) * weakness + Math.min(0.5, diag.length * 0.15),
      };
    })
    .sort((a, b) => b.priority - a.priority);
  return { notebook, nodes, edges, mastery, diagnoses: usable, topics, hasCards: cards.total > 0, profile: profileFor(notebook) };
}

const WEEKLY_PROMPT = [
  "You are an exam coach planning a student's study week before an Indian competitive / university exam.",
  "From the candidate topics (exam weight, the student's mastery, diagnosed mistakes and prerequisite links), choose and order the topics to focus on this week: high exam weight × low mastery first, topics with diagnosed misconceptions (or their prerequisites) early, foundations before what builds on them.",
  "For each chosen topic write a one-line reason the student will see (max 18 words, specific, e.g. \"Asked in 4 past papers; you're at 35%\"). Also write a one-sentence theme for the week.",
].join("\n");

/** Ultra's order and reasons for the week's topics (falls back to priority order). */
async function weeklyPriorities(exam, inputs, daysLeft, language) {
  const candidates = inputs.topics.slice(0, 25);
  if (!candidates.length) return { order: [], theme: null };
  const nameOf = new Map(inputs.nodes.map((n) => [n.id, n.name]));
  const listing = candidates
    .map(
      (t, i) =>
        `${i + 1}. ${t.name} (${nameOf.get(t.parentId) ?? ""}) — weight ${t.weight === null ? "unknown" : Math.round(t.weight * 100) + "%"}, mastery ${t.score === null ? "not practised" : `${Math.round(t.score * 100)}%`}` +
        (t.diagnoses.length ? `, ${t.diagnoses.length} diagnosed mistake(s): ${[...new Set(t.diagnoses.map((d) => d.misconception).filter(Boolean))].slice(0, 2).join("; ")}` : "") +
        (inputs.edges.some((e) => e.to === t.id) ? `, needs ${inputs.edges.filter((e) => e.to === t.id).map((e) => nameOf.get(e.from)).filter(Boolean).join(", ")}` : "")
    )
    .join("\n");
  try {
    const out = await completeJson(
      WEEKLY_PROMPT,
      `Exam: ${exam.name} (${inputs.profile.name}), ${daysLeft} days away.\n\nCandidate topics:\n${listing}\n\nChoose up to ${MAX_TOPICS}.\n` +
        'Return JSON: {"theme": string, "topics": [{"topic": number, "reason": string}]}',
      { task: "weekly_plan", language, notebookId: exam.notebookId }
    );
    const seen = new Set();
    const order = [];
    for (const item of Array.isArray(out?.topics) ? out.topics : []) {
      const t = candidates[firstNumber(item?.topic) - 1];
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      order.push({ ...t, reason: cleanText(item?.reason, 160) || null });
    }
    if (!order.length) throw new Error("no topics chosen");
    return { order, theme: cleanText(out?.theme, 240) || null };
  } catch (err) {
    console.warn(`Weekly priorities fell back to the priority order: ${err.message}`);
    return { order: candidates.slice(0, MAX_TOPICS).map((t) => ({ ...t, reason: null })), theme: null };
  }
}

const fallbackReason = (t) =>
  t.diagnoses.length ? `${t.diagnoses.length} diagnosed mistake${t.diagnoses.length === 1 ? "" : "s"} here.` : t.score === null ? "Not practised yet." : `You're at ${Math.round(t.score * 100)}%.`;

function snapshotOf(mastery, topics) {
  return Object.fromEntries(topics.map((t) => [t.id, { status: mastery.get(t.id)?.status ?? "not_started", score: mastery.get(t.id)?.score ?? null }]));
}

function sectionalFor(profile, order, nodes) {
  const top = order[0];
  if (!top) return null;
  const chapter = nodes.find((n) => n.id === top.parentId);
  if (!chapter) return null;
  const m = profile.mock ?? {};
  const perQ = m.perSubject ? (m.minutesPerSubject * 60) / m.perSubject.reduce((s, p) => s + p.count, 0) : m.whole ? (m.minutes * 60) / m.whole.reduce((s, p) => s + p.count, 0) : 120;
  const count = 10;
  return { nodeId: chapter.id, name: chapter.name, count, minutes: Math.max(10, Math.round((perQ * count) / 60)) };
}

function mockFor(profile, nodes) {
  const m = profile.mock;
  if (!m) return null;
  const subjects = nodes.filter((n) => n.level === "subject");
  const wanted = subjects.filter((s) => profile.subjects.some((p) => p.toLowerCase() === s.name.toLowerCase()));
  const minutes = m.perSubject ? m.minutesPerSubject * Math.max(1, (wanted.length || subjects.length) || 1) : m.minutes;
  return { minutes, title: `${profile.name} full mock` };
}

/**
 * Builds this week's plan (from today), or next week's when this week has no
 * study days left; keeps done tasks. Returns { items, theme, weekStart }.
 * `useModel: false` skips Ultra and uses the priority order (no AI call; the demo seed uses it).
 */
export async function generateWeeklyPlan(exam, userId, today, { language, useModel = true } = {}) {
  const inputs = await planInputs(exam, userId, today);
  if (!inputs.nodes.length) throw Object.assign(new Error("Build the course's knowledge map first — the weekly plan is made from it."), { status: 409 });
  const { start, days } = planDays(exam, today);
  const nextWeek = start !== today;
  const daysLeft = daysBetween(today, exam.examDate);
  const { order, theme } = useModel
    ? await weeklyPriorities(exam, inputs, daysLeft, language)
    : { order: inputs.topics.slice(0, MAX_TOPICS).map((t) => ({ ...t, reason: null })), theme: null };
  const ordered = prerequisitesFirst(order, inputs.edges).map((t) => ({ ...t, reason: t.reason ?? fallbackReason(t) }));

  // Concept gaps from recent diagnoses: review the node to revisit.
  const byNode = new Map();
  for (const d of inputs.diagnoses.filter((x) => x.category === "concept_gap")) {
    const nodeId = d.revisitNodeId ?? d.nodeIds[0];
    if (!nodeId) continue;
    const r = byNode.get(nodeId) ?? { nodeId, name: inputs.nodes.find((n) => n.id === nodeId)?.name ?? "Mistakes", diagnosisIds: [], count: 0 };
    r.diagnosisIds.push(d.id);
    r.count += 1;
    byNode.set(nodeId, r);
  }
  const reviews = [...byNode.values()].sort((a, b) => b.count - a.count).slice(0, 3).map((r) => ({ ...r, reason: `${r.count} concept-gap mistake${r.count === 1 ? "" : "s"} recently.` }));

  // Spaced revision: practised 3-10 days ago, doing fine, not already planned.
  const planned = new Set(ordered.slice(0, MAX_TOPICS).map((t) => t.id));
  const spaced = inputs.topics
    .filter((t) => !planned.has(t.id) && (t.status === "ok" || t.status === "strong") && t.lastPractisedAt)
    .filter((t) => {
      const ago = daysBetween(t.lastPractisedAt.slice(0, 10), today);
      return ago >= 3 && ago <= 10;
    })
    .slice(0, 3)
    .map((t) => ({ ...t, reason: `Last practised ${daysBetween(t.lastPractisedAt.slice(0, 10), today)} days ago — revisit before it fades.` }));

  const items = layoutWeek({
    days,
    budgets: days.map((d) => minutesFor(exam, d)),
    sessionMinutes: exam.sessionMinutes,
    topics: ordered,
    reviews,
    spaced,
    hasCards: inputs.hasCards,
    mock: daysLeft >= 7 ? mockFor(inputs.profile, inputs.nodes) : null,
    sectional: sectionalFor(inputs.profile, ordered, inputs.nodes),
  });
  await replaceWeekItems(exam.id, today, items);
  const weekStart = weekStartOf(start, exam.weekStartsOn);
  await setPlanState(exam.id, { weekStart, lastReplannedOn: today, masterySnapshot: snapshotOf(inputs.mastery, inputs.topics) });
  const minutes = items.reduce((s, i) => s + i.minutes, 0);
  await addPlanChange(exam.id, {
    date: today,
    kind: "weekly",
    summary: theme,
    lines: [
      {
        type: "weekly",
        text: `Planned ${items.length} tasks (${Math.round(minutes / 6) / 10} h) over ${days.length} day${days.length === 1 ? "" : "s"}${nextWeek ? " next week" : ""}${exam.restDay ? `, ${exam.restDay} off` : ""}.${nextWeek ? " No study days were left this week." : ""}`,
      },
      ...ordered.slice(0, 3).map((t) => ({ type: "focus", text: `Focus: ${t.name} — ${t.reason}` })),
    ],
  });
  return { items, theme, weekStart };
}

// ---- Daily replanning -----------------------------------------------------------------

const DAILY_PROMPT = [
  "You explain changes to a student's study plan. For each numbered change, write ONE short line (max 16 words) saying what changed and why, using the facts given, e.g. \"Moved Rotational dynamics earlier: 3 concept-gap mistakes yesterday\".",
  "Speak to the student; be specific and encouraging, never vague.",
].join("\n");

/** Template line for a change (used when the model's line is missing). */
function templateLine(c) {
  switch (c.type) {
    case "moved":
      return `Moved "${c.title}" to ${c.toLabel}: it wasn't done ${c.fromLabel}.`;
    case "dropped":
      return `Dropped "${c.title}": no time left this week.`;
    case "skip_moved":
      return `Moved "${c.title}" from ${c.fromLabel} to ${c.toLabel} (you skipped it${c.reason ? `: ${c.reason}` : ""}).`;
    case "skip_kept":
      return `Left "${c.title}" skipped: no later day this week has room for it.`;
    case "skip_dropped":
      return `Dropped "${c.title}": you skipped it again after it was moved.`;
    case "review_added":
      return `Added a mistake review on ${c.name}: ${c.count} new concept-gap mistake${c.count === 1 ? "" : "s"}.`;
    case "moved_earlier":
      return `Moved ${c.name} earlier: ${c.count} concept-gap mistake${c.count === 1 ? "" : "s"} since your last plan.`;
    case "speed_added":
      return `Added a timed speed drill on ${c.name}: ${c.count} time-pressure mistake${c.count === 1 ? "" : "s"}.`;
    case "strong_skipped":
      return `Skipped the drill on ${c.name}: you're now strong at it (${c.score}%).`;
    case "weak_added":
      return `Added a drill on ${c.name}: your mastery dropped to ${c.score}%.`;
    default:
      return c.text ?? "Plan updated.";
  }
}

const label = (today, date) => (date === today ? "today" : date === addDays(today, 1) ? "tomorrow" : date === addDays(today, -1) ? "yesterday" : date);

/**
 * Adjusts today and the rest of the week (once per day). New week, or no
 * study days left this week → a new weekly plan instead (next week's, in the
 * second case). Returns { kind, lines } or null when already done today.
 */
export async function replanIfDue(exam, userId, today, { language, force = false } = {}) {
  if (exam.planKind !== "weekly" || !exam.weekStart || today >= exam.examDate) return null;
  if (!force && exam.lastReplannedOn === today) return null;
  const thisWeek = weekStartOf(today, exam.weekStartsOn);
  // Next week was planned early: nothing to adjust until it starts.
  if (exam.weekStart > thisWeek && !force) return null;
  const days = weekDays(today, exam.examDate, exam.restDay, exam.weekStartsOn);
  if (thisWeek !== exam.weekStart || (!days.length && planDays(exam, today).days.length)) {
    const { theme } = await generateWeeklyPlan(exam, userId, today, { language });
    return { kind: "weekly", theme };
  }

  const [items, inputs] = await Promise.all([listPlanItems(exam.id), planInputs(exam, userId, today)]);
  const load = new Map(days.map((d) => [d, items.filter((i) => i.date === d && !i.done && !i.skipped).reduce((s, i) => s + (i.minutes ?? 0), 0)]));
  const nextPos = new Map(days.map((d) => [d, Math.max(-1, ...items.filter((i) => i.date === d).map((i) => i.position)) + 1]));
  const fits = (date, minutes) => load.get(date) + minutes <= minutesFor(exam, date);
  const dayFor = (minutes, from = 0) => days.slice(from).find((d) => fits(d, minutes));
  const book = (date, minutes) => {
    load.set(date, load.get(date) + minutes);
    const p = nextPos.get(date);
    nextPos.set(date, p + 1);
    return p;
  };
  const moves = [];
  const skips = [];
  const updates = [];
  const adds = [];
  const changes = [];

  // 1. Missed tasks of this week → the first day with room (flashcards just lapse).
  const missed = items.filter((i) => i.date < today && i.date >= exam.weekStart && !i.done && !i.skipped);
  for (const i of missed) {
    if (i.type === "flashcards") {
      skips.push(i.id);
      continue;
    }
    const date = dayFor(i.minutes ?? 0);
    if (date) {
      moves.push({ id: i.id, date, position: book(date, i.minutes ?? 0) });
      changes.push({ type: "moved", title: i.title, toLabel: label(today, date), fromLabel: label(today, i.date) });
    } else {
      skips.push(i.id);
      changes.push({ type: "dropped", title: i.title });
    }
  }

  // 1b. Tasks the student skipped → the first later day this week with room, once;
  // skipped again after that, they're dropped for good.
  const skipped = items.filter((i) => i.skipped && !i.done && i.date >= exam.weekStart && i.type !== "flashcards" && i.payload?.awaitingReschedule);
  for (const i of skipped) {
    const { awaitingReschedule, ...payload } = i.payload;
    const firstSkip = !payload.rescheduledFromSkip;
    const date = firstSkip ? days.find((d) => d > i.date && fits(d, i.minutes ?? 0)) : null;
    if (date) {
      moves.push({ id: i.id, date, position: book(date, i.minutes ?? 0), payload: { ...payload, rescheduledFromSkip: 1, movedFrom: i.date } });
      changes.push({ type: "skip_moved", title: i.title, toLabel: label(today, date), fromLabel: label(today, i.date), reason: i.skipReason });
    } else {
      updates.push({ id: i.id, payload });
      changes.push({ type: firstSkip ? "skip_kept" : "skip_dropped", title: i.title });
    }
  }

  // 2. New diagnoses since the last (re)plan — by time, so replanning twice in a day doesn't add them twice.
  const since = Date.parse(exam.planGeneratedAt ?? `${exam.weekStart}T00:00:00Z`);
  const fresh = inputs.diagnoses.filter((d) => Date.parse(d.createdAt) > since);
  const groups = new Map();
  for (const d of fresh) {
    const nodeId = d.category === "concept_gap" ? d.revisitNodeId ?? d.nodeIds[0] : d.nodeIds[0];
    if (!nodeId) continue;
    const key = `${d.category}:${nodeId}`;
    const g = groups.get(key) ?? { category: d.category, nodeId, name: inputs.nodes.find((n) => n.id === nodeId)?.name ?? "this topic", ids: [], expected: d.signals?.expectedS };
    g.ids.push(d.id);
    groups.set(key, g);
  }
  const future = items.filter((i) => i.date >= today && !i.done && !i.skipped && !moves.some((m) => m.id === i.id));
  for (const g of groups.values()) {
    if (g.category === "concept_gap") {
      const date = dayFor(REVIEW_MIN);
      if (date) {
        adds.push({ date, position: book(date, REVIEW_MIN), type: "revise_mistakes", minutes: REVIEW_MIN, nodeId: g.nodeId, title: `Fix mistakes: ${g.name}`, reason: `${g.ids.length} new concept-gap mistake(s).`, payload: { diagnosisIds: g.ids } });
        changes.push({ type: "review_added", name: g.name, count: g.ids.length });
      }
      // Pull this topic's later work forward.
      for (const i of future.filter((x) => x.nodeId === g.nodeId && x.date > today)) {
        const earlier = days.find((d) => d < i.date && fits(d, i.minutes ?? 0));
        if (!earlier) continue;
        load.set(i.date, load.get(i.date) - (i.minutes ?? 0));
        moves.push({ id: i.id, date: earlier, position: book(earlier, i.minutes ?? 0) });
        changes.push({ type: "moved_earlier", name: g.name, count: g.ids.length });
        break;
      }
    } else if (g.category === "time_pressure" && g.ids.length >= 1) {
      const minutes = Math.max(5, Math.ceil((5 * (Number(g.expected) || 120) * 0.75) / 60));
      const date = dayFor(minutes);
      if (date) {
        adds.push({ date, position: book(date, minutes), type: "timed_test", minutes, nodeId: g.nodeId, title: `Speed drill: ${g.name}`, reason: "Beat the clock: 5 questions at 75% of the usual time.", targetCount: 5, payload: { kind: "mixed", nodeIds: [g.nodeId], count: 5, minutes } });
        changes.push({ type: "speed_added", name: g.name, count: g.ids.length });
      }
    }
  }

  // 3. Mastery changes since the last plan.
  const before = exam.masterySnapshot ?? {};
  for (const t of inputs.topics) {
    const was = before[t.id]?.status;
    if (!was || was === t.status) continue;
    if (t.status === "strong" && was !== "strong") {
      const drills = future.filter((i) => i.nodeId === t.id && i.type === "drill" && !moves.some((m) => m.id === i.id));
      if (drills.length) {
        skips.push(...drills.map((i) => i.id));
        changes.push({ type: "strong_skipped", name: t.name, score: Math.round((t.score ?? 0) * 100) });
      }
    } else if (t.status === "weak" && was !== "weak") {
      const date = dayFor(DRILL_MIN, days.indexOf(addDays(today, 1)) === -1 ? 0 : days.indexOf(addDays(today, 1)));
      if (date) {
        adds.push({ date, position: book(date, DRILL_MIN), type: "drill", minutes: DRILL_MIN, nodeId: t.id, title: `Drill: ${t.name}`, reason: "Your mastery dropped.", targetCount: 10, payload: { kind: "drill", nodeIds: [t.id], count: 10 } });
        changes.push({ type: "weak_added", name: t.name, score: Math.round((t.score ?? 0) * 100) });
      }
    }
  }

  await applyReplan(exam.id, { moves, skips, updates, adds });

  // Super words each change in one line; templates fill any gap.
  let lines = changes.map((c) => ({ type: c.type, text: templateLine(c) }));
  if (changes.length) {
    try {
      const out = await completeJson(
        DAILY_PROMPT,
        `Changes:\n${changes.map((c, i) => `${i + 1}. ${templateLine(c)}`).join("\n")}\n\nReturn JSON: {"lines": [{"change": number, "text": string}]}`,
        { task: "replan_daily", language, notebookId: exam.notebookId }
      );
      for (const l of Array.isArray(out?.lines) ? out.lines : []) {
        const i = firstNumber(l?.change) - 1;
        const text = cleanText(l?.text, 200);
        if (lines[i] && text) lines[i] = { ...lines[i], text };
      }
    } catch (err) {
      console.warn(`Replan wording fell back to templates: ${err.message}`);
    }
  } else {
    lines = [{ type: "none", text: "No changes needed — your plan for today stands." }];
  }
  await setPlanState(exam.id, { lastReplannedOn: today, masterySnapshot: snapshotOf(inputs.mastery, inputs.topics) });
  await addPlanChange(exam.id, { date: today, kind: "daily", lines });
  return { kind: "daily", lines };
}
