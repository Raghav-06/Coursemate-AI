import { config } from "../config/index.js";
import { ensureCurrentEmbeddings, loadMergedStore, mmrSearch } from "./vectorStore.js";
import { streamCompletion } from "./llm.js";

const SYSTEM_PROMPT = [
  "You are Ask AI, a research and study assistant. Help the user understand their sources.",
  "",
  "Ground every answer ONLY in the numbered source passages provided with the question.",
  "After each sentence or bullet that uses a passage, cite it with its number in square brackets, e.g. [2]. Cite several like [1][4]. Never cite a number that was not provided, and do not add a separate references list.",
  "If the passages do not contain the answer, say that the sources don't cover it, and briefly mention what they do cover.",
  "Format answers in Markdown: short paragraphs, **bold** for key terms, bullet lists where helpful.",
].join("\n");

// Short follow-ups ("why?", "give an example") retrieve poorly on their own,
// so fold in the previous user question.
function retrievalQuery(question, history) {
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  if (lastUser && question.split(/\s+/).length < 8) return `${lastUser.content}\n${question}`;
  return question;
}

/**
 * Retrieves passages from the selected sources and starts streaming a cited
 * answer. Returns the citations up front so the client can render chips as
 * soon as their numbers appear in the text.
 */
export async function answerQuestion({ sources, question, history = [] }) {
  const titles = new Map(sources.map((s) => [s.id, s.title]));
  await ensureCurrentEmbeddings(sources);
  const store = await loadMergedStore(sources.map((s) => s.id));
  const passages = await mmrSearch(store, retrievalQuery(question, history));

  const citations = passages.map((doc, i) => ({
    number: i + 1,
    sourceId: doc.metadata.sourceId,
    sourceTitle: titles.get(doc.metadata.sourceId) ?? doc.metadata.source,
    chunk: doc.metadata.chunk,
    start: doc.metadata.start ?? null,
    end: doc.metadata.end ?? null,
    text: doc.pageContent,
  }));

  const context = citations.map((c) => `[${c.number}] (from "${c.sourceTitle}")\n${c.text}`).join("\n\n");

  const priorTurns = history
    .slice(-config.limits.chatHistoryMessages)
    .map((m) => [m.role === "user" ? "human" : "ai", m.content]);

  const messages = [
    ["system", SYSTEM_PROMPT],
    ...priorTurns,
    ["human", `Source passages:\n\n${context || "(no passages found)"}\n\nQuestion: ${question}`],
  ];

  return { citations, stream: streamCompletion(messages) };
}

// Non-streaming convenience for the CLI script.
export async function answerQuestionText(args) {
  const { citations, stream } = await answerQuestion(args);
  let content = "";
  for await (const delta of stream) content += delta;
  return { content, citations };
}
