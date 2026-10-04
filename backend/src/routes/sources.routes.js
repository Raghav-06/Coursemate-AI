import { Router } from "express";
import { asyncHandler, isUuid } from "../utils/asyncHandler.js";
import { getSource, updateSource } from "../db/store.js";
import { readSourceText } from "../services/sourceText.js";
import { removeSource } from "../services/sources.js";

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

// Full extracted text, for the source viewer and citation highlighting.
sourcesRouter.get(
  "/:id/content",
  asyncHandler(async (req, res) => {
    res.json({ text: await readSourceText(req.params.id) });
  })
);

// body: { title?, selected? }
sourcesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { title, selected } = req.body ?? {};
    const patch = {};
    const cleanTitle = typeof title === "string" ? title.trim().slice(0, MAX_TITLE_CHARS) : "";
    if (cleanTitle) Object.assign(patch, { title: cleanTitle, titleIsPlaceholder: false });
    if (typeof selected === "boolean") patch.selected = selected;
    res.json(await updateSource(req.params.id, patch));
  })
);

sourcesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await removeSource(req.params.id);
    res.status(204).end();
  })
);
