import { Router } from "express";
import { asyncHandler, isUuid } from "../utils/asyncHandler.js";
import { getSource, updateSource } from "../db/store.js";
import { resolveUnitId } from "./helpers.js";
import { scheduleTopicRefresh } from "../services/topics.js";
import { readSourceLocations, readSourceText } from "../services/sourceText.js";
import { removeSource, reprocessSource } from "../services/sources.js";

export const sourcesRouter = Router();

const MAX_TITLE_CHARS = 200;

sourcesRouter.param("id", async (req, res, next, id) => {
  try {
    req.source = isUuid(id) ? await getSource(id, req.user.id) : null;
    if (!req.source) return res.status(404).json({ message: "Source not found." });
    next();
  } catch (err) {
    next(err);
  }
});

sourcesRouter.get("/:id", (req, res) => res.json(req.source));

// Full extracted text, for the source viewer and citation highlighting, plus
// where each page / slide starts in it ([{ label, start, end }] or null).
sourcesRouter.get(
  "/:id/content",
  asyncHandler(async (req, res) => {
    const [text, locations] = await Promise.all([readSourceText(req.params.id), readSourceLocations(req.params.id)]);
    res.json({ text, locations });
  })
);

// Extracts and embeds the source again (e.g. to add page / slide numbers to
// a source added before they existed). 202 + the source, now "processing".
sourcesRouter.post(
  "/:id/reprocess",
  asyncHandler(async (req, res) => {
    res.status(202).json(await reprocessSource(req.source));
  })
);

// body: { title?, selected?, unitId? } — unitId moves the source to a unit (null/"general" = General)
sourcesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { title, selected, unitId } = req.body ?? {};
    const patch = {};
    const cleanTitle = typeof title === "string" ? title.trim().slice(0, MAX_TITLE_CHARS) : "";
    if (cleanTitle) Object.assign(patch, { title: cleanTitle, titleIsPlaceholder: false });
    if (typeof selected === "boolean") patch.selected = selected;
    const unit = await resolveUnitId(req.source.notebookId, unitId);
    if (unit !== undefined) patch.unitId = unit;
    const updated = await updateSource(req.params.id, patch);
    // Moving a source changes both units' topics.
    if (unit !== undefined && unit !== req.source.unitId) {
      scheduleTopicRefresh(req.source.notebookId, req.source.unitId);
      scheduleTopicRefresh(req.source.notebookId, unit);
    }
    res.json(updated);
  })
);

sourcesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await removeSource(req.params.id);
    res.status(204).end();
  })
);
