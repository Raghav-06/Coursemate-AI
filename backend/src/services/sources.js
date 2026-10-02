import fs from "node:fs/promises";
import { v4 as uuidv4 } from "uuid";
import { config } from "../config/index.js";
import { addSource, countSources, deleteSource } from "../db/store.js";
import { processSource } from "./sourceProcessor.js";
import { deleteVectorStore } from "./vectorStore.js";
import { deleteSourceText } from "./sourceText.js";
import { refreshNotebookOverview } from "./notebookOverview.js";

export async function assertCapacity(notebookId, adding) {
  const count = await countSources(notebookId);
  const max = config.limits.sourcesPerNotebook;
  if (count + adding > max) {
    throw Object.assign(new Error(`A notebook can hold up to ${max} sources (it has ${count}).`), { status: 409 });
  }
}

/**
 * Registers a source and ingests it in the background. `load` resolves to
 * { text, title? }; a loaded title replaces the placeholder (e.g. a URL's
 * page title replaces the raw URL).
 */
export async function createSource(notebookId, fields, load) {
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
  processSource(created.id, load);
  return created;
}

export async function removeSource(id) {
  const source = await deleteSource(id);
  if (!source) return null;
  await Promise.all([deleteVectorStore(id), deleteSourceText(id)]);
  refreshNotebookOverview(source.notebookId);
  return source;
}

export async function removeSourceFiles(sources) {
  await Promise.all(sources.flatMap((s) => [deleteVectorStore(s.id), deleteSourceText(s.id)]));
}

export function unlinkQuietly(filePath) {
  return fs.unlink(filePath).catch(() => {});
}
