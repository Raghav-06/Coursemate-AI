import { chunkText, normalizeText } from "./ingestion.js";
import { buildVectorStore } from "./vectorStore.js";
import { saveSourceText } from "./sourceText.js";
import { completeJson } from "./llm.js";
import { embeddingModelId } from "./embeddings.js";
import { refreshNotebookOverview } from "./notebookOverview.js";
import { getSource, updateSource } from "../db/store.js";

const GUIDE_SAMPLE_CHARS = 24_000;

/**
 * The "source guide" NotebookLM shows when a source is opened: a short
 * summary plus key topics the user can click to ask about.
 */
async function generateSourceGuide(title, text) {
  const sample = text.length > GUIDE_SAMPLE_CHARS ? `${text.slice(0, GUIDE_SAMPLE_CHARS)}\n[…truncated…]` : text;
  const guide = await completeJson(
    "You write concise source guides for a research notebook. Summaries are 3-5 sentences, written in plain prose with the most important terms in **bold** markdown. Key topics are 4-8 short noun phrases (2-5 words) that appear in the source.",
    `Source title: ${title}\n\nSource text:\n${sample}\n\nReturn JSON: {"summary": string, "topics": string[]}`
  );
  return {
    summary: String(guide.summary ?? "").trim(),
    topics: Array.isArray(guide.topics) ? guide.topics.map(String).slice(0, 8) : [],
  };
}

/**
 * Background ingestion for one source. `load` resolves to { text, title? }
 * (file extraction, URL fetch, or pasted text). Status moves
 * processing → ready | error while the client polls the source list.
 */
export async function processSource(sourceId, load) {
  try {
    await updateSource(sourceId, { progress: 10 });

    const loaded = await load();
    const text = normalizeText(loaded.text ?? "");
    if (!text) throw new Error("No extractable text found in this source.");

    const current = await getSource(sourceId);
    if (!current) return; // deleted while loading
    const title = loaded.title && current.titleIsPlaceholder ? loaded.title : current.title;

    await saveSourceText(sourceId, text);
    await updateSource(sourceId, { progress: 30, title, titleIsPlaceholder: false });

    const chunks = await chunkText(text, { sourceId, sourceTitle: title });
    let lastReported = 30;
    await buildVectorStore(sourceId, chunks, (fraction) => {
      const progress = 30 + Math.round(fraction * 60);
      if (progress - lastReported >= 10) {
        lastReported = progress;
        updateSource(sourceId, { progress });
      }
    });

    await updateSource(sourceId, {
      status: "ready",
      progress: 100,
      chunkCount: chunks.length,
      embeddingModel: embeddingModelId(),
      charCount: text.length,
      wordCount: text.split(/\s+/).length,
    });

    // The source is usable for chat already; the guide and notebook overview
    // are nice-to-haves that need the LLM, so their failures stay soft.
    try {
      const guide = await generateSourceGuide(title, text);
      await updateSource(sourceId, { guide });
    } catch (err) {
      console.warn(`Source guide failed for ${sourceId}: ${err.message}`);
    }

    const source = await getSource(sourceId);
    if (source) refreshNotebookOverview(source.notebookId);
  } catch (err) {
    await updateSource(sourceId, { status: "error", progress: 100, error: err.message });
  }
}
