import fs from "node:fs/promises";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config/index.js";
import { addSource, claimSourceForProcessing, countSources, deleteSource, getSource } from "../db/store.js";
import { processSource } from "./sourceProcessor.js";
import { deleteVectorStore } from "./vectorStore.js";
import { deleteSourceText, readSourceText } from "./sourceText.js";
import { refreshNotebookOverview } from "./notebookOverview.js";
import { deleteOriginal, hasOriginal, originalPath } from "./originals.js";
import { extractDocument, slideSegmentsFromText } from "./ingestion.js";
import { loadUrl } from "./urlLoader.js";
import { scheduleTopicRefresh } from "./topics.js";

export async function assertCapacity(notebookId, adding) {
  const count = await countSources(notebookId);
  const max = config.limits.sourcesPerNotebook;
  if (count + adding > max) {
    throw Object.assign(new Error(`A course can hold up to ${max} sources (it has ${count}).`), { status: 409 });
  }
}

/**
 * Registers a source and ingests it in the background. `load(sourceId)`
 * resolves to { text | segments, title? }; a loaded title replaces the
 * placeholder (e.g. a URL's page title replaces the raw URL).
 */
export async function createSource(notebookId, fields, load, { language } = {}) {
  const source = {
    id: uuidv4(),
    notebookId,
    status: "processing",
    progress: 0,
    selected: true,
    guide: null,
    chunkCount: null,
    createdAt: new Date().toISOString(),
    ...fields,
  };
  const created = await addSource(source);
  processSource(created.id, load, { language });
  return created;
}

export async function removeSource(id) {
  const source = await deleteSource(id);
  if (!source) return null;
  await Promise.all([deleteVectorStore(id), deleteSourceText(id), deleteOriginal(source)]);
  refreshNotebookOverview(source.notebookId);
  scheduleTopicRefresh(source.notebookId, source.unitId);
  return source;
}

export async function removeSourceFiles(sources) {
  await Promise.all(sources.flatMap((s) => [deleteVectorStore(s.id), deleteSourceText(s.id), deleteOriginal(s)]));
}

const conflict = (message) => Object.assign(new Error(message), { status: 409 });

/**
 * Extracts, chunks and embeds a source again — e.g. so a source added before
 * page numbers existed gains them. Files use the kept original (old PPTX
 * sources recover their slides from the stored text), links are fetched
 * again, pasted text is re-chunked; images are read and recordings
 * transcribed again. Runs in the background like a new source.
 */
export async function reprocessSource(source, { language } = {}) {
  if (source.status === "processing") throw conflict("This source is still being processed.");

  let load;
  if (source.type === "file") {
    if (await hasOriginal(source)) {
      load = (_id, onProgress) => extractDocument(originalPath(source), { onProgress });
    } else if (source.fileType === "pptx") {
      const segments = slideSegmentsFromText(await readSourceText(source.id));
      if (segments) load = async () => ({ segments });
    }
    if (!load) {
      throw conflict("The original file of this source wasn't kept (it was added before page numbers were supported). Remove it and upload it again to get page numbers.");
    }
  } else if (source.type === "url") {
    load = () => loadUrl(source.url);
  } else {
    const text = await readSourceText(source.id);
    load = async () => ({ text });
  }

  const wasReady = source.status === "ready";
  if (!(await claimSourceForProcessing(source.id))) throw conflict("This source is still being processed.");
  processSource(source.id, load, { reprocess: wasReady, language });
  return getSource(source.id);
}

export function unlinkQuietly(filePath) {
  return fs.unlink(filePath).catch(() => {});
}
