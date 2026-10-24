import { Router } from "express";
import { asyncHandler, isUuid } from "../utils/asyncHandler.js";
import { cleanString, httpError, idList, languagePatch } from "./helpers.js";
import { getNotebook, listUnits } from "../db/store.js";
import {
  countExams,
  createExam,
  deleteExam,
  getDailyGoal,
  getExam,
  getPlanItem,
  linkItemSession,
  listExams,
  listPlanChanges,
  listPlanItems,
  markExamReplanDue,
  setDailyGoal,
  setItemDone,
  setItemSkipped,
  switchPlanKind,
  todayIn,
  updateExam,
} from "../db/exams.js";
import { listNodes } from "../db/knowledgeMap.js";
import { listBankQuestions } from "../db/questionBank.js";
import { getDiagnosis } from "../db/diagnoses.js";
import { getSession } from "../db/sessions.js";
import { addDays, generatePlan, replanMissed } from "../services/examPlan.js";
import { DEFAULT_MINUTES, WEEKDAYS, WEEKLY_TASK_TYPES, generateWeeklyPlan, minutesFor, replanIfDue, weekStartOf, weekdayOf } from "../services/weeklyPlan.js";
import { examToday, isReplanning, replanInBackground, withPlanLock } from "../services/replanTrigger.js";
import { SESSION_KINDS, createPracticeSession, createQuestionDrill } from "../services/sessions.js";
import { questionSources } from "../services/questionJobs.js";
import { setAiNotebook } from "../services/aiContext.js";
import { todaySummary } from "../services/today.js";
import { assertApiKey } from "../services/llm.js";
import { LANGUAGES, languageFrom, responseLanguage } from "../services/language.js";
import { getUserPreferences, updateUserPreferences } from "../db/preferences.js";

const MAX_EXAM_NAME = 120;
const MAX_EXAMS_PER_COURSE = 20;
const MAX_DAYS_AHEAD = 730;
const MAX_DAILY_GOAL = 500;

/** A "YYYY-MM-DD" exam date between today and two years ahead (400 otherwise). */
async function examDateFrom(value, tz) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw httpError(400, "examDate must be a date (YYYY-MM-DD).");
  }
  if (new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw httpError(400, "examDate must be a real date.");
  const today = await todayIn(tz);
  if (value < today) throw httpError(400, "The exam date can't be in the past.");
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + MAX_DAYS_AHEAD);
  if (value > limit.toISOString().slice(0, 10)) throw httpError(400, "The exam date must be within two years.");
  return value;
}

/** Units of this course the exam covers ("general" allowed); [] = whole course. */
async function examUnits(notebookId, value) {
  const ids = idList(value, { allow: ["general"], name: "unitIds" }) ?? [];
  const known = new Set((await listUnits(notebookId)).map((u) => u.id));
  if (ids.some((id) => id !== "general" && !known.has(id))) throw httpError(400, "Some of those units don't belong to this course.");
  return ids;
}

const PLAN_KINDS = ["revision", "weekly"];
const MIN_STUDY_MINUTES = 15;
const MAX_STUDY_MINUTES = 600;
const MAX_SESSION_MINUTES = 240;
const MAX_SKIP_REASON = 200;

const wholeMinutes = (value, max, name) => {
  const n = Number(value);
  if (typeof value === "boolean" || value === null || value === "" || !Number.isInteger(n) || n < MIN_STUDY_MINUTES || n > max) {
    throw httpError(400, `${name} must be a whole number of minutes from ${MIN_STUDY_MINUTES} to ${max}.`);
  }
  return n;
};

/** An IANA timezone both the JS runtime and PostgreSQL know (400 otherwise). */
async function timezoneFrom(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 64) throw httpError(400, "timezone must be an IANA timezone name, e.g. Asia/Kolkata.");
  const tz = value.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    await todayIn(tz);
  } catch {
    throw httpError(400, `"${tz}" isn't a timezone this server knows (use an IANA name such as Asia/Kolkata).`);
  }
  return tz;
}

/**
 * Weekly-plan settings from a request (absent fields stay undefined; 400 on
 * anything odd): planKind, studyMinutes (one number for every day, or
 * { mon: 120, … } — merged with `current`), sessionMinutes, restDay (a weekday
 * or null), timezone (IANA), weekStartsOn (a weekday).
 */
async function scheduleFrom(body, current = null) {
  const patch = {};
  if (body?.planKind !== undefined) {
    if (!PLAN_KINDS.includes(body.planKind)) throw httpError(400, `planKind must be one of ${PLAN_KINDS.join(", ")}.`);
    patch.planKind = body.planKind;
  }
  if (body?.studyMinutes !== undefined) {
    const value = body.studyMinutes;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const unknown = Object.keys(value).filter((k) => !WEEKDAYS.includes(k));
      if (unknown.length) throw httpError(400, `studyMinutes keys must be weekdays (${WEEKDAYS.join(", ")}).`);
      patch.studyMinutes = { ...DEFAULT_MINUTES, ...(current ?? {}) };
      for (const [k, v] of Object.entries(value)) patch.studyMinutes[k] = wholeMinutes(v, MAX_STUDY_MINUTES, `studyMinutes.${k}`);
    } else {
      const n = wholeMinutes(value, MAX_STUDY_MINUTES, "studyMinutes");
      patch.studyMinutes = Object.fromEntries(WEEKDAYS.map((d) => [d, n]));
    }
  }
  if (body?.sessionMinutes !== undefined) patch.sessionMinutes = wholeMinutes(body.sessionMinutes, MAX_SESSION_MINUTES, "sessionMinutes");
  if (body?.restDay !== undefined) {
    if (body.restDay !== null && !WEEKDAYS.includes(body.restDay)) throw httpError(400, `restDay must be one of ${WEEKDAYS.join(", ")} or null.`);
    patch.restDay = body.restDay;
  }
  if (body?.timezone !== undefined) patch.timezone = await timezoneFrom(body.timezone);
  if (body?.weekStartsOn !== undefined) {
    if (!WEEKDAYS.includes(body.weekStartsOn)) throw httpError(400, `weekStartsOn must be one of ${WEEKDAYS.join(", ")}.`);
    patch.weekStartsOn = body.weekStartsOn;
  }
  return patch;
}

/** Exam routes scoped to a course; added to the courses router (so :id is already checked). */
export function courseExamRoutes(router) {
  router.get(
    "/:id/exams",
    asyncHandler(async (req, res) => {
      const exams = await listExams(req.notebook.id, req.user.id);
      // First visit of the day (or new results): weekly plans replan in the background.
      for (const exam of exams) replanInBackground(exam, req.user.id, req.tz);
      res.json(exams.map((e) => ({ ...e, replanning: isReplanning(e.id) })));
    })
  );

  // body: { name, examDate: "YYYY-MM-DD", unitIds?, planKind?: "revision" | "weekly", + the schedule fields of PATCH …/schedule }
  // → the exam (generate its plan with POST /api/exams/:examId/plan, or …/weekly-plan for a weekly plan)
  router.post(
    "/:id/exams",
    asyncHandler(async (req, res) => {
      const name = cleanString(req.body?.name, MAX_EXAM_NAME);
      if (!name) throw httpError(400, "Give the exam a name.");
      const examDate = await examDateFrom(req.body?.examDate, req.tz);
      const unitIds = await examUnits(req.notebook.id, req.body?.unitIds);
      const schedule = await scheduleFrom(req.body);
      if ((await countExams(req.notebook.id, req.user.id)) >= MAX_EXAMS_PER_COURSE) throw httpError(409, `You can add up to ${MAX_EXAMS_PER_COURSE} exams per course.`);
      res.status(201).json(await createExam({ notebookId: req.notebook.id, userId: req.user.id, name, examDate, unitIds, timezone: req.tz, ...schedule }));
    })
  );
}

// ---- Exams, plan items, today and settings ---------------------------------------------

export const examsRouter = Router();

examsRouter.param("examId", async (req, _res, next, id) => {
  try {
    req.exam = isUuid(id) ? await getExam(id, req.user.id) : null;
    next(req.exam ? undefined : httpError(404, "Exam not found."));
  } catch (err) {
    next(err);
  }
});

examsRouter.param("itemId", async (req, _res, next, id) => {
  try {
    req.planItem = isUuid(id) ? await getPlanItem(id, req.user.id) : null;
    next(req.planItem ? undefined : httpError(404, "Task not found."));
  } catch (err) {
    next(err);
  }
});

async function examWithPlan(exam, tz) {
  const today = await examToday(exam, tz);
  const items = await listPlanItems(exam.id);
  return {
    ...exam,
    today,
    items,
    missedCount: items.filter((i) => i.date < today && !i.done && !i.skipped && i.type !== "flashcards").length,
    replanning: isReplanning(exam.id),
  };
}

examsRouter.get(
  "/exams/:examId",
  asyncHandler(async (req, res) => {
    replanInBackground(req.exam, req.user.id, req.tz);
    res.json(await examWithPlan(req.exam, req.tz));
  })
);

// body: { planKind?, studyMinutes? (15-600, one number or { mon: 120, … }), sessionMinutes? (15-240),
//         restDay?: mon…sun | null, timezone? (IANA), weekStartsOn?: mon…sun } → the exam with its plan
examsRouter.patch(
  "/exams/:examId/schedule",
  asyncHandler(async (req, res) => {
    const patch = await scheduleFrom(req.body, req.exam.studyMinutes);
    if (!Object.keys(patch).length) throw httpError(400, "Nothing to change.");
    const { planKind, ...rest } = patch;
    await withPlanLock(req.exam.id, async () => {
      if (planKind && planKind !== req.exam.planKind) await switchPlanKind(req.exam.id, planKind, WEEKLY_TASK_TYPES);
      if (Object.keys(rest).length) await updateExam(req.exam.id, rest);
    });
    res.json(await examWithPlan(await getExam(req.exam.id, req.user.id), req.tz));
  })
);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (v) => typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** The weekly plan for the study week holding `date`: days (rest day, budget, planned / done minutes, tasks) and totals. */
async function weekView(exam, today, date) {
  const start = weekStartOf(date, exam.weekStartsOn);
  const end = addDays(start, 6);
  const [items, changes] = await Promise.all([listPlanItems(exam.id, { from: start, to: end }), listPlanChanges(exam.id, 20)]);
  const sum = (list) => list.reduce((s, i) => s + (i.minutes ?? 0), 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(start, i);
    const dayItems = items.filter((it) => it.date === d);
    const rest = weekdayOf(d) === exam.restDay;
    const afterExam = d >= exam.examDate;
    return {
      date: d,
      weekday: weekdayOf(d),
      rest,
      afterExam,
      budgetMinutes: rest || afterExam ? 0 : minutesFor(exam, d),
      plannedMinutes: sum(dayItems.filter((it) => !it.skipped)),
      doneMinutes: sum(dayItems.filter((it) => it.done)),
      items: dayItems,
    };
  });
  const weekly = changes.find((c) => c.kind === "weekly" && c.date >= start && c.date <= end);
  return {
    examId: exam.id,
    planKind: exam.planKind,
    today,
    weekStart: start,
    weekEnd: end,
    previousWeek: addDays(start, -7),
    nextWeek: addDays(start, 7),
    isCurrentWeek: today >= start && today <= end,
    planned: Boolean(exam.weekStart),
    theme: weekly?.summary ?? null,
    replanning: isReplanning(exam.id),
    lastReplannedOn: exam.lastReplannedOn,
    days,
    totals: {
      tasks: items.length,
      done: items.filter((i) => i.done).length,
      skipped: items.filter((i) => i.skipped).length,
      budgetMinutes: days.reduce((s, d) => s + d.budgetMinutes, 0),
      plannedMinutes: sum(items.filter((i) => !i.skipped)),
      doneMinutes: sum(items.filter((i) => i.done)),
    },
  };
}

function assertWeekly(exam) {
  if (exam.planKind !== "weekly") throw httpError(409, "This exam uses the day-by-day revision plan — switch it to a weekly plan first (PATCH …/schedule { planKind: \"weekly\" }).");
}

// Builds this week's plan from today (Ultra orders the topics; tasks already done or skipped are kept).
examsRouter.post(
  "/exams/:examId/weekly-plan",
  asyncHandler(async (req, res) => {
    assertWeekly(req.exam);
    const today = await examToday(req.exam, req.tz);
    if (today >= req.exam.examDate) throw httpError(409, "The exam is today or over — there's no week left to plan.");
    const language = await responseLanguage(req.user.id, req.exam.notebookId);
    const { theme } = await withPlanLock(req.exam.id, async () => generateWeeklyPlan(await getExam(req.exam.id, req.user.id), req.user.id, today, { language }));
    const exam = await getExam(req.exam.id, req.user.id);
    res.json({ theme, ...(await weekView(exam, today, today)) });
  })
);

// ?week=YYYY-MM-DD (any day of the week; default this week)
examsRouter.get(
  "/exams/:examId/weekly-plan",
  asyncHandler(async (req, res) => {
    const today = await examToday(req.exam, req.tz);
    const week = req.query.week;
    if (week !== undefined && !isRealDate(week)) throw httpError(400, "week must be a date (YYYY-MM-DD).");
    res.json(await weekView(req.exam, today, week ?? today));
  })
);

// Replans now: missed tasks, new diagnoses and mastery changes (a new week → a new weekly plan).
examsRouter.post(
  "/exams/:examId/weekly-plan/replan",
  asyncHandler(async (req, res) => {
    assertWeekly(req.exam);
    if (!req.exam.weekStart) throw httpError(409, "Make the weekly plan first.");
    const today = await examToday(req.exam, req.tz);
    if (today >= req.exam.examDate) throw httpError(409, "The exam is today or over — there's nothing left to replan.");
    const language = await responseLanguage(req.user.id, req.exam.notebookId);
    const result = await withPlanLock(req.exam.id, async () => replanIfDue(await getExam(req.exam.id, req.user.id), req.user.id, today, { language, force: true }));
    res.json({ result, ...(await weekView(await getExam(req.exam.id, req.user.id), today, today)) });
  })
);

// What each (re)plan changed and why, newest first.
examsRouter.get(
  "/exams/:examId/plan-changes",
  asyncHandler(async (req, res) => {
    res.json(await listPlanChanges(req.exam.id, 50));
  })
);

// body: { name?, examDate?, unitIds? }
examsRouter.patch(
  "/exams/:examId",
  asyncHandler(async (req, res) => {
    const patch = {};
    if (req.body?.name !== undefined) {
      patch.name = cleanString(req.body.name, MAX_EXAM_NAME);
      if (!patch.name) throw httpError(400, "Give the exam a name.");
    }
    if (req.body?.examDate !== undefined) patch.examDate = await examDateFrom(req.body.examDate, req.tz);
    if (req.body?.unitIds !== undefined) patch.unitIds = await examUnits(req.exam.notebookId, req.body.unitIds);
    await updateExam(req.exam.id, patch);
    res.json(await examWithPlan(await getExam(req.exam.id, req.user.id), req.tz));
  })
);

examsRouter.delete(
  "/exams/:examId",
  asyncHandler(async (req, res) => {
    await deleteExam(req.exam.id);
    res.status(204).end();
  })
);

// (Re)generates the day-by-day plan from today; tasks already done are kept.
examsRouter.post(
  "/exams/:examId/plan",
  asyncHandler(async (req, res) => {
    assertApiKey();
    await generatePlan(req.exam, req.user.id, await todayIn(req.tz), { language: await responseLanguage(req.user.id, req.exam.notebookId) });
    res.json(await examWithPlan(await getExam(req.exam.id, req.user.id), req.tz));
  })
);

// Moves missed (undone, past) tasks onto the remaining days (revision plans;
// weekly plans use POST …/weekly-plan/replan).
examsRouter.post(
  "/exams/:examId/replan",
  asyncHandler(async (req, res) => {
    if (req.exam.planKind === "weekly") throw httpError(409, "This exam has a weekly plan — replan it with POST /api/exams/:examId/weekly-plan/replan.");
    const moved = await replanMissed(req.exam, await todayIn(req.tz));
    res.json({ moved, ...(await examWithPlan(req.exam, req.tz)) });
  })
);

// body: { done?: boolean, skipped?: boolean, reason?: string (why it was skipped, ≤ 200 chars) }
examsRouter.patch(
  "/plan-items/:itemId",
  asyncHandler(async (req, res) => {
    const { done, skipped, reason } = req.body ?? {};
    if (done === undefined && skipped === undefined) throw httpError(400, "Send done and/or skipped (true or false).");
    if (done !== undefined && typeof done !== "boolean") throw httpError(400, "done must be true or false.");
    if (skipped !== undefined && typeof skipped !== "boolean") throw httpError(400, "skipped must be true or false.");
    if (done && skipped) throw httpError(400, "A task can't be both done and skipped.");
    if (reason !== undefined && reason !== null && typeof reason !== "string") throw httpError(400, "reason must be text.");
    let item = req.planItem;
    if (skipped !== undefined) item = await setItemSkipped(item.id, skipped, cleanString(reason, MAX_SKIP_REASON));
    if (done !== undefined) item = await setItemDone(item.id, done);
    // Skipping today's task: the next visit or "Replan now" moves it to a later day.
    if (skipped && !done) {
      const exam = await getExam(item.examId, req.user.id);
      if (exam?.planKind === "weekly" && item.date === (await examToday(exam, req.tz))) await markExamReplanDue(exam.id);
    }
    res.json({ ...item, topic: req.planItem.topic, nodeName: req.planItem.nodeName });
  })
);

const SESSION_TASKS = ["drill", "timed_test", "mock", "revise_mistakes"];

/**
 * Practice session for a weekly-plan task, from its payload: a drill /
 * sectional / mixed (speed) / mock session on its nodes, or for "fix
 * mistakes" a drill on the diagnoses' follow-up questions.
 */
async function sessionForItem(item, notebook, userId, language) {
  const payload = item.payload ?? {};
  if (item.type === "revise_mistakes") {
    const diagnoses = (await Promise.all((payload.diagnosisIds ?? []).slice(0, 10).map((id) => (isUuid(id) ? getDiagnosis(id, userId) : null)))).filter(Boolean);
    const ids = [...new Set(diagnoses.flatMap((d) => d.followupQuestionIds))];
    const questions = ids.length ? await listBankQuestions(notebook.id, { ids }) : [];
    if (questions.length) return createQuestionDrill({ notebook, userId, questions: questions.slice(0, 20), title: item.title });
  }
  const nodes = await listNodes(notebook.id);
  const kind = item.type === "revise_mistakes" ? "drill" : payload.kind;
  if (!SESSION_KINDS.includes(kind)) throw httpError(409, "This task doesn't start a practice session.");
  const nodeIds = kind === "mock" ? [] : (payload.nodeIds ?? (item.nodeId ? [item.nodeId] : [])).slice(0, 5);
  const chosen = nodeIds.map((id) => nodes.find((n) => n.id === id)).filter(Boolean);
  if (kind !== "mock" && !chosen.length) throw httpError(409, "This task's topic is no longer on the knowledge map — replan to get a fresh task.");
  if (!(await questionSources(notebook.id)).length) throw httpError(409, "Add notes to this course first — questions are written from them.");
  assertApiKey();
  const count = kind === "mock" ? 0 : Math.min(30, Math.max(5, Number(payload.count) || item.targetCount || 10));
  const minutes = kind === "mixed" ? Math.min(240, Math.max(0, Number(payload.minutes) || 0)) : 0;
  return createPracticeSession({ notebook, userId, kind, chosen, count, minutes, language });
}

// Starts (or resumes) the practice session for a weekly-plan task; submitting it ticks the task off.
examsRouter.post(
  "/plan-items/:itemId/start",
  asyncHandler(async (req, res) => {
    const item = req.planItem;
    if (!SESSION_TASKS.includes(item.type)) throw httpError(409, "This task doesn't start a practice session — open it from the plan instead.");
    if (item.done) throw httpError(409, "This task is already done.");
    const exam = await getExam(item.examId, req.user.id);
    setAiNotebook(exam.notebookId);
    if (item.sessionId) {
      const existing = await getSession(item.sessionId, req.user.id);
      if (existing && !["finished", "error"].includes(existing.status)) return res.json({ session: existing, item, resumed: true });
    }
    const notebook = await getNotebook(exam.notebookId, req.user.id);
    const session = await sessionForItem(item, notebook, req.user.id, await responseLanguage(req.user.id, exam.notebookId));
    await linkItemSession(item.id, session.id);
    res.status(session.status === "preparing" ? 202 : 201).json({ session, item: { ...item, sessionId: session.id, skipped: false }, resumed: false });
  })
);

// Daily goal, streak, next exam with today's tasks, cards due across courses.
examsRouter.get(
  "/today",
  asyncHandler(async (req, res) => {
    res.json(await todaySummary(req.user.id, req.tz));
  })
);

async function settingsOf(userId) {
  const [dailyGoal, prefs] = await Promise.all([getDailyGoal(userId), getUserPreferences(userId)]);
  const lang = languageFrom(prefs);
  return { dailyGoal, language: lang.code, bilingual: lang.bilingual, languages: LANGUAGES };
}

examsRouter.get(
  "/settings",
  asyncHandler(async (req, res) => {
    res.json(await settingsOf(req.user.id));
  })
);

// body: { dailyGoal?: 1-500, language?: "en" | "hi" | …, bilingual?: boolean }
examsRouter.patch(
  "/settings",
  asyncHandler(async (req, res) => {
    let goal;
    if (req.body?.dailyGoal !== undefined) {
      goal = Number(req.body.dailyGoal);
      if (!Number.isInteger(goal) || goal < 1 || goal > MAX_DAILY_GOAL) throw httpError(400, `dailyGoal must be a whole number from 1 to ${MAX_DAILY_GOAL}.`);
    }
    const patch = languagePatch(req.body);
    if (goal !== undefined) await setDailyGoal(req.user.id, goal);
    if (Object.keys(patch).length) await updateUserPreferences(req.user.id, patch);
    res.json(await settingsOf(req.user.id));
  })
);
