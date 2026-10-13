import { Router } from "express";
import path from "node:path";
import { asyncHandler, isUuid } from "../utils/asyncHandler.js";
import { upload } from "../middleware/upload.js";
import {
  addMessage,
  addNotebook,
  addUnit,
  clearMessages,
  countUnits,
  deleteNotebook,
  deleteUnit,
  getNotebook,
  getUnit,
  listMessages,
  listNotebooks,
  listSources,
  listUnits,
  renameUnit,
  reorderUnits,
  updateNotebook,
} from "../db/store.js";
import { config } from "../config/index.js";
import { httpError, idList, languagePatch, requireRole, resolveSources, resolveUnitId, sourceKindFields } from "./helpers.js";
import { extractDocument } from "../services/ingestion.js";
import { keepOriginal } from "../services/originals.js";
import { loadUrl } from "../services/urlLoader.js";
import { assertCapacity, createSource, removeSourceFiles, unlinkQuietly } from "../services/sources.js";
import { answerQuestion } from "../services/ragService.js";
import { refreshNotebookOverview } from "../services/notebookOverview.js";
import { assertApiKey } from "../services/llm.js";
import { courseStudyRoutes } from "./study.routes.js";
import { coursePracticeRoutes } from "./practice.routes.js";
import { coursePastPaperRoutes } from "./pastPapers.routes.js";
import { courseExamRoutes } from "./exams.routes.js";
import { courseMemberRoutes } from "./members.routes.js";
import { courseBattleRoutes } from "./battles.routes.js";
import { recordActivity } from "../db/exams.js";
import { responseLanguage } from "../services/language.js";
import { getCoursePreferences, updateCoursePreferences } from "../db/preferences.js";
import { scheduleTopicRefresh } from "../services/topics.js";
import { deleteUnitTopics } from "../db/practice.js";

export const notebooksRouter = Router();

const MAX_TITLE_CHARS = 200;
const MAX_UNIT_TITLE_CHARS = 120;
const MAX_MESSAGE_CHARS = 8000;

const cleanTitle = (value, max = MAX_TITLE_CHARS) => (typeof value === "string" ? value.trim().slice(0, max) : "");

const DEFAULT_EMOJIS = ["📓", "📘", "📗", "📙", "📕", "🧠", "🔬", "📚", "💡", "🧪"];

// Loads :id into req.notebook (with the user's role) or 404s. Only courses the
// signed-in user is a member of match; mutating routes add requireRole().
notebooksRouter.param("id", async (req, _res, next, id) => {
  try {
    req.notebook = isUuid(id) ? await getNotebook(id, req.user.id) : null;
    next(req.notebook ? undefined : httpError(404, "Course not found."));
  } catch (err) {
    next(err);
  }
});

// Loads :unitId (a unit of the course already loaded by :id) into req.unit.
notebooksRouter.param("unitId", async (req, _res, next, unitId) => {
  try {
    req.unit = isUuid(unitId) && req.notebook ? await getUnit(unitId, req.notebook.id) : null;
    next(req.unit ? undefined : httpError(404, "Unit not found."));
  } catch (err) {
    next(err);
  }
});

// ---- Notebooks -------------------------------------------------------------

notebooksRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await listNotebooks(req.user.id));
  })
);

notebooksRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const title = cleanTitle(req.body?.title);
    const notebook = await addNotebook({
      userId: req.user.id,
      title: title || "Untitled course",
      titleIsAuto: !title,
      emoji: DEFAULT_EMOJIS[Math.floor(Math.random() * DEFAULT_EMOJIS.length)],
      summary: null,
      suggestedQuestions: [],
    });
    res.status(201).json({ ...notebook, sourceCount: 0 });
  })
);

notebooksRouter.get("/:id", (req, res) => res.json(req.notebook));

notebooksRouter.patch(
  "/:id",
  requireRole("editor"),
  asyncHandler(async (req, res) => {
    const { title, emoji } = req.body ?? {};
    const patch = {};
    if (cleanTitle(title)) Object.assign(patch, { title: cleanTitle(title), titleIsAuto: false });
    if (typeof emoji === "string" && emoji.trim()) patch.emoji = emoji.trim().slice(0, 16);
    await updateNotebook(req.params.id, patch);
    res.json(await getNotebook(req.params.id, req.user.id));
  })
);

notebooksRouter.delete(
  "/:id",
  requireRole("owner"),
  asyncHandler(async (req, res) => {
    const removedSources = await deleteNotebook(req.params.id);
    await removeSourceFiles(removedSources);
    res.status(204).end();
  })
);

notebooksRouter.post(
  "/:id/overview",
  requireRole("editor"),
  asyncHandler(async (req, res) => {
    refreshNotebookOverview(req.params.id, { language: await responseLanguage(req.user.id, req.params.id) });
    res.status(202).json({ ok: true });
  })
);

// ---- Units -----------------------------------------------------------------

notebooksRouter.get(
  "/:id/units",
  asyncHandler(async (req, res) => {
    res.json(await listUnits(req.params.id));
  })
);

// body: { title }
notebooksRouter.post(
  "/:id/units",
  requireRole("editor"),
  asyncHandler(async (req, res) => {
    const title = cleanTitle(req.body?.title, MAX_UNIT_TITLE_CHARS);
    if (!title) throw httpError(400, "Give the unit a name.");
    const max = config.limits.unitsPerNotebook;
    if ((await countUnits(req.params.id)) >= max) throw httpError(409, `A course can have up to ${max} units.`);
    res.status(201).json(await addUnit(req.params.id, title));
  })
);

// body: { unitIds: [...] } — the new order. Registered before /:unitId so
// "order" is never read as a unit id.
notebooksRouter.put(
  "/:id/units/order",
  requireRole("editor"),
  asyncHandler(async (req, res) => {
    const unitIds = idList(req.body?.unitIds, { name: "unitIds" });
    if (!unitIds) throw httpError(400, "unitIds is required.");
    res.json(await reorderUnits(req.params.id, unitIds));
  })
);

// body: { title }
notebooksRouter.patch(
  "/:id/units/:unitId",
  requireRole("editor"),
  asyncHandler(async (req, res) => {
    const title = cleanTitle(req.body?.title, MAX_UNIT_TITLE_CHARS);
    if (!title) throw httpError(400, "Give the unit a name.");
    res.json(await renameUnit(req.unit.id, title));
  })
);

// Its sources move to General (and its topics go with it).
notebooksRouter.delete(
  "/:id/units/:unitId",
  requireRole("editor"),
  asyncHandler(async (req, res) => {
    await deleteUnitTopics(req.notebook.id, req.unit.id);
    await deleteUnit(req.unit.id);
    scheduleTopicRefresh(req.notebook.id, null);
    res.status(204).end();
  })
);

// ---- Sources ---------------------------------------------------------------

notebooksRouter.get(
  "/:id/sources",
  asyncHandler(async (req, res) => {
    res.json(await listSources(req.params.id, req.user.id));
  })
);

// multipart "files" (one or many), plus an optional "unitId" field
notebooksRouter.post(
  "/:id/sources/files",
  requireRole("editor"),
  upload.array("files"),
  asyncHandler(async (req, res) => {
    const files = req.files ?? [];
    if (files.length === 0) throw httpError(400, "No files uploaded.");
    let unitId;
    let kindFields;
    let language;
    try {
      unitId = await resolveUnitId(req.params.id, req.body?.unitId);
      kindFields = sourceKindFields(req.body);
      await assertCapacity(req.params.id, files.length);
      language = await responseLanguage(req.user.id, req.params.id);
    } catch (err) {
      await Promise.all(files.map((f) => unlinkQuietly(f.path)));
      throw err;
    }

    const created = [];
    for (const file of files) {
      const fileType = path.extname(file.originalname).slice(1).toLowerCase();
      created.push(
        await createSource(
          req.params.id,
          { type: "file", unitId, ...kindFields, title: file.originalname, fileName: file.originalname, fileType },
          async (sourceId, onProgress) => {
            // The original is kept so the source can be re-processed later
            // (and images / recordings shown in the viewer).
            try {
              return await extractDocument(await keepOriginal(file.path, { id: sourceId, fileType }), { onProgress });
            } finally {
              unlinkQuietly(file.path);
            }
          },
          { language }
        )
      );
    }
    res.status(202).json(created);
  })
);

// body: { urls: string[] } or { url, title? }, plus unitId? — websites, PDF links, arXiv papers…
notebooksRouter.post(
  "/:id/sources/url",
  requireRole("editor"),
  asyncHandler(async (req, res) => {
    const { url } = req.body ?? {};
    const title = cleanTitle(req.body?.title);
    const urls = (Array.isArray(req.body?.urls) ? req.body.urls : [url]).map((u) => String(u ?? "").trim()).filter(Boolean);
    if (urls.length === 0) throw httpError(400, "Paste at least one link.");
    if (urls.length > 50) throw httpError(400, "Add up to 50 links at a time.");
    for (const u of urls) {
      if (u.length > 2048) throw httpError(400, "Links are limited to 2,048 characters.");
      try {
        const parsed = new URL(u);
        if (!/^https?:$/.test(parsed.protocol)) throw new Error();
      } catch {
        throw httpError(400, `"${u}" is not a valid http(s) link.`);
      }
    }
    const unitId = await resolveUnitId(req.params.id, req.body?.unitId);
    const kindFields = sourceKindFields(req.body);
    await assertCapacity(req.params.id, urls.length);
    const language = await responseLanguage(req.user.id, req.params.id);

    const created = [];
    for (const u of urls) {
      created.push(
        await createSource(
          req.params.id,
          { type: "url", unitId, ...kindFields, url: u, title: title || u.slice(0, MAX_TITLE_CHARS), titleIsPlaceholder: !title },
          () => loadUrl(u),
          { language }
        )
      );
    }
    res.status(202).json(created);
  })
);

// body: { title?, text, unitId? } — "Copied text" sources
notebooksRouter.post(
  "/:id/sources/text",
  requireRole("editor"),
  asyncHandler(async (req, res) => {
    const text = String(req.body?.text ?? "");
    if (!text.trim()) throw httpError(400, "Paste some text to add as a source.");
    if (text.length > 2_000_000) throw httpError(413, "Pasted text is limited to 2 million characters.");
    const unitId = await resolveUnitId(req.params.id, req.body?.unitId);
    const kindFields = sourceKindFields(req.body);
    await assertCapacity(req.params.id, 1);
    const language = await responseLanguage(req.user.id, req.params.id);

    const title = cleanTitle(req.body?.title) || "Pasted text";
    const source = await createSource(req.params.id, { type: "text", unitId, ...kindFields, title }, async () => ({ text }), { language });
    res.status(202).json(source);
  })
);

// ---- Chat --------------------------------------------------------------------

notebooksRouter.get(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    res.json(await listMessages(req.params.id, req.user.id));
  })
);

notebooksRouter.delete(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    await clearMessages(req.params.id, req.user.id);
    res.status(204).end();
  })
);

/**
 * body: { content, sourceIds?, unitIds? } — unitIds limits retrieval to those
 * units ("general" = sources without a unit). Streams the answer as Server-Sent Events:
 *   { type: "user", message }        the stored user message
 *   { type: "citations", citations } passages the answer may cite as [n]
 *   { type: "delta", text }          answer text as it is generated
 *   { type: "done", message }        the stored assistant message
 *   { type: "error", message }
 */
notebooksRouter.post(
  "/:id/chat",
  asyncHandler(async (req, res) => {
    const content = String(req.body?.content ?? "").trim();
    if (!content) throw httpError(400, "Message content is required.");
    if (content.length > MAX_MESSAGE_CHARS) throw httpError(413, "Messages are limited to 8,000 characters.");

    const unitIds = idList(req.body?.unitIds, { allow: ["general"], name: "unitIds" });
    // Past papers are left out unless the user asks to include them.
    const includePastPapers = req.body?.includePastPapers === true;
    const sources = await resolveSources(req.params.id, {
      userId: req.user.id,
      sourceIds: idList(req.body?.sourceIds, { name: "sourceIds" }),
      unitIds,
      includePastPapers,
    });
    if (sources.length === 0) {
      throw httpError(409, unitIds?.length ? "No selected, ready sources in the chosen units." : "Select at least one ready source to chat with.");
    }
    assertApiKey(); // fail fast (503) before storing the question if no API key is set

    const history = await listMessages(req.params.id, req.user.id);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    const userMessage = await addMessage(req.params.id, req.user.id, { role: "user", content });
    await recordActivity(req.user.id, req.tz, "chat");
    send({ type: "user", message: userMessage });

    let answer = "";
    try {
      const { citations, stream } = await answerQuestion({
        sources,
        question: content,
        history,
        language: await responseLanguage(req.user.id, req.params.id),
      });
      send({ type: "citations", citations });

      for await (const delta of stream) {
        answer += delta;
        send({ type: "delta", text: delta });
      }

      const assistantMessage = await addMessage(req.params.id, req.user.id, { role: "assistant", content: answer, citations });
      send({ type: "done", message: assistantMessage });
    } catch (err) {
      console.error(err);
      send({ type: "error", message: err.message || "The answer could not be generated." });
    }
    res.end();
  })
);


// ---- Study (flashcard decks) ------------------------------------------------

courseStudyRoutes(notebooksRouter);

// ---- Practice (topics, quizzes, written answers, progress) ----------------------

coursePracticeRoutes(notebooksRouter);

// ---- Past papers (exam insights) ------------------------------------------------------

coursePastPaperRoutes(notebooksRouter);

// ---- Your settings for this course (personal) ----------------------------------------------

// { language: code | null (= your default), bilingual, effective: { code, name, native, bilingual } }
async function coursePreferences(userId, notebookId) {
  const prefs = await getCoursePreferences(userId, notebookId);
  return { language: prefs.language ?? null, bilingual: prefs.bilingual ?? false, effective: await responseLanguage(userId, notebookId) };
}

notebooksRouter.get(
  "/:id/preferences",
  asyncHandler(async (req, res) => {
    res.json(await coursePreferences(req.user.id, req.notebook.id));
  })
);

// body: { language?: code | null (use your default), bilingual?: boolean }
notebooksRouter.patch(
  "/:id/preferences",
  asyncHandler(async (req, res) => {
    const patch = languagePatch(req.body, { allowInherit: true });
    // Going back to the default language drops the course's bilingual choice too.
    if (patch.language === null) patch.bilingual = null;
    if (Object.keys(patch).length) await updateCoursePreferences(req.user.id, req.notebook.id, patch);
    res.json(await coursePreferences(req.user.id, req.notebook.id));
  })
);

// ---- Exams and revision plans (personal) ------------------------------------------------

courseExamRoutes(notebooksRouter);

// ---- Sharing (members, invites) and quiz battles ------------------------------------------

courseMemberRoutes(notebooksRouter);
courseBattleRoutes(notebooksRouter);
