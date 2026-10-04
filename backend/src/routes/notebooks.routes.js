import { Router } from "express";
import path from "node:path";
import { asyncHandler, isUuid } from "../utils/asyncHandler.js";
import { upload } from "../middleware/upload.js";
import {
  addMessage,
  addNotebook,
  clearMessages,
  deleteNotebook,
  getNotebook,
  listMessages,
  listNotebooks,
  listSources,
  updateNotebook,
} from "../db/store.js";
import { extractText } from "../services/ingestion.js";
import { loadUrl } from "../services/urlLoader.js";
import { assertCapacity, createSource, removeSourceFiles, unlinkQuietly } from "../services/sources.js";
import { answerQuestion } from "../services/ragService.js";
import { refreshNotebookOverview } from "../services/notebookOverview.js";
import { assertApiKey } from "../services/llm.js";

export const notebooksRouter = Router();

const MAX_TITLE_CHARS = 200;
const MAX_MESSAGE_CHARS = 8000;

const cleanTitle = (value) => (typeof value === "string" ? value.trim().slice(0, MAX_TITLE_CHARS) : "");

const DEFAULT_EMOJIS = ["📓", "📘", "📗", "📙", "📕", "🧠", "🔬", "📚", "💡", "🧪"];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Loads :id into req.notebook or 404s. Only the signed-in user's notebooks match.
notebooksRouter.param("id", async (req, _res, next, id) => {
  try {
    req.notebook = isUuid(id) ? await getNotebook(id, req.user.id) : null;
    next(req.notebook ? undefined : httpError(404, "Notebook not found."));
  } catch (err) {
    next(err);
  }
});

// Sources a request should use: explicit ids if given, else the ones ticked
// in the sources panel. Only ingested sources can be used.
async function resolveSources(notebookId, sourceIds) {
  const all = await listSources(notebookId);
  const wanted = Array.isArray(sourceIds) ? all.filter((s) => sourceIds.includes(s.id)) : all.filter((s) => s.selected);
  return wanted.filter((s) => s.status === "ready");
}

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
      title: title || "Untitled notebook",
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
  asyncHandler(async (req, res) => {
    const { title, emoji } = req.body ?? {};
    const patch = {};
    if (cleanTitle(title)) Object.assign(patch, { title: cleanTitle(title), titleIsAuto: false });
    if (typeof emoji === "string" && emoji.trim()) patch.emoji = emoji.trim();
    res.json(await updateNotebook(req.params.id, patch));
  })
);

notebooksRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const removedSources = await deleteNotebook(req.params.id);
    await removeSourceFiles(removedSources);
    res.status(204).end();
  })
);

notebooksRouter.post(
  "/:id/overview",
  asyncHandler(async (req, res) => {
    refreshNotebookOverview(req.params.id);
    res.status(202).json({ ok: true });
  })
);

// ---- Sources ---------------------------------------------------------------

notebooksRouter.get(
  "/:id/sources",
  asyncHandler(async (req, res) => {
    res.json(await listSources(req.params.id));
  })
);

// multipart "files" (one or many)
notebooksRouter.post(
  "/:id/sources/files",
  upload.array("files"),
  asyncHandler(async (req, res) => {
    const files = req.files ?? [];
    if (files.length === 0) throw httpError(400, "No files uploaded.");
    try {
      await assertCapacity(req.params.id, files.length);
    } catch (err) {
      await Promise.all(files.map((f) => unlinkQuietly(f.path)));
      throw err;
    }

    const created = [];
    for (const file of files) {
      created.push(
        await createSource(
          req.params.id,
          { type: "file", title: file.originalname, fileName: file.originalname, fileType: path.extname(file.originalname).slice(1).toLowerCase() },
          async () => {
            try {
              return { text: await extractText(file.path) };
            } finally {
              unlinkQuietly(file.path);
            }
          }
        )
      );
    }
    res.status(202).json(created);
  })
);

// body: { urls: string[] } or { url, title? } — websites, PDF links, arXiv papers…
notebooksRouter.post(
  "/:id/sources/url",
  asyncHandler(async (req, res) => {
    const { url } = req.body ?? {};
    const title = cleanTitle(req.body?.title);
    const urls = (Array.isArray(req.body?.urls) ? req.body.urls : [url]).map((u) => String(u ?? "").trim()).filter(Boolean);
    if (urls.length === 0) throw httpError(400, "Paste at least one link.");
    for (const u of urls) {
      try {
        const parsed = new URL(u);
        if (!/^https?:$/.test(parsed.protocol)) throw new Error();
      } catch {
        throw httpError(400, `"${u}" is not a valid http(s) link.`);
      }
    }
    await assertCapacity(req.params.id, urls.length);

    const created = [];
    for (const u of urls) {
      created.push(
        await createSource(
          req.params.id,
          { type: "url", url: u, title: title || u.slice(0, MAX_TITLE_CHARS), titleIsPlaceholder: !title },
          async () => {
            const loaded = await loadUrl(u);
            return { text: loaded.text, title: loaded.title };
          }
        )
      );
    }
    res.status(202).json(created);
  })
);

// body: { title?, text } — "Copied text" sources
notebooksRouter.post(
  "/:id/sources/text",
  asyncHandler(async (req, res) => {
    const text = String(req.body?.text ?? "");
    if (!text.trim()) throw httpError(400, "Paste some text to add as a source.");
    await assertCapacity(req.params.id, 1);

    const title = cleanTitle(req.body?.title) || "Pasted text";
    const source = await createSource(req.params.id, { type: "text", title }, async () => ({ text }));
    res.status(202).json(source);
  })
);

// ---- Chat --------------------------------------------------------------------

notebooksRouter.get(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    res.json(await listMessages(req.params.id));
  })
);

notebooksRouter.delete(
  "/:id/messages",
  asyncHandler(async (req, res) => {
    await clearMessages(req.params.id);
    res.status(204).end();
  })
);

/**
 * body: { content, sourceIds? } — streams the answer as Server-Sent Events:
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

    const sources = await resolveSources(req.params.id, req.body?.sourceIds);
    if (sources.length === 0) throw httpError(409, "Select at least one ready source to chat with.");
    assertApiKey(); // fail fast (503) before storing the question if no API key is set

    const history = await listMessages(req.params.id);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    const userMessage = await addMessage(req.params.id, { role: "user", content });
    send({ type: "user", message: userMessage });

    let answer = "";
    try {
      const { citations, stream } = await answerQuestion({
        sources,
        question: content,
        history,
      });
      send({ type: "citations", citations });

      for await (const delta of stream) {
        answer += delta;
        send({ type: "delta", text: delta });
      }

      const assistantMessage = await addMessage(req.params.id, { role: "assistant", content: answer, citations });
      send({ type: "done", message: assistantMessage });
    } catch (err) {
      console.error(err);
      send({ type: "error", message: err.message || "The answer could not be generated." });
    }
    res.end();
  })
);

