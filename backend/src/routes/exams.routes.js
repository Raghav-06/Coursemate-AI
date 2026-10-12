import { Router } from "express";
import { asyncHandler, isUuid } from "../utils/asyncHandler.js";
import { cleanString, httpError, idList, languagePatch } from "./helpers.js";
import { listUnits } from "../db/store.js";
import {
  countExams,
  createExam,
  deleteExam,
  getDailyGoal,
  getExam,
  getPlanItem,
  listExams,
  listPlanItems,
  setDailyGoal,
  setItemDone,
  todayIn,
  updateExam,
} from "../db/exams.js";
import { generatePlan, replanMissed } from "../services/examPlan.js";
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

/** Exam routes scoped to a course; added to the courses router (so :id is already checked). */
export function courseExamRoutes(router) {
  router.get(
    "/:id/exams",
    asyncHandler(async (req, res) => {
      res.json(await listExams(req.notebook.id, req.user.id));
    })
  );

  // body: { name, examDate: "YYYY-MM-DD", unitIds? } → the exam (generate its plan with POST /api/exams/:examId/plan)
  router.post(
    "/:id/exams",
    asyncHandler(async (req, res) => {
      const name = cleanString(req.body?.name, MAX_EXAM_NAME);
      if (!name) throw httpError(400, "Give the exam a name.");
      const examDate = await examDateFrom(req.body?.examDate, req.tz);
      const unitIds = await examUnits(req.notebook.id, req.body?.unitIds);
      if ((await countExams(req.notebook.id, req.user.id)) >= MAX_EXAMS_PER_COURSE) throw httpError(409, `You can add up to ${MAX_EXAMS_PER_COURSE} exams per course.`);
      res.status(201).json(await createExam({ notebookId: req.notebook.id, userId: req.user.id, name, examDate, unitIds }));
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
  const today = await todayIn(tz);
  const items = await listPlanItems(exam.id);
  return { ...exam, today, items, missedCount: items.filter((i) => i.date < today && !i.done && i.type !== "flashcards").length };
}

examsRouter.get(
  "/exams/:examId",
  asyncHandler(async (req, res) => {
    res.json(await examWithPlan(req.exam, req.tz));
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

// Moves missed (undone, past) tasks onto the remaining days.
examsRouter.post(
  "/exams/:examId/replan",
  asyncHandler(async (req, res) => {
    const moved = await replanMissed(req.exam, await todayIn(req.tz));
    res.json({ moved, ...(await examWithPlan(req.exam, req.tz)) });
  })
);

// body: { done: boolean }
examsRouter.patch(
  "/plan-items/:itemId",
  asyncHandler(async (req, res) => {
    if (typeof req.body?.done !== "boolean") throw httpError(400, "done must be true or false.");
    res.json(await setItemDone(req.planItem.id, req.body.done));
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
