import { Router } from "express";
import { asyncHandler, isUuid } from "../utils/asyncHandler.js";
import { cleanString, httpError, idList, resolveSources } from "./helpers.js";
import { listUnits } from "../db/store.js";
import {
  addAnswerAttempt,
  addTopicEvents,
  createQuiz,
  deleteAnswerAttempt,
  deleteQuiz,
  finishAttempt,
  getAnswerAttempt,
  getAttempt,
  getQuestion,
  getQuiz,
  getTopicsByIds,
  listAnswerAttempts,
  listAttemptAnswers,
  listQuizQuestions,
  listQuizzes,
  listTopics,
  recordAnswer,
  startAttempt,
} from "../db/practice.js";
import { courseProgress, courseTopics, refreshUnitTopics } from "../services/topics.js";
import { QUIZ_COUNTS, QUIZ_DIFFICULTIES, generateQuizQuestions } from "../services/quizzes.js";
import { MARKS, generateWrittenQuestions, gradeAnswer } from "../services/grading.js";
import { assertApiKey } from "../services/llm.js";

const MAX_QUESTION = 1000;
const MAX_ANSWER = 12_000;
const ANSWER_WEIGHT = { 2: 1, 5: 2, 10: 3 };

/** The units a request is about, as unit keys (null = General), or every unit + General. */
async function unitScope(notebookId, unitIds) {
  if (unitIds?.length) return unitIds.map((u) => (u === "general" ? null : u));
  return [...(await listUnits(notebookId)).map((u) => u.id), null];
}

/**
 * Topics of the chosen units, extracting any that are missing or stale
 * first (one model call per unit) so generated items can be tagged.
 */
async function topicsFor(notebookId, unitIds) {
  const scope = await unitScope(notebookId, unitIds);
  await Promise.all(scope.map((u) => refreshUnitTopics(notebookId, u).catch(() => {})));
  return (await listTopics(notebookId)).filter((t) => scope.includes(t.unitId));
}

async function focusTopics(notebookId, value) {
  const ids = idList(value, { name: "topicIds" });
  if (!ids?.length) return [];
  const topics = await getTopicsByIds(notebookId, ids);
  if (topics.length !== ids.length) throw httpError(400, "Some of those topics don't belong to this course.");
  return topics;
}

// When topics are given, generate from the units they belong to.
const unitsOfTopics = (topics) => [...new Set(topics.map((t) => t.unitId ?? "general"))];

const citationOf = (q) => (q.sourceId ? { sourceId: q.sourceId, sourceTitle: q.sourceTitle, location: q.location, text: q.quote ?? "" } : null);

/** Practice routes scoped to a course; added to the courses router (so :id is already checked). */
export function coursePracticeRoutes(router) {
  // Topics by unit: [{ unitId, title, status: ready|pending|error|empty, topics }]
  router.get(
    "/:id/topics",
    asyncHandler(async (req, res) => {
      res.json(await courseTopics(req.notebook.id));
    })
  );

  // body: { unitId? } — re-extract one unit's topics (or every unit's) in the background
  router.post(
    "/:id/topics/refresh",
    asyncHandler(async (req, res) => {
      assertApiKey();
      const unitId = req.body?.unitId;
      if (unitId !== undefined && unitId !== null && unitId !== "general" && !isUuid(unitId)) throw httpError(400, "unitId must be a unit id.");
      const scope = unitId === undefined ? await unitScope(req.notebook.id) : [unitId === "general" ? null : unitId];
      for (const u of scope) refreshUnitTopics(req.notebook.id, u, { force: true }).catch(() => {});
      res.status(202).json({ ok: true });
    })
  );

  // This user's mastery per unit and topic, weakest first, plus "revise these today".
  router.get(
    "/:id/progress",
    asyncHandler(async (req, res) => {
      res.json(await courseProgress(req.notebook.id, req.user.id));
    })
  );

  router.get(
    "/:id/quizzes",
    asyncHandler(async (req, res) => {
      res.json(await listQuizzes(req.notebook.id, req.user.id));
    })
  );

  // body: { count: 5|10|15|20, difficulty, unitIds?, topicIds?, title? } → the quiz with its questions (no answers)
  router.post(
    "/:id/quizzes",
    asyncHandler(async (req, res) => {
      const count = Number(req.body?.count ?? 10);
      if (!QUIZ_COUNTS.includes(count)) throw httpError(400, `count must be one of ${QUIZ_COUNTS.join(", ")}.`);
      const difficulty = req.body?.difficulty ?? "medium";
      if (!QUIZ_DIFFICULTIES.includes(difficulty)) throw httpError(400, `difficulty must be one of ${QUIZ_DIFFICULTIES.join(", ")}.`);
      const focus = await focusTopics(req.notebook.id, req.body?.topicIds);
      const unitIds = focus.length ? unitsOfTopics(focus) : idList(req.body?.unitIds, { allow: ["general"], name: "unitIds" });
      const sources = await resolveSources(req.notebook.id, { unitIds, selectedOnly: false });
      if (sources.length === 0) throw httpError(409, "There are no ready sources in what you picked.");
      assertApiKey();

      const topics = await topicsFor(req.notebook.id, unitIds);
      const questions = await generateQuizQuestions({ sources, topics, focusTopics: focus, count, difficulty });
      const title =
        cleanString(req.body?.title, 120) ||
        (focus.length ? `Quiz: ${focus.map((t) => t.name).join(", ")}` : `Quiz · ${difficulty} · ${questions.length} questions`).slice(0, 120);
      const quiz = await createQuiz({ notebookId: req.notebook.id, userId: req.user.id, title, difficulty, unitIds: unitIds ?? [], questions });
      res.status(201).json({ ...quiz, questions: await listQuizQuestions(quiz.id) });
    })
  );

  // body: { marks: 2|5|10, count?: 1-5, unitIds?, topicIds? } → [{ question, marks, topicId, topic }]
  router.post(
    "/:id/written-questions",
    asyncHandler(async (req, res) => {
      const marks = Number(req.body?.marks ?? 5);
      if (!MARKS.includes(marks)) throw httpError(400, `marks must be one of ${MARKS.join(", ")}.`);
      const count = Number(req.body?.count ?? 3);
      if (!Number.isInteger(count) || count < 1 || count > 5) throw httpError(400, "count must be 1-5.");
      const focus = await focusTopics(req.notebook.id, req.body?.topicIds);
      const unitIds = focus.length ? unitsOfTopics(focus) : idList(req.body?.unitIds, { allow: ["general"], name: "unitIds" });
      const sources = await resolveSources(req.notebook.id, { unitIds, selectedOnly: false });
      if (sources.length === 0) throw httpError(409, "There are no ready sources in what you picked.");
      assertApiKey();
      const topics = await topicsFor(req.notebook.id, unitIds);
      res.json(await generateWrittenQuestions({ sources, topics, focusTopics: focus, marks, count }));
    })
  );

  router.get(
    "/:id/answers",
    asyncHandler(async (req, res) => {
      res.json(await listAnswerAttempts(req.notebook.id, req.user.id));
    })
  );

  // body: { question, marks, answer, unitIds?, topicId?, origin?: typed|generated } → graded attempt
  router.post(
    "/:id/answers",
    asyncHandler(async (req, res) => {
      const question = cleanString(req.body?.question, MAX_QUESTION + 1);
      if (!question) throw httpError(400, "Enter the question you're answering.");
      if (question.length > MAX_QUESTION) throw httpError(400, `Questions are limited to ${MAX_QUESTION} characters.`);
      const marks = Number(req.body?.marks);
      if (!MARKS.includes(marks)) throw httpError(400, `marks must be one of ${MARKS.join(", ")}.`);
      const answer = cleanString(req.body?.answer, MAX_ANSWER + 1);
      if (answer.length < 5) throw httpError(400, "Write your answer first.");
      if (answer.length > MAX_ANSWER) throw httpError(400, `Answers are limited to ${MAX_ANSWER.toLocaleString()} characters.`);
      const origin = ["typed", "generated", "past_paper"].includes(req.body?.origin) ? req.body.origin : "typed";
      const unitIds = idList(req.body?.unitIds, { allow: ["general"], name: "unitIds" });
      const sources = await resolveSources(req.notebook.id, { unitIds, selectedOnly: false });
      if (sources.length === 0) throw httpError(409, "There are no ready sources to grade against.");
      assertApiKey();

      const topics = await topicsFor(req.notebook.id, unitIds);
      let topic = null;
      if (req.body?.topicId) {
        if (!isUuid(req.body.topicId)) throw httpError(400, "topicId must be a topic id.");
        [topic] = await getTopicsByIds(req.notebook.id, [req.body.topicId]);
        if (!topic) throw httpError(400, "That topic doesn't belong to this course.");
      }
      const graded = await gradeAnswer({ sources, question, marks, answer, topics });
      topic ??= graded.topic;

      const attempt = await addAnswerAttempt({
        notebookId: req.notebook.id,
        userId: req.user.id,
        question,
        marks,
        answer,
        score: graded.score,
        feedback: graded.feedback,
        citations: graded.citations,
        topicId: topic?.id ?? null,
        unitIds: unitIds ?? [],
        origin,
      });
      if (topic) await addTopicEvents(req.user.id, [{ topicId: topic.id, kind: "answer", score: graded.score / marks, weight: ANSWER_WEIGHT[marks] }]);
      res.status(201).json({ ...attempt, topic: topic?.name ?? null });
    })
  );
}

// ---- Quizzes, attempts and graded answers by id ------------------------------------

export const practiceRouter = Router();

practiceRouter.param("quizId", async (req, _res, next, id) => {
  try {
    req.quiz = isUuid(id) ? await getQuiz(id, req.user.id) : null;
    next(req.quiz ? undefined : httpError(404, "Quiz not found."));
  } catch (err) {
    next(err);
  }
});

practiceRouter.param("attemptId", async (req, _res, next, id) => {
  try {
    req.attempt = isUuid(id) ? await getAttempt(id, req.user.id) : null;
    next(req.attempt ? undefined : httpError(404, "Attempt not found."));
  } catch (err) {
    next(err);
  }
});

practiceRouter.param("answerId", async (req, _res, next, id) => {
  try {
    req.answerAttempt = isUuid(id) ? await getAnswerAttempt(id, req.user.id) : null;
    next(req.answerAttempt ? undefined : httpError(404, "Answer not found."));
  } catch (err) {
    next(err);
  }
});

// The quiz with its questions (answers are revealed one by one while attempting).
practiceRouter.get(
  "/quizzes/:quizId",
  asyncHandler(async (req, res) => {
    res.json({ ...req.quiz, questions: await listQuizQuestions(req.quiz.id) });
  })
);

practiceRouter.delete(
  "/quizzes/:quizId",
  asyncHandler(async (req, res) => {
    await deleteQuiz(req.quiz.id);
    res.status(204).end();
  })
);

// Starts an attempt → { attempt, questions }
practiceRouter.post(
  "/quizzes/:quizId/attempts",
  asyncHandler(async (req, res) => {
    const questions = await listQuizQuestions(req.quiz.id);
    const attempt = await startAttempt(req.quiz.id, req.user.id, questions.length);
    res.status(201).json({ attempt, questions });
  })
);

// body: { questionId, chosenIndex: 0-3, timeMs } → { correct, answerIndex, explanation, citation }
practiceRouter.post(
  "/quiz-attempts/:attemptId/answers",
  asyncHandler(async (req, res) => {
    if (req.attempt.finishedAt) throw httpError(409, "This attempt is already finished.");
    const { questionId } = req.body ?? {};
    const chosenIndex = Number(req.body?.chosenIndex);
    if (!isUuid(questionId)) throw httpError(400, "questionId is required.");
    if (!Number.isInteger(chosenIndex) || chosenIndex < 0 || chosenIndex > 3) throw httpError(400, "chosenIndex must be 0-3.");
    const timeMs = Math.max(0, Math.min(3_600_000, Math.round(Number(req.body?.timeMs) || 0)));
    const question = await getQuestion(req.attempt.quizId, questionId);
    if (!question) throw httpError(404, "Question not found in this quiz.");

    const correct = chosenIndex === question.answerIndex;
    if (!(await recordAnswer({ attemptId: req.attempt.id, questionId, chosenIndex, correct, timeMs }))) {
      throw httpError(409, "You've already answered this question.");
    }
    if (question.topicId) await addTopicEvents(req.user.id, [{ topicId: question.topicId, kind: "quiz", score: correct ? 1 : 0, weight: 1 }]);
    res.json({ questionId, correct, answerIndex: question.answerIndex, explanation: question.explanation, citation: citationOf(question) });
  })
);

async function attemptReview(attempt) {
  const [questions, answers] = await Promise.all([listQuizQuestions(attempt.quizId, { withAnswers: true }), listAttemptAnswers(attempt.id)]);
  const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
  const topics = new Map();
  for (const q of questions) {
    const a = byQuestion.get(q.id);
    const key = q.topic ?? "Other";
    const t = topics.get(key) ?? { topic: key, topicId: q.topicId, correct: 0, total: 0 };
    t.total += 1;
    if (a?.correct) t.correct += 1;
    topics.set(key, t);
  }
  return {
    attempt,
    questions: questions.map((q) => ({ ...q, citation: citationOf(q), answer: byQuestion.get(q.id) ?? null })),
    byTopic: [...topics.values()].sort((a, b) => a.correct / a.total - b.correct / b.total),
    totalTimeMs: answers.reduce((s, a) => s + (a.timeMs ?? 0), 0),
  };
}

// Ends the attempt (unanswered questions count as wrong) → full review
practiceRouter.post(
  "/quiz-attempts/:attemptId/finish",
  asyncHandler(async (req, res) => {
    res.json(await attemptReview(await finishAttempt(req.attempt.id)));
  })
);

practiceRouter.get(
  "/quiz-attempts/:attemptId",
  asyncHandler(async (req, res) => {
    if (!req.attempt.finishedAt) throw httpError(409, "Finish the attempt to see the answers.");
    res.json(await attemptReview(req.attempt));
  })
);

practiceRouter.get("/answers/:answerId", (req, res) => res.json(req.answerAttempt));

practiceRouter.delete(
  "/answers/:answerId",
  asyncHandler(async (req, res) => {
    await deleteAnswerAttempt(req.answerAttempt.id);
    res.status(204).end();
  })
);
