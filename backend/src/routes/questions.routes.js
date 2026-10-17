import { Router } from "express";
import { asyncHandler, isUuid } from "../utils/asyncHandler.js";
import { cleanString, httpError, idList } from "./helpers.js";
import { bankStats, getBankQuestion, listBankQuestions, reportQuestion } from "../db/questionBank.js";
import { DIFFICULTIES, MAX_COUNT, profileFor } from "../services/questionGen.js";
import { getJob, nodesWithPaths, questionSources, startQuestionJob } from "../services/questionJobs.js";
import { assertApiKey } from "../services/llm.js";
import { responseLanguage } from "../services/language.js";
import { setAiNotebook } from "../services/aiContext.js";

// Self-checked practice questions: generation jobs, the course bank, reports.

const MAX_NODES = 5;
const REPORT_REASONS = ["wrong_key", "unclear", "out_of_syllabus", "other"];
const MAX_NOTE = 1000;

/** Routes scoped to a course; added to the courses router (so :id is already checked). */
export function courseQuestionRoutes(router) {
  // body: { nodeIds: [1-5 map nodes], count?: 1-15 (5), formats?: [format ids of the exam], difficulty?: easy|medium|hard|mixed }
  // → 202 { job } — poll GET /:id/questions/jobs/:jobId
  router.post(
    "/:id/questions/generate",
    asyncHandler(async (req, res) => {
      const ids = idList(req.body?.nodeIds, { name: "nodeIds" });
      if (!ids?.length || ids.length > MAX_NODES) throw httpError(400, `Pick 1-${MAX_NODES} parts of the knowledge map.`);
      const nodes = await nodesWithPaths(req.notebook.id, ids);
      if (nodes.length !== ids.length) throw httpError(400, "Some of those aren't on this course's knowledge map.");
      const count = req.body?.count === undefined ? 5 : Number(req.body.count);
      if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw httpError(400, `count must be 1-${MAX_COUNT}.`);
      const difficulty = req.body?.difficulty ?? "mixed";
      if (![...DIFFICULTIES, "mixed"].includes(difficulty)) throw httpError(400, "difficulty must be easy, medium, hard or mixed.");
      const profile = profileFor(req.notebook);
      let formatIds;
      if (req.body?.formats !== undefined) {
        if (!Array.isArray(req.body.formats) || !req.body.formats.length || req.body.formats.some((f) => !profile.formats.some((x) => x.id === f))) {
          throw httpError(400, `formats must be some of: ${profile.formats.map((f) => f.id).join(", ")}.`);
        }
        formatIds = [...new Set(req.body.formats)];
      }
      const sources = await questionSources(req.notebook.id);
      if (!sources.length) throw httpError(409, "Add notes to this course first — questions are written from them.");
      assertApiKey();
      const job = startQuestionJob({
        notebook: req.notebook,
        userId: req.user.id,
        nodes,
        sources,
        count,
        formatIds,
        difficulty,
        language: await responseLanguage(req.user.id, req.notebook.id),
      });
      res.status(202).json(publicJob(job));
    })
  );

  router.get(
    "/:id/questions/jobs/:jobId",
    asyncHandler(async (req, res) => {
      const job = getJob(req.params.jobId, req.user.id, req.notebook.id);
      if (!job) throw httpError(404, "That generation job doesn't exist (or finished over an hour ago).");
      const questions = job.status === "done" ? await listBankQuestions(req.notebook.id, { ids: job.questionIds }) : [];
      res.json({ ...publicJob(job), questions });
    })
  );

  // Verified questions of the course (no keys): ?nodeId=&format=&limit=
  router.get(
    "/:id/questions",
    asyncHandler(async (req, res) => {
      const nodeId = req.query.nodeId;
      if (nodeId !== undefined && !isUuid(nodeId)) throw httpError(400, "nodeId must be an id.");
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
      const formats = typeof req.query.format === "string" ? [req.query.format.slice(0, 30)] : undefined;
      const [questions, stats] = await Promise.all([listBankQuestions(req.notebook.id, { nodeIds: nodeId ? [nodeId] : undefined, formats, limit }), bankStats(req.notebook.id)]);
      res.json({ questions, stats });
    })
  );
}

const publicJob = (job) => ({ id: job.id, status: job.status, total: job.total, done: job.done, verified: job.verified, rejected: job.rejected, error: job.error });

// ---- One question -----------------------------------------------------------------

export const questionsRouter = Router();

questionsRouter.param("questionId", async (req, _res, next, id) => {
  try {
    req.question = isUuid(id) ? await getBankQuestion(id, req.user.id) : null;
    if (req.question) setAiNotebook(req.question.notebookId);
    next(req.question ? undefined : httpError(404, "Question not found."));
  } catch (err) {
    next(err);
  }
});

// ?reveal=1 includes the key and the full solution.
questionsRouter.get("/:questionId", (req, res) => {
  const { answer, solution, verification, ...rest } = req.question;
  res.json(req.query.reveal === "1" ? req.question : { ...rest, verification: { status: verification?.status ?? null, attempts: verification?.attempts ?? null } });
});

// body: { reason: wrong_key | unclear | out_of_syllabus | other, note? } — hides it for everyone.
questionsRouter.post(
  "/:questionId/report",
  asyncHandler(async (req, res) => {
    const reason = req.body?.reason;
    if (!REPORT_REASONS.includes(reason)) throw httpError(400, `reason must be one of ${REPORT_REASONS.join(", ")}.`);
    await reportQuestion(req.question.id, req.user.id, reason, cleanString(req.body?.note, MAX_NOTE));
    res.status(201).json({ ok: true, hidden: true });
  })
);
