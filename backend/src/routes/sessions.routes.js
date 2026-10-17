import { Router } from "express";
import multer from "multer";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { asyncHandler, isUuid } from "../utils/asyncHandler.js";
import { httpError, idList } from "./helpers.js";
import { config } from "../config/index.js";
import { listNodes } from "../db/knowledgeMap.js";
import { listSessions, updateAnswer, sessionQuestions } from "../db/sessions.js";
import { SESSION_KINDS, createPracticeSession, finishSession, getSession, saveAnswer, sessionResults, sessionView, startSession, timeIsUp } from "../services/sessions.js";
import { questionSources } from "../services/questionJobs.js";
import { ocrImageFile } from "../services/ocr.js";
import { unlinkQuietly } from "../services/sources.js";
import { assertApiKey } from "../services/llm.js";
import { responseLanguage } from "../services/language.js";
import { setAiNotebook } from "../services/aiContext.js";

// Practice sessions: create (from the bank, topping up by generation), take
// (timer, answers, confidence, working), submit, results.

const MAX_NODES = 5;
const COUNTS = { drill: [5, 20, 10], mixed: [5, 30, 15], sectional: [5, 40, 15], mock: [0, 0, 0] };
const MAX_MINUTES = 240;
const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];
const workingUpload = multer({
  storage: multer.diskStorage({ destination: config.paths.uploadDir, filename: (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`) }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) =>
    IMAGE_EXTENSIONS.includes(path.extname(file.originalname).toLowerCase()) ? cb(null, true) : cb(Object.assign(new Error("Upload a photo (.png, .jpg or .webp)."), { status: 400 })),
});

/** Routes scoped to a course; added to the courses router (so :id is already checked). */
export function courseSessionRoutes(router) {
  // body: { kind: drill|mixed|sectional|mock, nodeIds?: [map nodes], count?, minutes? (0 = untimed) } → 202 session (status preparing)
  router.post(
    "/:id/sessions",
    asyncHandler(async (req, res) => {
      const kind = req.body?.kind;
      if (!SESSION_KINDS.includes(kind)) throw httpError(400, `kind must be one of ${SESSION_KINDS.join(", ")}.`);
      const ids = idList(req.body?.nodeIds, { name: "nodeIds" }) ?? [];
      if (ids.length > MAX_NODES) throw httpError(400, `Pick up to ${MAX_NODES} parts of the knowledge map.`);
      const nodes = await listNodes(req.notebook.id);
      if (!nodes.length) throw httpError(409, "Build the course's knowledge map first (Knowledge map → add the syllabus or build from notes).");
      const chosen = ids.map((id) => nodes.find((n) => n.id === id));
      if (chosen.some((n) => !n)) throw httpError(400, "Some of those aren't on this course's knowledge map.");
      if ((kind === "drill" || kind === "sectional") && !chosen.length) throw httpError(400, kind === "drill" ? "Pick the topics to drill." : "Pick the subject or chapter for the test.");
      const [min, max, fallback] = COUNTS[kind];
      const count = kind === "mock" ? 0 : req.body?.count === undefined ? fallback : Number(req.body.count);
      if (kind !== "mock" && (!Number.isInteger(count) || count < min || count > max)) throw httpError(400, `count must be ${min}-${max}.`);
      const minutes = req.body?.minutes === undefined ? 0 : Number(req.body.minutes);
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_MINUTES) throw httpError(400, `minutes must be 0-${MAX_MINUTES}.`);
      if (!(await questionSources(req.notebook.id)).length) throw httpError(409, "Add notes to this course first — questions are written from them.");
      assertApiKey();
      const session = await createPracticeSession({
        notebook: req.notebook,
        userId: req.user.id,
        kind,
        chosen,
        count,
        minutes,
        language: await responseLanguage(req.user.id, req.notebook.id),
      });
      res.status(202).json(session);
    })
  );

  router.get(
    "/:id/sessions",
    asyncHandler(async (req, res) => {
      res.json(await listSessions(req.notebook.id, req.user.id));
    })
  );
}

// ---- One session --------------------------------------------------------------------

export const sessionsRouter = Router();

sessionsRouter.param("sessionId", async (req, _res, next, id) => {
  try {
    req.session_ = isUuid(id) ? await getSession(id, req.user.id) : null;
    if (req.session_) setAiNotebook(req.session_.notebookId);
    next(req.session_ ? undefined : httpError(404, "Practice session not found."));
  } catch (err) {
    next(err);
  }
});

const language = (req) => responseLanguage(req.user.id, req.session_.notebookId);

/** Submits a timed session whose clock ran out (on any read or write). */
async function expireIfDue(req) {
  if (!timeIsUp(req.session_)) return;
  await finishSession(req.session_, { tz: req.tz, language: await language(req) });
  req.session_ = await getSession(req.session_.id, req.user.id);
}

sessionsRouter.get(
  "/:sessionId",
  asyncHandler(async (req, res) => {
    await expireIfDue(req);
    res.json(await sessionView(req.session_));
  })
);

sessionsRouter.post(
  "/:sessionId/start",
  asyncHandler(async (req, res) => {
    await startSession(req.session_);
    res.json(await sessionView(await getSession(req.session_.id, req.user.id)));
  })
);

const positionOf = (req) => {
  const p = Number(req.params.position);
  if (!Number.isInteger(p) || p < 0 || p > 1000) throw httpError(400, "Bad question number.");
  return p;
};

// body: { answer?, timeSpentMs? (total on this question), confidence?: sure|unsure|guess|null, workingText?, check?: true (drills) }
sessionsRouter.put(
  "/:sessionId/answers/:position",
  asyncHandler(async (req, res) => {
    await expireIfDue(req);
    if (req.session_.status !== "active") throw httpError(409, req.session_.status === "finished" ? "This session has been submitted." : "Start the session first.");
    res.json(await saveAnswer(req.session_, positionOf(req), req.body ?? {}, { language: await language(req) }));
  })
);

// multipart "image": a photo of your working, read with the vision model.
sessionsRouter.post(
  "/:sessionId/answers/:position/working",
  workingUpload.single("image"),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw httpError(400, "Attach a photo of your working.");
    try {
      const position = positionOf(req);
      if (!(await sessionQuestions(req.session_.id)).some((q) => q.position === position)) throw httpError(404, "That question isn't in this session.");
      const text = await ocrImageFile(file.path);
      res.json(await updateAnswer(req.session_.id, position, { workingOcr: text.slice(0, 4000) }));
    } finally {
      unlinkQuietly(file.path);
    }
  })
);

sessionsRouter.post(
  "/:sessionId/finish",
  asyncHandler(async (req, res) => {
    await finishSession(req.session_, { tz: req.tz, language: await language(req) });
    res.json(await sessionResults(await getSession(req.session_.id, req.user.id)));
  })
);

sessionsRouter.get(
  "/:sessionId/results",
  asyncHandler(async (req, res) => {
    await expireIfDue(req);
    if (req.session_.status !== "finished") throw httpError(409, "Submit the session to see results.");
    res.json(await sessionResults(req.session_));
  })
);
