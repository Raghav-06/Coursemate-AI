import { getSourceContent, setSourceContent } from "../db/store.js";

// A source's full extracted text lives in sources.content.
export async function saveSourceText(sourceId, text) {
  await setSourceContent(sourceId, text);
}

export async function readSourceText(sourceId) {
  return getSourceContent(sourceId);
}

// Deleted together with the source row.
export async function deleteSourceText() {}

/**
 * Concatenates the selected sources for whole-notebook generation tasks,
 * giving each source an equal share of the character budget (short sources
 * hand their unused share to the rest).
 */
export async function buildSourcesContext(sources, budget) {
  const texts = await Promise.all(sources.map((s) => readSourceText(s.id)));
  const order = texts.map((t, i) => i).sort((a, b) => texts[a].length - texts[b].length);

  const allowance = new Array(texts.length);
  let remaining = budget;
  order.forEach((index, position) => {
    const share = Math.floor(remaining / (order.length - position));
    allowance[index] = Math.min(texts[index].length, share);
    remaining -= allowance[index];
  });

  return sources
    .map((source, i) => {
      const text = texts[i];
      const truncated = text.length > allowance[i];
      return `=== SOURCE: ${source.title} ===\n${text.slice(0, allowance[i])}${truncated ? "\n[…source truncated…]" : ""}`;
    })
    .join("\n\n");
}
