import { Router } from "express";
import { asyncHandler, isUuid } from "../utils/asyncHandler.js";
import { cleanString, httpError } from "./helpers.js";
import { deleteDiagnosis, getDiagnosis, sessionDiagnoses, setDiagnosisFeedback } from "../db/diagnoses.js";
import { listBankQuestions } from "../db/questionBank.js";
import { getNotebook } from "../db/store.js";
import { listNodes } from "../db/knowledgeMap.js";
import { getSession } from "../db/sessions.js";
import { diagnoseSession, isDiagnosing } from "../services/diagnosis.js";
import { ADVICE, mistakesDashboard } from "../services/mistakes.js";
import { createPracticeSession, createQuestionDrill } from "../services/sessions.js";
import { todayIn } from "../db/exams.js";
import { assertApiKey } from "../services/llm.js";
import { responseLanguage } from "../services/language.js";
import { setAiNotebook } from "../services/aiContext.js";

// Mistake diagnoses: per session, the course dashboard, "not right" feedback
// and targeted practice ("Fix this").

/** Routes scoped to a course; added to the courses router (so :id is already checked). */
export function courseMistakeRoutes(router) {
  router.get(
    "/:id/mistakes",
    asyncHandler(async (req, res) => {
      res.json(await mistakesDashboard(req.notebook.id, req.user.id, await todayIn(req.tz)));
    })
  );
}

export const diagnosesRouter = Router();

// GET /api/sessions/:sessionId/diagnoses is served here too (mounted under /api).
diagnosesRouter.get(
  "/sessions/:sessionId/diagnoses",
  asyncHandler(async (req, res) => {
    const session = isUuid(req.params.sessionId) ? await getSession(req.params.sessionId, req.user.id) : null;
    if (!session) throw httpError(404, "Practice session not found.");
    res.json({ diagnosing: isDiagnosing(session.id), diagnoses: await sessionDiagnoses(session.id) });
  })
);

diagnosesRouter.param("diagnosisId", async (req, _res, next, id) => {
  try {
    req.diagnosis = isUuid(id) ? await getDiagnosis(id, req.user.id) : null;
    if (req.diagnosis) setAiNotebook(req.diagnosis.notebookId);
    next(req.diagnosis ? undefined : httpError(404, "Diagnosis not found."));
  } catch (err) {
    next(err);
  }
});

diagnosesRouter.get("/diagnoses/:diagnosisId", (req, res) => res.json({ ...req.diagnosis, advice: ADVICE[req.diagnosis.category] ?? null }));

// body: { feedback: "not_right" | null, note? } — "this diagnosis isn't right" (kept for review).
diagnosesRouter.patch(
  "/diagnoses/:diagnosisId",
  asyncHandler(async (req, res) => {
    const feedback = req.body?.feedback;
    if (feedback !== null && feedback !== "not_right") throw httpError(400, 'feedback must be "not_right" or null.');
    await setDiagnosisFeedback(req.diagnosis.id, feedback, cleanString(req.body?.note, 1000));
    res.json(await getDiagnosis(req.diagnosis.id, req.user.id));
  })
);

// Re-runs a diagnosis that failed.
diagnosesRouter.post(
  "/diagnoses/:diagnosisId/retry",
  asyncHandler(async (req, res) => {
    if (req.diagnosis.status !== "error") throw httpError(409, "Only a failed diagnosis can be retried.");
    assertApiKey();
    await deleteDiagnosis(req.diagnosis.id);
    const session = await getSession(req.diagnosis.sessionId, req.user.id);
    diagnoseSession(session, { language: await responseLanguage(req.user.id, session.notebookId), positions: [req.diagnosis.position] });
    res.status(202).json({ ok: true });
  })
);

// "Fix this": a practice session aimed at the mistake's category — the
// follow-up questions as a drill (concept gap, careless error) or a timed
// speed drill on the topic (time pressure). → the session (ready or preparing).
diagnosesRouter.post(
  "/diagnoses/:diagnosisId/practice",
  asyncHandler(async (req, res) => {
    const d = req.diagnosis;
    const notebook = await getNotebook(d.notebookId, req.user.id);
    const nodes = await listNodes(d.notebookId);
    const nodeId = d.revisitNodeId ?? d.nodeIds[0];
    const node = nodes.find((n) => n.id === nodeId);
    const followups = d.followupQuestionIds.length ? await listBankQuestions(d.notebookId, { ids: d.followupQuestionIds }) : [];
    if (d.category !== "time_pressure" && followups.length) {
      return res.status(201).json(await createQuestionDrill({ notebook, userId: req.user.id, questions: followups, title: `Fix: ${d.misconception?.slice(0, 80) ?? node?.name ?? "mistake"}` }));
    }
    if (!node) throw httpError(409, "There's nothing to practise for this mistake yet.");
    assertApiKey();
    const language = await responseLanguage(req.user.id, d.notebookId);
    const timed = d.category === "time_pressure";
    const expected = Number(d.signals?.expectedS) || 120;
    const session = await createPracticeSession({
      notebook,
      userId: req.user.id,
      kind: timed ? "mixed" : "drill",
      chosen: [node],
      count: 5,
      // Speed drill: 5 questions at 75% of the expected time each.
      minutes: timed ? Math.max(1, Math.ceil((5 * expected * 0.75) / 60)) : 0,
      language,
    });
    res.status(202).json(session);
  })
);
