import { Router } from "express";
import { asyncHandler, isUuid } from "../utils/asyncHandler.js";
import { getSource, setSourcesSelected, updateSource } from "../db/store.js";
import { assertRole, resolveUnitId, sourceKindFields } from "./helpers.js";
import { analysePaper, isAnalysing, setSourceKind } from "../services/pastPapers.js";
import { responseLanguage } from "../services/language.js";
import { scheduleTopicRefresh } from "../services/topics.js";
import { readSourceLocations, readSourceText } from "../services/sourceText.js";
import { removeSource, reprocessSource } from "../services/sources.js";
import { hasOriginal, originalPath } from "../services/originals.js";
import { IMAGE_EXTENSIONS, MEDIA_EXTENSIONS } from "../services/ingestion.js";

export const sourcesRouter = Router();

const MAX_TITLE_CHARS = 200;

// Loads :id into req.source (with the user's role in its course) or 404s.
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

// Changing a source (anything but your own chat selection) needs editor or owner.
const requireEditor = (req, _res, next) => {
  try {
    assertRole(req.source.role, "editor");
    next();
  } catch (err) {
    next(err);
  }
};

// Full extracted text, for the source viewer and citation highlighting, plus
// where each page / slide starts in it ([{ label, start, end }] or null).
sourcesRouter.get(
  "/:id/content",
  asyncHandler(async (req, res) => {
    const [text, locations] = await Promise.all([readSourceText(req.params.id), readSourceLocations(req.params.id)]);
    res.json({ text, locations });
  })
);

// The uploaded image or recording itself, shown next to its extracted text
// (supports Range requests so recordings can seek). Other files: 404.
const VIEWABLE = new Set([...IMAGE_EXTENSIONS, ...MEDIA_EXTENSIONS].map((e) => e.slice(1)));
sourcesRouter.get(
  "/:id/original",
  asyncHandler(async (req, res) => {
    if (!VIEWABLE.has(req.source.fileType) || !(await hasOriginal(req.source))) {
      return res.status(404).json({ message: "No viewable original for this source." });
    }
    res.set({ "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox", "Cache-Control": "private, max-age=3600" });
    res.sendFile(originalPath(req.source), { headers: { "Content-Disposition": "inline" } });
  })
);

// Extracts and embeds the source again (e.g. to add page / slide numbers to
// a source added before they existed). 202 + the source, now "processing".
sourcesRouter.post(
  "/:id/reprocess",
  requireEditor,
  asyncHandler(async (req, res) => {
    res.status(202).json(await reprocessSource(req.source, { language: await responseLanguage(req.user.id, req.source.notebookId) }));
  })
);

// Extracts and maps a past paper's questions again (e.g. after adding course
// material or changing units). 202; 409 unless it's a ready past paper.
sourcesRouter.post(
  "/:id/analyse",
  requireEditor,
  asyncHandler(async (req, res) => {
    if (req.source.kind !== "past_paper") return res.status(409).json({ message: "Only past papers can be analysed." });
    if (req.source.status !== "ready") return res.status(409).json({ message: "Wait for the paper to finish processing." });
    if (isAnalysing(req.source.id)) return res.status(409).json({ message: "This paper is already being analysed." });
    analysePaper(req.source.id);
    res.status(202).json({ ...req.source, paperStatus: "pending", paperError: null });
  })
);

// body: { title?, selected?, unitId?, kind?, examName?, examYear? } — `selected` is your own
// chat selection (any member); the rest needs editor: unitId moves the source to a unit
// (null/"general" = General); kind: material (notes) | syllabus | past_paper;
// dismissKindSuggestion: true hides the suggested kind.
sourcesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { title, selected, unitId } = req.body ?? {};
    if (typeof selected === "boolean") {
      await setSourcesSelected(req.user.id, [req.source.id], selected);
      req.source.selected = selected;
    }
    const editing = ["title", "unitId", "kind", "examName", "examYear", "dismissKindSuggestion"].some((key) => req.body?.[key] !== undefined);
    if (!editing) return res.json(req.source);
    assertRole(req.source.role, "editor");

    const patch = {};
    const cleanTitle = typeof title === "string" ? title.trim().slice(0, MAX_TITLE_CHARS) : "";
    if (cleanTitle) Object.assign(patch, { title: cleanTitle, titleIsPlaceholder: false });
    const unit = await resolveUnitId(req.source.notebookId, unitId);
    if (unit !== undefined) patch.unitId = unit;
    // Picking a kind, or dismissing the suggested one, clears the suggestion.
    if (req.body?.kind !== undefined || req.body?.dismissKindSuggestion === true) patch.suggestedKind = null;
    const kindFields = sourceKindFields(req.body);
    let updated = await updateSource(req.params.id, patch);
    if (Object.keys(kindFields).length) updated = await setSourceKind({ ...req.source, ...patch }, kindFields);
    updated = { ...updated, selected: req.source.selected, role: req.source.role };
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
  requireEditor,
  asyncHandler(async (req, res) => {
    await removeSource(req.params.id);
    res.status(204).end();
  })
);
