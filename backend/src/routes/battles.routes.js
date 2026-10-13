import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { httpError, idList, resolveSources } from "./helpers.js";
import { getNotebook } from "../db/store.js";
import { listBattles } from "../db/battles.js";
import { QUIZ_DIFFICULTIES, generateQuizQuestions } from "../services/quizzes.js";
import { assertApiKey } from "../services/llm.js";
import { responseLanguage } from "../services/language.js";
import { topicsFor } from "./practice.routes.js";
import {
  BATTLE_COUNTS,
  BATTLE_SECONDS,
  answerQuestion,
  createBattle,
  getBattle,
  joinBattle,
  leaveBattle,
  liveBattles,
  normaliseCode,
  snapshot,
  startBattle,
  subscribe,
} from "../services/battles.js";

/** Battle routes scoped to a course; added to the courses router (so :id is already checked). */
export function courseBattleRoutes(router) {
  // { live: battles you can join or rejoin, past: finished battles you played }
  router.get(
    "/:id/battles",
    asyncHandler(async (req, res) => {
      res.json({ live: liveBattles(req.notebook.id, req.user.id), past: await listBattles(req.notebook.id, req.user.id) });
    })
  );

  // body: { unitIds?, count: 5|10|15, seconds: 10|20|30, difficulty? } → { code } (the host is in the lobby)
  router.post(
    "/:id/battles",
    asyncHandler(async (req, res) => {
      const count = Number(req.body?.count ?? 10);
      if (!BATTLE_COUNTS.includes(count)) throw httpError(400, `count must be one of ${BATTLE_COUNTS.join(", ")}.`);
      const seconds = Number(req.body?.seconds ?? 20);
      if (!BATTLE_SECONDS.includes(seconds)) throw httpError(400, `seconds must be one of ${BATTLE_SECONDS.join(", ")}.`);
      const difficulty = req.body?.difficulty ?? "medium";
      if (!QUIZ_DIFFICULTIES.includes(difficulty)) throw httpError(400, `difficulty must be one of ${QUIZ_DIFFICULTIES.join(", ")}.`);
      const unitIds = idList(req.body?.unitIds, { allow: ["general"], name: "unitIds" });
      const sources = await resolveSources(req.notebook.id, { unitIds, selectedOnly: false });
      if (sources.length === 0) throw httpError(409, "There are no ready sources in what you picked.");
      assertApiKey();

      const topics = await topicsFor(req.notebook.id, unitIds);
      const questions = await generateQuizQuestions({
        sources,
        topics,
        count,
        difficulty,
        language: await responseLanguage(req.user.id, req.notebook.id),
      });
      const battle = createBattle({
        notebookId: req.notebook.id,
        notebookTitle: req.notebook.title,
        host: req.user,
        tz: req.tz,
        unitIds: unitIds ?? [],
        seconds,
        questions,
      });
      res.status(201).json({ code: battle.code });
    })
  );
}

// ---- Playing (by join code) ------------------------------------------------------------

export const battlesRouter = Router();

// A battle the user may see: it exists and they are a member of its course
// (everyone else gets the same 404, so codes can't be probed for other courses).
async function loadBattle(req, code = req.params.code) {
  const battle = getBattle(code);
  if (!battle || !(await getNotebook(battle.notebookId, req.user.id))) throw httpError(404, "No battle with that code. Check the code, or ask the host to share the course with you.");
  return battle;
}

// body: { code } → the battle's state (you're now in its lobby)
battlesRouter.post(
  "/join",
  asyncHandler(async (req, res) => {
    const code = normaliseCode(req.body?.code);
    if (code.length !== 6) throw httpError(400, "Enter the 6-character code.");
    const battle = await loadBattle(req, code);
    joinBattle(battle, req.user, req.tz);
    res.json(snapshot(battle, req.user.id));
  })
);

battlesRouter.get(
  "/:code",
  asyncHandler(async (req, res) => {
    res.json(snapshot(await loadBattle(req), req.user.id));
  })
);

// Server-Sent Events: the battle's state (personalised) after every change.
battlesRouter.get(
  "/:code/events",
  asyncHandler(async (req, res) => {
    const battle = await loadBattle(req);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    subscribe(battle, req.user.id, res);
  })
);

battlesRouter.post(
  "/:code/start",
  asyncHandler(async (req, res) => {
    const battle = await loadBattle(req);
    startBattle(battle, req.user.id);
    res.json(snapshot(battle, req.user.id));
  })
);

// body: { index, choice: 0-3 } → { ok }; whether it was right shows when the question closes
battlesRouter.post(
  "/:code/answer",
  asyncHandler(async (req, res) => {
    const battle = await loadBattle(req);
    const index = req.body?.index;
    const choice = req.body?.choice;
    if (!Number.isInteger(index) || !Number.isInteger(choice) || choice < 0 || choice > 3) throw httpError(400, "index and choice (0-3) are required.");
    answerQuestion(battle, req.user.id, { index, choice });
    res.json({ ok: true });
  })
);

battlesRouter.post(
  "/:code/leave",
  asyncHandler(async (req, res) => {
    const battle = await loadBattle(req);
    leaveBattle(battle, req.user.id);
    res.status(204).end();
  })
);
