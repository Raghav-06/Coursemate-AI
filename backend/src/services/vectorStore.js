import { config } from "../config/index.js";
import { embeddingModelId, getEmbeddings } from "./embeddings.js";
import { loadChunks, replaceChunks, updateSource } from "../db/store.js";

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

function toDocument(record) {
  return { pageContent: record.pageContent, metadata: record.metadata };
}

/**
 * Pure-JS vector store: a flat array of { pageContent, metadata, embedding },
 * persisted in the Postgres `chunks` table and searched with brute-force cosine
 * similarity and MMR. Each source has its own rows; a notebook query merges
 * the stores of whichever sources are selected. Brute force is fine at
 * notebook scale (up to 50 sources, a few thousand chunks).
 */
class FlatVectorStore {
  constructor(records) {
    this.records = records;
  }

  static async fromDocuments(chunks, embeddings, onProgress) {
    const vectors = await embeddings.embedDocuments(
      chunks.map((c) => c.pageContent),
      onProgress
    );
    const records = chunks.map((chunk, i) => ({
      pageContent: chunk.pageContent,
      metadata: chunk.metadata,
      embedding: vectors[i],
    }));
    return new FlatVectorStore(records);
  }

  static merge(stores) {
    return new FlatVectorStore(stores.flatMap((s) => s.records));
  }

  async save(sourceId) {
    await replaceChunks(sourceId, this.records);
  }

  static async load(sourceId) {
    const records = await loadChunks(sourceId);
    if (records.length === 0) throw new Error(`No chunks stored for source ${sourceId}.`);
    return new FlatVectorStore(records);
  }

  async similaritySearch(query, k, embeddings) {
    const queryVector = await embeddings.embedQuery(query);
    return this.records
      .map((r) => ({ ...r, score: cosineSimilarity(queryVector, r.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(toDocument);
  }

  async maxMarginalRelevanceSearch(query, { k, fetchK, lambdaMult }, embeddings) {
    const queryVector = await embeddings.embedQuery(query);
    const candidates = this.records
      .map((r) => ({ ...r, queryScore: cosineSimilarity(queryVector, r.embedding) }))
      .sort((a, b) => b.queryScore - a.queryScore)
      .slice(0, fetchK);

    const selected = [];
    const remaining = [...candidates];

    while (selected.length < k && remaining.length > 0) {
      let bestIndex = 0;
      let bestScore = -Infinity;

      remaining.forEach((candidate, idx) => {
        const maxSimToSelected = selected.length
          ? Math.max(...selected.map((s) => cosineSimilarity(candidate.embedding, s.embedding)))
          : 0;
        const mmrScore = lambdaMult * candidate.queryScore - (1 - lambdaMult) * maxSimToSelected;
        if (mmrScore > bestScore) {
          bestScore = mmrScore;
          bestIndex = idx;
        }
      });

      selected.push(remaining.splice(bestIndex, 1)[0]);
    }

    return selected.map(toDocument);
  }
}

// Loaded stores are kept in memory: every chat turn re-reads the same chunks.
const cache = new Map();

export async function buildVectorStore(sourceId, chunks, onProgress) {
  const store = await FlatVectorStore.fromDocuments(chunks, getEmbeddings(), onProgress);
  await store.save(sourceId);
  cache.set(sourceId, store);
  return store;
}

export async function loadVectorStore(sourceId) {
  if (!cache.has(sourceId)) cache.set(sourceId, await FlatVectorStore.load(sourceId));
  return cache.get(sourceId);
}

/**
 * Re-embeds sources whose vectors came from a different embedding model (e.g.
 * after changing EMBEDDING_MODEL), so they can be searched alongside new ones.
 */
export async function ensureCurrentEmbeddings(sources) {
  const current = embeddingModelId();
  for (const source of sources) {
    if (!source.embeddingModel || source.embeddingModel === current) continue;
    const records = await loadChunks(source.id);
    if (records.length === 0) continue;
    const vectors = await getEmbeddings().embedDocuments(records.map((r) => r.pageContent));
    const store = new FlatVectorStore(records.map((r, i) => ({ ...r, embedding: vectors[i] })));
    await store.save(source.id);
    cache.set(source.id, store);
    await updateSource(source.id, { embeddingModel: current });
    source.embeddingModel = current;
  }
}

export async function loadMergedStore(sourceIds) {
  const stores = await Promise.all(sourceIds.map((id) => loadVectorStore(id).catch(() => null)));
  return FlatVectorStore.merge(stores.filter(Boolean));
}

export async function deleteVectorStore(sourceId) {
  // Rows are removed by ON DELETE CASCADE with the source; just drop the cache.
  cache.delete(sourceId);
}

// For demo scripts that don't need persistence (mmrDemo.js, multiQueryDemo.js).
export async function createInMemoryStore(chunks) {
  return FlatVectorStore.fromDocuments(chunks, getEmbeddings());
}

export async function mmrSearch(store, query, overrides = {}) {
  const { k, fetchK, lambda } = { ...config.mmr, ...overrides };
  return store.maxMarginalRelevanceSearch(query, { k, fetchK, lambdaMult: lambda }, getEmbeddings());
}

export async function similaritySearch(store, query, k = config.mmr.k) {
  return store.similaritySearch(query, k, getEmbeddings());
}
