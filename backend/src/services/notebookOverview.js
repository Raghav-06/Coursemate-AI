import { completeJson } from "./llm.js";
import { buildSourcesContext } from "./sourceText.js";
import { getNotebook, listSources, updateNotebook } from "../db/store.js";

const OVERVIEW_CONTEXT_CHARS = 30_000;

// Debounce per notebook: several sources finishing together trigger one run.
const pending = new Map();

async function generateOverview(notebookId) {
  const notebook = await getNotebook(notebookId);
  if (!notebook) return;

  const sources = (await listSources(notebookId)).filter((s) => s.status === "ready");
  if (sources.length === 0) {
    await updateNotebook(notebookId, { summary: null, suggestedQuestions: [] });
    return;
  }

  // Prefer the compact source guides; fall back to raw text for sources
  // whose guide could not be generated.
  const withGuides = sources.filter((s) => s.guide?.summary);
  const context =
    withGuides.length === sources.length
      ? sources.map((s) => `=== SOURCE: ${s.title} ===\n${s.guide.summary}\nKey topics: ${s.guide.topics.join(", ")}`).join("\n\n")
      : await buildSourcesContext(sources, OVERVIEW_CONTEXT_CHARS);

  const overview = await completeJson(
    "You organize research notebooks. Given the sources in a notebook, produce: a short, specific notebook title (max 8 words, no quotes); one emoji that fits the subject; a 3-5 sentence summary that synthesizes ALL sources together, with key terms in **bold** markdown; and exactly 3 insightful questions a student could ask about these sources (each under 20 words).",
    `${context}\n\nReturn JSON: {"title": string, "emoji": string, "summary": string, "questions": string[]}`
  );

  const patch = {
    summary: String(overview.summary ?? "").trim() || null,
    suggestedQuestions: Array.isArray(overview.questions) ? overview.questions.map(String).slice(0, 3) : [],
  };
  // Only rename notebooks the user hasn't named themselves.
  if (notebook.titleIsAuto && overview.title) {
    patch.title = String(overview.title).replace(/^["']|["']$/g, "").trim();
    patch.emoji = String(overview.emoji || notebook.emoji).trim().slice(0, 4);
  }
  await updateNotebook(notebookId, patch);
}

// Fire-and-forget: the overview lands in the notebook record when done.
export function refreshNotebookOverview(notebookId) {
  clearTimeout(pending.get(notebookId));
  pending.set(
    notebookId,
    setTimeout(() => {
      pending.delete(notebookId);
      generateOverview(notebookId).catch((err) => {
        console.warn(`Notebook overview failed for ${notebookId}: ${err.message}`);
      });
    }, 1500)
  );
}
