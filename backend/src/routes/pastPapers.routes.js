import { asyncHandler, isUuid } from "../utils/asyncHandler.js";
import { httpError, requireRole, resolveUnitId } from "./helpers.js";
import { getTopicsByIds } from "../db/practice.js";
import { getPaperQuestion, listPaperQuestions, updatePaperQuestion } from "../db/pastPapers.js";
import { examInsights } from "../services/pastPapers.js";

const optionalId = (value, name, { allow = [] } = {}) => {
  if (value === undefined || value === "") return undefined;
  if (allow.includes(value) || isUuid(value)) return value;
  throw httpError(400, `${name} must be an id.`);
};

/** Past-paper routes scoped to a course; added to the courses router (so :id is already checked). */
export function coursePastPaperRoutes(router) {
  // Papers, topics and units ranked by how often they're examined.
  router.get(
    "/:id/exam-insights",
    asyncHandler(async (req, res) => {
      res.json(await examInsights(req.notebook.id));
    })
  );

  // ?unitId= ("general" = no unit) &topicId= &year= &sourceId=
  router.get(
    "/:id/past-paper-questions",
    asyncHandler(async (req, res) => {
      const year = req.query.year === undefined || req.query.year === "" ? undefined : Number(req.query.year);
      if (year !== undefined && (!Number.isInteger(year) || year < 1900 || year > 2200)) throw httpError(400, "year must be a year.");
      res.json(
        await listPaperQuestions(req.notebook.id, {
          unitId: optionalId(req.query.unitId, "unitId", { allow: ["general"] }),
          topicId: optionalId(req.query.topicId, "topicId"),
          sourceId: optionalId(req.query.sourceId, "sourceId"),
          year,
        })
      );
    })
  );

  // body: { unitId?, topicId? } — fix a question's mapping by hand (null clears)
  router.patch(
    "/:id/past-paper-questions/:questionId",
    requireRole("editor"),
    asyncHandler(async (req, res) => {
      if (!isUuid(req.params.questionId)) throw httpError(404, "Question not found.");
      const question = await getPaperQuestion(req.params.questionId, req.notebook.id);
      if (!question) throw httpError(404, "Question not found.");
      const patch = {};
      const { topicId } = req.body ?? {};
      if (topicId !== undefined) {
        if (topicId === null) patch.topicId = null;
        else {
          if (!isUuid(topicId)) throw httpError(400, "topicId must be a topic id.");
          const [topic] = await getTopicsByIds(req.notebook.id, [topicId]);
          if (!topic) throw httpError(400, "That topic doesn't belong to this course.");
          // A topic implies its unit.
          Object.assign(patch, { topicId, unitId: topic.unitId });
        }
      }
      if (patch.unitId === undefined) {
        const unitId = await resolveUnitId(req.notebook.id, req.body?.unitId);
        if (unitId !== undefined) patch.unitId = unitId;
      }
      await updatePaperQuestion(question.id, patch);
      res.json(await getPaperQuestion(question.id, req.notebook.id));
    })
  );
}
