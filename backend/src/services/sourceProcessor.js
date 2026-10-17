import { assembleSegments, chunkText, normalizeText } from "./ingestion.js";
import { buildVectorStore } from "./vectorStore.js";
import { saveSourceText } from "./sourceText.js";
import { completeJson } from "./llm.js";
import { embeddingModelId } from "./embeddings.js";
import { refreshNotebookOverview } from "./notebookOverview.js";
import { scheduleTopicRefresh } from "./topics.js";
import { analysePaper } from "./pastPapers.js";
import { getSource, updateSource } from "../db/store.js";

const GUIDE_SAMPLE_CHARS = 24_000;

/**
 * The source guide shown when a source is opened: a short
 * summary plus key topics the user can click to ask about.
 */
async function generateSourceGuide(title, text, language) {
  const sample = text.length > GUIDE_SAMPLE_CHARS ? `${text.slice(0, GUIDE_SAMPLE_CHARS)}\n[…truncated…]` : text;
  const guide = await completeJson(
    "You write concise source guides for a college course's study material. Summaries are 3-5 sentences, written in plain prose with the most important terms in **bold** markdown. Key topics are 4-8 short noun phrases (2-5 words) that appear in the source.",
    `Source title: ${title}\n\nSource text:\n${sample}\n\nReturn JSON: {"summary": string, "topics": string[]}`,
    { language }
  );
  return {
    summary: String(guide.summary ?? "").trim(),
    topics: Array.isArray(guide.topics) ? guide.topics.map(String).slice(0, 8) : [],
  };
}

/**
 * Background ingestion for one source. `load(sourceId, onProgress)` resolves
 * to { text, title? } or { segments: [{ label, text }], title? } (file
 * extraction, URL fetch, or pasted text); segments give citations their page,
 * slide or timestamp. Slow loaders (OCR, transcription) call
 * `onProgress(fraction, note)`, shown as 10-30% with the note. Status moves processing → ready | error while the client polls the
 * source list. `language` is the response language of the guide (and overview). With `reprocess`, a failure leaves the source usable (ready,
 * with the old chunks) and only records the error.
 */
export async function processSource(sourceId, load, { reprocess = false, language } = {}) {
  try {
    await updateSource(sourceId, { progress: 10 });

    let lastLoadReport = 0;
    let lastNote;
    let pendingReport = Promise.resolve();
    const onLoadProgress = (fraction, note) => {
      const now = Date.now();
      if (now - lastLoadReport < 1000 && fraction < 1 && note === lastNote) return;
      lastLoadReport = now;
      lastNote = note;
      const progress = 10 + Math.round(Math.min(1, Math.max(0, fraction)) * 19);
      pendingReport = pendingReport
        .then(() => updateSource(sourceId, { progress, ...(note !== undefined && { progressNote: String(note).slice(0, 200) }) }))
        .catch(() => {});
    };
    const loaded = await load(sourceId, onLoadProgress).finally(() => pendingReport);
    const { text, locations } = loaded.segments
      ? assembleSegments(loaded.segments)
      : { text: normalizeText(loaded.text ?? ""), locations: null };
    if (!text) throw new Error("No extractable text found in this source.");

    const current = await getSource(sourceId);
    if (!current) return; // deleted while loading
    const title = loaded.title && current.titleIsPlaceholder ? loaded.title : current.title;

    await saveSourceText(sourceId, text, locations?.length ? locations : null);
    await updateSource(sourceId, { progress: 30, progressNote: null, title, titleIsPlaceholder: false });

    const chunks = await chunkText(text, { sourceId, sourceTitle: title, locations });
    let lastReported = 30;
    await buildVectorStore(sourceId, chunks, (fraction) => {
      const progress = 30 + Math.round(fraction * 60);
      if (progress - lastReported >= 10) {
        lastReported = progress;
        updateSource(sourceId, { progress }).catch(() => {});
      }
    });

    await updateSource(sourceId, {
      status: "ready",
      progress: 100,
      progressNote: null,
      error: null,
      chunkCount: chunks.length,
      embeddingModel: embeddingModelId(),
      charCount: text.length,
      wordCount: text.split(/\s+/).length,
    });

    // The source is usable for chat already; the guide and course overview
    // are nice-to-haves that need the LLM, so their failures stay soft.
    try {
      const guide = await generateSourceGuide(title, text, language);
      await updateSource(sourceId, { guide });
    } catch (err) {
      console.warn(`Source guide failed for ${sourceId}: ${err.message}`);
    }

    const source = await getSource(sourceId);
    if (source) {
      refreshNotebookOverview(source.notebookId, { language });
      scheduleTopicRefresh(source.notebookId, source.unitId);
      if (source.kind === "past_paper") analysePaper(sourceId);
    }
  } catch (err) {
    // Runs in the background, so a failed status write must not crash the server.
    await updateSource(
      sourceId,
      reprocess
        ? { status: "ready", progress: 100, progressNote: null, error: `Re-processing failed: ${err.message}` }
        : { status: "error", progress: 100, progressNote: null, error: err.message }
    ).catch((writeErr) => console.error(`Could not record the failure of source ${sourceId}: ${writeErr.message}`));
  }
}
