import { Router } from "express";
import { asyncHandler, isUuid } from "../utils/asyncHandler.js";
import { httpError, requireRole } from "./helpers.js";
import { getNotebook, updateNotebook } from "../db/store.js";
import { getNode } from "../db/knowledgeMap.js";
import { cleanExamSettings, courseProfile, profileList } from "../config/examProfiles.js";
import { buildMap, courseMap, nodeDetail, scheduleMapRefresh } from "../services/knowledgeMap.js";
import { assertApiKey } from "../services/llm.js";

// Exam profiles (course setting) and the knowledge map.

export const agentRouter = Router();

// Every exam profile: subjects, formats with marking, mock pattern.
agentRouter.get("/exam-profiles", (_req, res) => res.json(profileList()));

/** Routes scoped to a course; added to the courses router (so :id is already checked). */
export function courseKnowledgeMapRoutes(router) {
  // Loads :nodeId (a node of this course's map) into req.node.
  router.param("nodeId", async (req, _res, next, id) => {
    try {
      req.node = isUuid(id) && req.notebook ? await getNode(id, req.notebook.id) : null;
      next(req.node ? undefined : httpError(404, "That part of the knowledge map doesn't exist."));
    } catch (err) {
      next(err);
    }
  });

  router.get(
    "/:id/exam-profile",
    asyncHandler(async (req, res) => {
      res.json({ examType: req.notebook.examType, settings: req.notebook.examSettings, profile: courseProfile(req.notebook.examType, req.notebook.examSettings) });
    })
  );

  // body: { examType: "jee_main" | … | null, subjects?: string[], name?: string } (editors)
  router.put(
    "/:id/exam-profile",
    requireRole("editor"),
    asyncHandler(async (req, res) => {
      const { examType, settings } = cleanExamSettings(req.body);
      await updateNotebook(req.notebook.id, { examType, examSettings: settings });
      scheduleMapRefresh(req.notebook.id);
      const notebook = await getNotebook(req.notebook.id, req.user.id);
      res.json({ examType: notebook.examType, settings: notebook.examSettings, profile: courseProfile(notebook.examType, notebook.examSettings) });
    })
  );

  // { status: none|pending|ready|error, error, builtAt, nodes (with your mastery), edges }
  router.get(
    "/:id/knowledge-map",
    asyncHandler(async (req, res) => {
      res.json(await courseMap(req.notebook.id, req.user.id));
    })
  );

  // Rebuilds the map now (Ultra), in the background.
  router.post(
    "/:id/knowledge-map/rebuild",
    requireRole("editor"),
    asyncHandler(async (req, res) => {
      assertApiKey();
      buildMap(req.notebook.id, { force: true });
      res.status(202).json({ status: "pending" });
    })
  );

  router.get(
    "/:id/knowledge-map/nodes/:nodeId",
    asyncHandler(async (req, res) => {
      res.json(await nodeDetail(req.notebook.id, req.user.id, req.node));
    })
  );
}
