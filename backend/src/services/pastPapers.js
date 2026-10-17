import { completeJson } from "./llm.js";
import { getEmbeddings } from "./embeddings.js";
import { cosineSimilarity, ensureCurrentEmbeddings, loadMergedStore } from "./vectorStore.js";
import { readSourceText } from "./sourceText.js";
import { cleanText, firstNumber } from "./studyContext.js";
import { refreshUnitTopics, scheduleTopicRefresh } from "./topics.js";
import { getSource, listSources, listUnits, updateSource } from "../db/store.js";
import { listTopics } from "../db/practice.js";
import { deletePaperQuestions, listPaperQuestions, replacePaperQuestions } from "../db/pastPapers.js";

// Past-paper analysis: the model extracts each question (number, text,
// marks, section, year) from a past exam paper; each question is then mapped
// to the course: embedding similarity against the course material finds
// where the answer is (citations) and the likely unit, and the model confirms
// the topic from a short list of candidates.

export const SOURCE_KINDS = ["material", "past_paper"];
const WINDOW_CHARS = 14_000;
const MAX_QUESTIONS = 200;
const CITATIONS_PER_QUESTION = 3;
const CANDIDATE_TOPICS = 5;
const CONFIRM_BATCH = 15;
const SAME_UNIT_BONUS = 0.1;
const MIN_SIMILARITY = 0.2; // below this a question isn't placed in a unit without a topic

const EXTRACT_PROMPT = [
  "You extract the questions from a past university exam paper.",
  "List every question a student has to answer, in order. When a question has separately numbered or separately marked parts (2(a), 2(b)…), list each part as its own question, repeating the shared stem when the part can't be understood without it.",
  "Skip instructions, cover-page text, headers and footers. Copy each question's text exactly as printed (keep formulas, symbols and units).",
  "number: the question number as printed (e.g. \"3\", \"2(b)\", \"Q4\"). marks: the marks shown for that question as a number, or null. section: the section heading it is under (e.g. \"Section A\"), or null.",
  "year: the year of the exam if the paper shows it, else null.",
].join("\n");

const CONFIRM_PROMPT = [
  "You map exam questions to the topics of a college course.",
  "For each numbered question you get a short list of candidate topics (A, B, C…). Pick the ONE topic the question mainly tests, or null when none of the candidates fits.",
].join("\n");

// ---- Extraction --------------------------------------------------------------------

/** Splits long text at paragraph/line breaks into windows of at most `size` characters. */
export function textWindows(text, size = WINDOW_CHARS) {
  const windows = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n\n", size);
    if (cut < size / 2) cut = rest.lastIndexOf("\n", size);
    if (cut < size / 2) cut = size;
    windows.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) windows.push(rest);
  return windows;
}

const thisYear = () => new Date().getFullYear();
function cleanYear(value) {
  const year = firstNumber(value);
  return Number.isInteger(year) && year >= 1950 && year <= thisYear() + 1 ? year : null;
}
function cleanMarks(value) {
  const marks = firstNumber(value);
  return Number.isFinite(marks) && marks > 0 && marks <= 200 ? Math.round(marks * 2) / 2 : null;
}
const normQuestion = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Validated questions from a paper's text: { year, questions: [{ number, text, marks, section }] }. */
export async function extractQuestions(text) {
  const questions = [];
  const seen = new Set();
  let year = null;
  for (const window of textWindows(text)) {
    const out = await completeJson(
      EXTRACT_PROMPT,
      `Exam paper text:\n"""\n${window}\n"""\n\n` +
        'Return JSON: {"year": number | null, "questions": [{"number": string, "text": string, "marks": number | null, "section": string | null}]}',
      { task: "past_paper_extract" }
    );
    year ??= cleanYear(out?.year);
    const raw = Array.isArray(out?.questions) ? out.questions : Array.isArray(out) ? out : [];
    for (const item of raw) {
      const questionText = cleanText(typeof item === "string" ? item : item?.text ?? item?.question, 3000);
      if (questionText.length < 8) continue;
      const key = normQuestion(questionText);
      if (seen.has(key)) continue;
      seen.add(key);
      questions.push({
        number: cleanText(item?.number, 20) || null,
        text: questionText,
        marks: cleanMarks(item?.marks),
        section: cleanText(item?.section, 80) || null,
      });
      if (questions.length >= MAX_QUESTIONS) return { year, questions };
    }
  }
  return { year, questions };
}

// ---- Mapping to the course --------------------------------------------------------------

const letter = (i) => String.fromCharCode(65 + i);

/** Asks the model to confirm each question's topic among its candidates; returns topic | null per question. */
async function confirmTopics(items) {
  const picks = new Array(items.length).fill(undefined);
  for (let start = 0; start < items.length; start += CONFIRM_BATCH) {
    const batch = items.slice(start, start + CONFIRM_BATCH);
    const listing = batch
      .map(
        (item, i) =>
          `Question ${i + 1}: ${item.text.slice(0, 600)}\n` +
          item.candidates.map((c, j) => `  ${letter(j)}) ${c.topic.name}${c.unitTitle ? ` (${c.unitTitle})` : ""}`).join("\n")
      )
      .join("\n\n");
    try {
      const out = await completeJson(
        CONFIRM_PROMPT,
        `${listing}\n\nReturn JSON: {"answers": [{"question": number, "topic": "A" | "B" | … | null}]}`,
        { task: "past_paper_topics" }
      );
      for (const answer of Array.isArray(out?.answers) ? out.answers : []) {
        const index = firstNumber(answer?.question) - 1;
        const item = batch[index];
        if (!item || picks[start + index] !== undefined) continue;
        const choice = String(answer?.topic ?? "").trim().toUpperCase();
        if (!choice || choice === "NULL" || choice === "NONE") {
          picks[start + index] = null;
          continue;
        }
        const pick = item.candidates[choice.charCodeAt(0) - 65];
        if (choice.length === 1 && pick) picks[start + index] = pick.topic;
      }
    } catch (err) {
      console.warn(`Past-paper topic confirmation failed: ${err.message}`);
    }
  }
  // No (valid) answer from the model → the most similar candidate.
  return picks.map((pick, i) => (pick === undefined ? items[i].candidates[0]?.topic ?? null : pick));
}

/**
 * Places each question in the course: citations (where the answer is),
 * unit and topic. `questions` = [{ text, … }] → same objects with
 * { unitId, topicId, similarity, citations }.
 */
async function mapQuestions(notebookId, questions) {
  const [sources, units] = await Promise.all([listSources(notebookId), listUnits(notebookId)]);
  const unitIds = new Set(units.map((u) => u.id));
  const unitTitle = new Map(units.map((u) => [u.id, u.title]));
  const material = sources.filter((s) => s.status === "ready" && s.kind === "material");
  if (material.length === 0 || questions.length === 0) {
    return questions.map((q) => ({ ...q, unitId: null, topicId: null, similarity: null, citations: [] }));
  }

  const sourceById = new Map(material.map((s) => [s.id, s]));
  const unitOfSource = (id) => {
    const u = sourceById.get(id)?.unitId;
    return u && unitIds.has(u) ? u : null;
  };

  await ensureCurrentEmbeddings(material);
  const store = await loadMergedStore(material.map((s) => s.id));
  // Topics of every unit, extracting any that are missing first.
  await Promise.all([...units.map((u) => u.id), null].map((u) => refreshUnitTopics(notebookId, u).catch(() => {})));
  const topics = await listTopics(notebookId);

  const embeddings = getEmbeddings();
  const [questionVectors, topicVectors] = await Promise.all([
    embeddings.embedDocuments(questions.map((q) => q.text)),
    topics.length ? embeddings.embedDocuments(topics.map((t) => `${t.name}. ${t.description ?? ""}`)) : [],
  ]);

  const placed = questions.map((q, qi) => {
    const vector = questionVectors[qi];
    const ranked = store.records
      .map((r) => ({ r, score: cosineSimilarity(vector, r.embedding) }))
      .sort((a, b) => b.score - a.score);
    const top = ranked.slice(0, CITATIONS_PER_QUESTION);
    // Unit vote over the best few passages, weighted by similarity.
    const votes = new Map();
    for (const { r, score } of ranked.slice(0, 5)) {
      const unit = unitOfSource(r.metadata.sourceId);
      votes.set(unit, (votes.get(unit) ?? 0) + score);
    }
    const votedUnit = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const candidates = topics
      .map((topic, ti) => ({
        topic,
        unitTitle: topic.unitId ? unitTitle.get(topic.unitId) : "General",
        score: cosineSimilarity(vector, topicVectors[ti]) + (topic.unitId === votedUnit ? SAME_UNIT_BONUS : 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, CANDIDATE_TOPICS);
    return {
      ...q,
      votedUnit,
      candidates,
      similarity: top[0] ? Math.round(top[0].score * 1000) / 1000 : null,
      citations: top.map(({ r }, i) => ({
        number: i + 1,
        sourceId: r.metadata.sourceId,
        sourceTitle: sourceById.get(r.metadata.sourceId)?.title ?? r.metadata.source,
        chunk: r.metadata.chunk ?? null,
        start: r.metadata.start ?? null,
        end: r.metadata.end ?? null,
        location: r.metadata.location ?? null,
        text: r.pageContent,
      })),
    };
  });

  const withCandidates = placed.filter((p) => p.candidates.length);
  const confirmed = await confirmTopics(withCandidates);
  const topicOf = new Map(withCandidates.map((p, i) => [p, confirmed[i]]));

  return placed.map((p) => {
    const { votedUnit, candidates, ...q } = p;
    const topic = topicOf.get(p) ?? null;
    const unitId = topic ? topic.unitId : (q.similarity ?? 0) >= MIN_SIMILARITY ? votedUnit : null;
    return { ...q, unitId: unitId ?? null, topicId: topic?.id ?? null };
  });
}

// ---- Jobs --------------------------------------------------------------------------

const running = new Map(); // sourceId → promise

/**
 * Extracts and maps the questions of a past paper (in the background; the
 * source's paper_status goes pending → ready | error). One run per source.
 */
export function analysePaper(sourceId) {
  if (running.has(sourceId)) return running.get(sourceId);
  const job = (async () => {
    const source = await getSource(sourceId);
    if (!source || source.kind !== "past_paper" || source.status !== "ready") return;
    await updateSource(sourceId, { paperStatus: "pending", paperError: null });
    try {
      const { year, questions } = await extractQuestions(await readSourceText(sourceId));
      if (questions.length === 0) throw new Error("No questions were found in this paper.");
      const paperYear = source.examYear ?? year;
      const mapped = await mapQuestions(source.notebookId, questions.map((q) => ({ ...q, year: paperYear })));
      const current = await getSource(sourceId);
      if (!current || current.kind !== "past_paper") return; // deleted or changed meanwhile
      await replacePaperQuestions(source.notebookId, sourceId, mapped);
      await updateSource(sourceId, { paperStatus: "ready", paperError: null, ...(!current.examYear && year ? { examYear: year } : {}) });
    } catch (err) {
      console.warn(`Past-paper analysis failed for ${sourceId}: ${err.message}`);
      await updateSource(sourceId, { paperStatus: "error", paperError: String(err.message).slice(0, 500) });
    }
  })().finally(() => running.delete(sourceId));
  running.set(sourceId, job);
  return job;
}

export const isAnalysing = (sourceId) => running.has(sourceId);

/**
 * Switches a source between course material and past paper. Material
 * changes the unit's topics either way; a new past paper is analysed.
 */
export async function setSourceKind(source, { kind, examName, examYear }) {
  const patch = {};
  if (examName !== undefined) patch.examName = examName;
  if (examYear !== undefined) patch.examYear = examYear;
  const changed = kind !== undefined && kind !== source.kind;
  if (changed) {
    patch.kind = kind;
    patch.paperStatus = kind === "past_paper" ? "pending" : null;
    patch.paperError = null;
  }
  const updated = await updateSource(source.id, patch);
  if (changed) {
    if (kind === "material") await deletePaperQuestions(source.id);
    scheduleTopicRefresh(source.notebookId, source.unitId);
    if (kind === "past_paper" && source.status === "ready") analysePaper(source.id);
  }
  return updated;
}

// ---- Insights ----------------------------------------------------------------------------

function aggregate(questions, keyOf) {
  const groups = new Map();
  for (const q of questions) {
    const key = keyOf(q);
    const g = groups.get(key) ?? { count: 0, totalMarks: 0, years: new Set(), papers: new Set() };
    g.count += 1;
    g.totalMarks += q.marks ?? 0;
    if (q.year) g.years.add(q.year);
    g.papers.add(q.sourceId);
    groups.set(key, g);
  }
  return groups;
}

const rank = (a, b) => b.count - a.count || b.totalMarks - a.totalMarks || b.years.length - a.years.length;

/**
 * Exam insights for a course: past papers with their status, topics and
 * units ranked by how often they're examined (count, total marks, years).
 */
export async function examInsights(notebookId) {
  const [sources, units, topics, questions] = await Promise.all([
    listSources(notebookId),
    listUnits(notebookId),
    listTopics(notebookId),
    listPaperQuestions(notebookId),
  ]);
  const counts = aggregate(questions, (q) => q.sourceId);
  const papers = sources
    .filter((s) => s.kind === "past_paper")
    .map((s) => ({
      id: s.id,
      title: s.title,
      examName: s.examName,
      examYear: s.examYear,
      status: s.status,
      paperStatus: isAnalysing(s.id) ? "pending" : s.paperStatus,
      paperError: s.paperError,
      questionCount: counts.get(s.id)?.count ?? 0,
    }));

  const unitTitle = new Map(units.map((u) => [u.id, u.title]));
  const topicById = new Map(topics.map((t) => [t.id, t]));
  const byTopic = aggregate(questions.filter((q) => q.topicId && topicById.has(q.topicId)), (q) => q.topicId);
  const byUnit = aggregate(questions, (q) => (q.unitId && unitTitle.has(q.unitId) ? q.unitId : null));
  const finish = (g) => ({ count: g.count, totalMarks: g.totalMarks, years: [...g.years].sort((a, b) => b - a), paperCount: g.papers.size });

  return {
    papers,
    totalQuestions: questions.length,
    unmapped: questions.filter((q) => !q.topicId).length,
    years: [...new Set(questions.map((q) => q.year).filter(Boolean))].sort((a, b) => b - a),
    topics: [...byTopic.entries()]
      .map(([topicId, g]) => {
        const t = topicById.get(topicId);
        return { topicId, name: t.name, unitId: t.unitId, unitTitle: t.unitId ? unitTitle.get(t.unitId) ?? "General" : "General", ...finish(g) };
      })
      .sort(rank),
    units: [...byUnit.entries()].map(([unitId, g]) => ({ unitId, title: unitId ? unitTitle.get(unitId) : "General / unplaced", ...finish(g) })).sort(rank),
  };
}

/** How often each topic is examined: Map topicId → { count, totalMarks, years }. For revision plans. */
export async function topicExamWeight(notebookId) {
  const questions = await listPaperQuestions(notebookId);
  const groups = aggregate(questions.filter((q) => q.topicId), (q) => q.topicId);
  return new Map([...groups.entries()].map(([id, g]) => [id, { count: g.count, totalMarks: g.totalMarks, years: g.years.size }]));
}
