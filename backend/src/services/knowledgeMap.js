import crypto from "node:crypto";
import { completeJson } from "./llm.js";
import { getEmbeddings } from "./embeddings.js";
import { cosineSimilarity } from "./vectorStore.js";
import { readSourceText } from "./sourceText.js";
import { cleanText, firstNumber, formatPassages, retrievePassages, samplePassages, asCitations } from "./studyContext.js";
import { masteryOf, matchTopic, refreshUnitTopics } from "./topics.js";
import { courseProfile } from "../config/examProfiles.js";
import { getNotebook, listSources, listUnits } from "../db/store.js";
import { listTopics } from "../db/practice.js";
import { listPaperQuestions } from "../db/pastPapers.js";
import {
  getMapStatus,
  listEdges,
  listNodes,
  nodeEvents,
  replaceMap,
  setMapStatus,
  setNodeWeights,
  setPaperQuestionNodes,
} from "../db/knowledgeMap.js";

// The knowledge map: subject → chapter/unit → topic → subtopic with
// prerequisite links and an exam weight per node.
//   build (Ultra): from the syllabus (primary), notes and past-paper questions;
//   tagging (Nano): each past-paper question is placed on a topic/subtopic,
//     choosing among the nodes closest to it by embedding similarity;
//   weights (code): past-paper frequency and marks per node; without tagged
//     questions, the model's high/medium/low hint.
// Mastery per node is each student's recency-weighted score over their
// evidence on the node and on the course topic it is linked to.

const SYLLABUS_CHARS = 20_000;
const NOTE_PASSAGES = 16;
const PAPER_QUESTIONS = 60;
const LIMITS = { subjects: 8, chapters: 30, topics: 20, subtopics: 10, total: 500 };
const CANDIDATES = 5;
const TAG_BATCH = 15;
const REFRESH_DELAY_MS = 5000;
const HINT_WEIGHT = { high: 1, medium: 0.6, low: 0.3 };

const MAP_PROMPT = [
  "You are an expert exam coach for Indian competitive and university exams. Build the knowledge map of a course: the hierarchy subject → chapter (unit) → topic → subtopic that a student must master for the exam.",
  "The SYLLABUS is the primary source: follow its structure, wording and numbering (put its numbering, like \"Unit 3\" or \"3.2\", in syllabusRef). Use the notes and past-paper questions to fill gaps and to judge importance. Do not invent topics that none of them mention.",
  "Topic and chapter names are specific (2-7 words) and keep the original technical terms. Subtopics are short phrases. No duplicates.",
  "For every topic, give weight: \"high\", \"medium\" or \"low\" — how important it is for the exam (past papers first, then syllabus emphasis).",
  "List prerequisite links between topics: {\"topic\": X, \"requires\": Y} when Y must be understood before X (e.g. vectors before projectile motion). Only real conceptual dependencies; never circular.",
].join("\n");

const TAG_PROMPT = [
  "You place exam questions on a course's knowledge map.",
  "For each numbered question you get candidate nodes (A, B, C…). Pick the ONE node the question mainly tests, or null when none fits.",
].join("\n");

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const letter = (i) => String.fromCharCode(65 + i);

// ---- Sources and signature ------------------------------------------------------------

const mapSources = (sources) => sources.filter((s) => s.status === "ready" && ["material", "syllabus", "past_paper"].includes(s.kind));

export function mapSignature(sources, notebook) {
  const parts = mapSources(sources).map((s) => `${s.id}:${s.kind}:${s.chunkCount ?? 0}:${s.charCount ?? 0}`).sort();
  parts.push(`exam:${notebook?.examType ?? ""}:${JSON.stringify(notebook?.examSettings?.subjects ?? [])}`);
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex");
}

// ---- Building ------------------------------------------------------------------------

async function buildPrompt(notebook, sources, topics, units) {
  const profile = courseProfile(notebook.examType, notebook.examSettings);
  const syllabus = sources.filter((s) => s.kind === "syllabus");
  const notes = sources.filter((s) => s.kind === "material");

  let syllabusText = "";
  for (const s of syllabus) {
    if (syllabusText.length >= SYLLABUS_CHARS) break;
    syllabusText += `=== ${s.title} ===\n${((await readSourceText(s.id)) ?? "").slice(0, SYLLABUS_CHARS - syllabusText.length)}\n\n`;
  }
  const passages = notes.length ? await samplePassages(notes, { max: NOTE_PASSAGES }) : [];
  const questions = (await listPaperQuestions(notebook.id)).slice(0, PAPER_QUESTIONS);
  const unitTitle = new Map(units.map((u) => [u.id, u.title]));
  const topicList = topics.map((t) => `- ${t.name} (${t.unitId ? unitTitle.get(t.unitId) ?? "General" : "General"})`).join("\n");

  return (
    (profile ? `Exam: ${profile.name}. Subjects: ${profile.subjects.join(", ") || "as in the syllabus"} — use these subject names, only those the material covers.\n\n` : "") +
    (syllabusText ? `SYLLABUS:\n"""\n${syllabusText.trim()}\n"""\n\n` : "No syllabus was uploaded: derive the structure from the notes and past papers.\n\n") +
    (units.length ? `Course units (chapters): ${units.map((u) => u.title).join("; ")}\n\n` : "") +
    (topicList ? `Topics found in the notes:\n${topicList}\n\n` : "") +
    (passages.length ? `Notes (sample passages):\n\n${formatPassages(passages.map((p) => ({ ...p, text: p.text.slice(0, 500) })))}\n\n` : "") +
    (questions.length ? `Past-paper questions:\n${questions.map((q, i) => `${i + 1}. ${q.text.slice(0, 220)}${q.marks ? ` (${q.marks} marks)` : ""}`).join("\n")}\n\n` : "") +
    'Return JSON: {"subjects": [{"name": string, "chapters": [{"name": string, "syllabusRef": string | null, "topics": [{"name": string, "description": string, "syllabusRef": string | null, "weight": "high" | "medium" | "low", "subtopics": [string]}]}]}], "prerequisites": [{"topic": string, "requires": string}]}'
  );
}

/**
 * Validates the model's map into flat nodes (parents first) and prerequisite
 * edges between topic/subtopic/chapter nodes, without cycles. Pure.
 */
export function parseMap(out, { subjects: allowedSubjects = [] } = {}) {
  const nodes = [];
  let total = 0;
  const add = (node) => {
    if (total >= LIMITS.total) return null;
    total += 1;
    const key = `n${nodes.length}`;
    nodes.push({ key, ...node });
    return key;
  };
  const named = (v, max = 120) => cleanText(typeof v === "string" ? v : v?.name, max).replace(/^["'\s-]+|["']$/g, "");
  const list = (v) => (Array.isArray(v) ? v : []);
  const seenSubjects = new Set();

  for (const rawSubject of list(out?.subjects).slice(0, LIMITS.subjects * 2)) {
    let name = named(rawSubject, 80);
    if (!name) continue;
    // Prefer the profile's spelling of a subject.
    const official = allowedSubjects.find((s) => norm(s) === norm(name) || norm(name).includes(norm(s)));
    if (official) name = official;
    if (seenSubjects.has(norm(name)) || seenSubjects.size >= LIMITS.subjects) continue;
    seenSubjects.add(norm(name));
    const subjectKey = add({ parentKey: null, level: "subject", name });
    if (!subjectKey) break;
    const seenChapters = new Set();
    for (const rawChapter of list(rawSubject?.chapters)) {
      const chapter = named(rawChapter);
      if (!chapter || seenChapters.has(norm(chapter)) || seenChapters.size >= LIMITS.chapters) continue;
      seenChapters.add(norm(chapter));
      const chapterKey = add({ parentKey: subjectKey, level: "chapter", name: chapter, syllabusRef: cleanText(rawChapter?.syllabusRef, 40) || null });
      if (!chapterKey) break;
      const seenTopics = new Set();
      for (const rawTopic of list(rawChapter?.topics)) {
        const topic = named(rawTopic);
        if (!topic || seenTopics.has(norm(topic)) || seenTopics.size >= LIMITS.topics) continue;
        seenTopics.add(norm(topic));
        const hint = String(rawTopic?.weight ?? "").toLowerCase();
        const topicKey = add({
          parentKey: chapterKey,
          level: "topic",
          name: topic,
          description: cleanText(rawTopic?.description, 300) || null,
          syllabusRef: cleanText(rawTopic?.syllabusRef, 40) || null,
          weightHint: HINT_WEIGHT[hint] ? hint : null,
        });
        if (!topicKey) break;
        const seenSub = new Set();
        for (const rawSub of list(rawTopic?.subtopics)) {
          const sub = named(rawSub);
          if (!sub || norm(sub) === norm(topic) || seenSub.has(norm(sub)) || seenSub.size >= LIMITS.subtopics) continue;
          seenSub.add(norm(sub));
          if (!add({ parentKey: topicKey, level: "subtopic", name: sub })) break;
        }
      }
    }
  }
  if (!nodes.some((n) => n.level === "topic")) throw Object.assign(new Error("The model returned no usable knowledge map."), { status: 502 });

  // Prerequisites: names → nodes (topics first), skipping self links and cycles.
  const linkable = [...nodes.filter((n) => n.level === "topic"), ...nodes.filter((n) => n.level === "subtopic" || n.level === "chapter")];
  const out_ = new Map(); // key → Set of keys it leads to
  const reaches = (from, to) => {
    const stack = [from];
    const seen = new Set();
    while (stack.length) {
      const k = stack.pop();
      if (k === to) return true;
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push(...(out_.get(k) ?? []));
    }
    return false;
  };
  const edges = [];
  for (const p of list(out?.prerequisites).slice(0, 300)) {
    const target = matchTopic(linkable, cleanText(p?.topic, 120));
    const required = matchTopic(linkable, cleanText(p?.requires ?? p?.prerequisite, 120));
    if (!target || !required || target.key === required.key) continue;
    if (reaches(target.key, required.key)) continue; // would close a cycle
    if (out_.get(required.key)?.has(target.key)) continue;
    if (!out_.has(required.key)) out_.set(required.key, new Set());
    out_.get(required.key).add(target.key);
    edges.push({ fromKey: required.key, toKey: target.key });
  }
  return { nodes, edges };
}

/** Links chapters to course units and topics/subtopics to course topics (by name). */
function linkToCourse(nodes, units, topics) {
  const unitItems = units.map((u) => ({ id: u.id, name: u.title }));
  const chapterUnit = new Map();
  for (const n of nodes) {
    if (n.level === "chapter") {
      const unit = matchTopic(unitItems, n.name);
      n.unitId = unit?.id ?? null;
      chapterUnit.set(n.key, n.unitId);
    }
  }
  const parentOf = new Map(nodes.map((n) => [n.key, n.parentKey]));
  for (const n of nodes) {
    if (n.level !== "topic" && n.level !== "subtopic") continue;
    const chapterKey = n.level === "topic" ? n.parentKey : parentOf.get(n.parentKey);
    const unitId = chapterUnit.get(chapterKey) ?? undefined;
    const topic = matchTopic(topics, n.name, unitId);
    n.topicId = topic?.id ?? null;
    n.unitId = topic?.unitId ?? unitId ?? null;
  }
  // One node per course topic: the first (highest-level) match keeps the link.
  const claimed = new Set();
  for (const n of nodes) {
    if (!n.topicId) continue;
    if (claimed.has(n.topicId)) n.topicId = null;
    else claimed.add(n.topicId);
  }
}

// ---- Past-paper questions → nodes (Nano, embeddings assist) ---------------------------------

const nodeText = (n, byId) => `${n.name}. ${n.description ?? ""} (${byId.get(n.parentId)?.name ?? ""})`;

/**
 * Places a course's past-paper questions (all, or one paper's) on topic /
 * subtopic nodes: the CANDIDATES most similar nodes, then Nano picks one.
 */
export async function tagPaperQuestions(notebookId, { sourceId } = {}) {
  const [nodes, questions] = await Promise.all([listNodes(notebookId), listPaperQuestions(notebookId, sourceId ? { sourceId } : {})]);
  const targets = nodes.filter((n) => n.level === "topic" || n.level === "subtopic");
  if (!targets.length || !questions.length) return 0;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const embeddings = getEmbeddings();
  const [nodeVectors, questionVectors] = await Promise.all([
    embeddings.embedDocuments(targets.map((n) => nodeText(n, byId))),
    embeddings.embedDocuments(questions.map((q) => q.text.slice(0, 1500))),
  ]);
  const items = questions.map((q, qi) => ({
    question: q,
    candidates: targets
      .map((n, ni) => ({ node: n, score: cosineSimilarity(questionVectors[qi], nodeVectors[ni]) + (q.topicId && n.topicId === q.topicId ? 0.15 : 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, CANDIDATES),
  }));

  const picks = new Array(items.length).fill(undefined);
  for (let start = 0; start < items.length; start += TAG_BATCH) {
    const batch = items.slice(start, start + TAG_BATCH);
    const listing = batch
      .map((item, i) => `Question ${i + 1}: ${item.question.text.slice(0, 500)}\n` + item.candidates.map((c, j) => `  ${letter(j)}) ${c.node.name} (${byId.get(c.node.parentId)?.name ?? ""})`).join("\n"))
      .join("\n\n");
    try {
      const out = await completeJson(TAG_PROMPT, `${listing}\n\nReturn JSON: {"answers": [{"question": number, "node": "A" | "B" | … | null}]}`, {
        task: "tag_topics",
        notebookId,
      });
      for (const answer of Array.isArray(out?.answers) ? out.answers : []) {
        const index = firstNumber(answer?.question) - 1;
        const item = batch[index];
        if (!item || picks[start + index] !== undefined) continue;
        const choice = String(answer?.node ?? answer?.topic ?? "").trim().toUpperCase();
        if (!choice || choice === "NULL" || choice === "NONE") picks[start + index] = null;
        else if (choice.length === 1 && item.candidates[choice.charCodeAt(0) - 65]) picks[start + index] = item.candidates[choice.charCodeAt(0) - 65].node.id;
      }
    } catch (err) {
      console.warn(`Tagging past-paper questions failed: ${err.message}`);
    }
  }
  // No valid answer → the most similar node.
  const updates = items.map((item, i) => ({ id: item.question.id, nodeId: picks[i] === undefined ? item.candidates[0]?.node.id ?? null : picks[i] }));
  await setPaperQuestionNodes(updates);
  await computeWeights(notebookId);
  return updates.filter((u) => u.nodeId).length;
}

/**
 * Exam weight per node (0-1): past-paper count and marks over its subtree,
 * relative to the busiest node of the same level; without tagged questions,
 * the model's hint (chapters/subjects take their highest topic's).
 */
export async function computeWeights(notebookId, hints = new Map()) {
  const [nodes, questions] = await Promise.all([listNodes(notebookId), listPaperQuestions(notebookId)]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const tally = new Map(nodes.map((n) => [n.id, { count: 0, marks: 0 }]));
  let tagged = 0;
  for (const q of questions) {
    if (!q.nodeId || !byId.has(q.nodeId)) continue;
    tagged += 1;
    for (let n = byId.get(q.nodeId); n; n = byId.get(n.parentId)) {
      const t = tally.get(n.id);
      t.count += 1;
      t.marks += q.marks ?? 1;
    }
  }
  const updates = [];
  if (tagged) {
    for (const level of ["subject", "chapter", "topic", "subtopic"]) {
      const same = nodes.filter((n) => n.level === level);
      const maxCount = Math.max(1, ...same.map((n) => tally.get(n.id).count));
      const maxMarks = Math.max(1, ...same.map((n) => tally.get(n.id).marks));
      for (const n of same) {
        const t = tally.get(n.id);
        updates.push({ id: n.id, weight: Math.round((0.5 * (t.count / maxCount) + 0.5 * (t.marks / maxMarks)) * 100) / 100, source: "past_papers" });
      }
    }
  } else {
    const weight = new Map();
    for (const n of nodes) if (n.level === "topic") weight.set(n.id, hints.get(n.id) ?? (n.weightSource === "model" ? n.weight : null));
    for (const n of nodes) if (n.level === "subtopic") weight.set(n.id, weight.get(n.parentId) ?? null);
    for (const level of ["chapter", "subject"]) {
      for (const n of nodes.filter((x) => x.level === level)) {
        const kids = nodes.filter((c) => c.parentId === n.id).map((c) => weight.get(c.id)).filter((w) => w !== null && w !== undefined);
        weight.set(n.id, kids.length ? Math.max(...kids) : null);
      }
    }
    for (const n of nodes) updates.push({ id: n.id, weight: weight.get(n.id) ?? null, source: weight.get(n.id) === null || weight.get(n.id) === undefined ? null : "model" });
  }
  await setNodeWeights(updates);
}

const running = new Map();
const timers = new Map();

/** (Re)builds a course's map now (one run per course). */
export function buildMap(notebookId, { force = false } = {}) {
  if (running.has(notebookId)) return running.get(notebookId);
  const job = (async () => {
    const [notebook, sources, units, status] = await Promise.all([getNotebook(notebookId), listSources(notebookId), listUnits(notebookId), getMapStatus(notebookId)]);
    if (!notebook) return;
    const signature = mapSignature(sources, notebook);
    if (!force && status?.status === "ready" && status.signature === signature) return;
    const usable = mapSources(sources);
    if (!usable.length) {
      await setMapStatus(notebookId, { status: "error", signature, error: "Add a syllabus, notes or past papers first." });
      return;
    }
    await setMapStatus(notebookId, { status: "pending" });
    try {
      // Course topics (per unit) first, so map nodes can link to them.
      await Promise.all([...units.map((u) => u.id), null].map((u) => refreshUnitTopics(notebookId, u).catch(() => {})));
      const topics = await listTopics(notebookId);
      const profile = courseProfile(notebook.examType, notebook.examSettings);
      const out = await completeJson(MAP_PROMPT, await buildPrompt(notebook, usable, topics, units), { task: "build_knowledge_map", notebookId });
      const { nodes, edges } = parseMap(out, { subjects: profile?.subjects ?? [] });
      linkToCourse(nodes, units, topics);
      const ids = await replaceMap(notebookId, nodes, edges);
      const hints = new Map(nodes.filter((n) => n.weightHint).map((n) => [ids.get(n.key), HINT_WEIGHT[n.weightHint]]));
      await computeWeights(notebookId, hints);
      await setMapStatus(notebookId, { status: "ready", signature, built: true });
      // Placing past-paper questions refines the weights; the map is usable meanwhile.
      await tagPaperQuestions(notebookId).catch((err) => console.warn(`Tagging failed for ${notebookId}: ${err.message}`));
    } catch (err) {
      console.warn(`Knowledge map failed for ${notebookId}: ${err.message}`);
      await setMapStatus(notebookId, { status: "error", signature, error: String(err.message).slice(0, 500) });
    }
  })().finally(() => running.delete(notebookId));
  running.set(notebookId, job);
  return job;
}

/** Debounced rebuild when a course's sources change (only once it has a map or a syllabus). */
export function scheduleMapRefresh(notebookId) {
  clearTimeout(timers.get(notebookId));
  timers.set(
    notebookId,
    setTimeout(async () => {
      timers.delete(notebookId);
      try {
        const [status, sources] = await Promise.all([getMapStatus(notebookId), listSources(notebookId)]);
        if (status || sources.some((s) => s.kind === "syllabus" && s.status === "ready")) await buildMap(notebookId);
      } catch (err) {
        console.warn(`Map refresh failed for ${notebookId}: ${err.message}`);
      }
    }, REFRESH_DELAY_MS)
  );
}

export const isBuilding = (notebookId) => running.has(notebookId) || timers.has(notebookId);

// ---- Mastery -----------------------------------------------------------------------

export const MASTERY_LEVELS = { weak: 0.5, strong: 0.75 };

export function masteryStatus(score, attempts) {
  if (!attempts || score === null) return "not_started";
  return score < MASTERY_LEVELS.weak ? "weak" : score < MASTERY_LEVELS.strong ? "ok" : "strong";
}

/**
 * Mastery per node: own evidence (attempts, accuracy, recency-weighted score,
 * last practised); parents also average their practised children (by attempts).
 */
export function nodeMastery(nodes, events) {
  const byNode = new Map();
  for (const e of events) {
    if (!byNode.has(e.nodeId)) byNode.set(e.nodeId, []);
    byNode.get(e.nodeId).push(e);
  }
  const result = new Map();
  const children = new Map();
  for (const n of nodes) {
    if (!children.has(n.parentId)) children.set(n.parentId, []);
    children.get(n.parentId).push(n);
  }
  const visit = (n) => {
    const own = byNode.get(n.id) ?? [];
    let attempts = own.length;
    let correct = own.reduce((s, e) => s + e.score, 0);
    let last = own[0]?.createdAt ?? null;
    let num = 0;
    let den = 0;
    const ownScore = masteryOf(own);
    if (ownScore !== null) {
      num += ownScore * own.length;
      den += own.length;
    }
    for (const c of children.get(n.id) ?? []) {
      const m = visit(c);
      if (!m.attempts) continue;
      attempts += m.attempts;
      correct += m.accuracy * m.attempts;
      num += m.score * m.attempts;
      den += m.attempts;
      if (!last || (m.lastPractisedAt && m.lastPractisedAt > last)) last = m.lastPractisedAt;
    }
    const score = den ? num / den : null;
    const m = {
      attempts,
      accuracy: attempts ? Math.round((correct / attempts) * 100) / 100 : null,
      score: score === null ? null : Math.round(score * 100) / 100,
      lastPractisedAt: last,
    };
    m.status = masteryStatus(m.score, m.attempts);
    result.set(n.id, m);
    return m;
  };
  for (const root of children.get(null) ?? []) visit(root);
  return result;
}

// ---- Reading -----------------------------------------------------------------------

/**
 * The map for a user: status, nodes with mastery and past-paper counts, and
 * prerequisite edges. A map whose sources changed is rebuilt in the background.
 */
export async function courseMap(notebookId, userId) {
  const [notebook, sources, status, nodes, edges, events, questions] = await Promise.all([
    getNotebook(notebookId),
    listSources(notebookId),
    getMapStatus(notebookId),
    listNodes(notebookId),
    listEdges(notebookId),
    nodeEvents(notebookId, userId),
    listPaperQuestions(notebookId),
  ]);
  let state = status?.status ?? "none";
  if (running.has(notebookId) || timers.has(notebookId)) state = "pending";
  else if (status && status.status !== "pending" && status.signature !== mapSignature(sources, notebook)) {
    scheduleMapRefresh(notebookId);
    state = "pending";
  } else if (status?.status === "pending") {
    // A build interrupted by a restart: start again.
    buildMap(notebookId, { force: true });
    state = "pending";
  }
  const mastery = nodeMastery(nodes, events);
  const paperCount = new Map();
  for (const q of questions) if (q.nodeId) paperCount.set(q.nodeId, (paperCount.get(q.nodeId) ?? 0) + 1);
  return {
    status: state,
    error: state === "error" ? status?.error ?? null : null,
    builtAt: status?.builtAt ?? null,
    hasSyllabus: sources.some((s) => s.kind === "syllabus"),
    sourceCount: mapSources(sources).length,
    nodes: nodes.map((n) => ({ ...n, mastery: mastery.get(n.id) ?? { attempts: 0, accuracy: null, score: null, lastPractisedAt: null, status: "not_started" }, paperQuestions: paperCount.get(n.id) ?? 0 })),
    edges,
  };
}

/** Ids of a node and everything under it. */
export function subtreeIds(nodes, id) {
  const ids = [id];
  for (let i = 0; i < ids.length; i++) for (const n of nodes) if (n.parentId === ids[i]) ids.push(n.id);
  return ids;
}

/**
 * One node for the detail panel: where the sources cover it (cited
 * passages), past-paper questions on it, mastery and its history,
 * prerequisites and what builds on it.
 */
export async function nodeDetail(notebookId, userId, node) {
  const [nodes, edges, sources, questions] = await Promise.all([listNodes(notebookId), listEdges(notebookId), listSources(notebookId), listPaperQuestions(notebookId)]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = subtreeIds(nodes, node.id);
  const idSet = new Set(ids);
  const [events, allEvents] = await Promise.all([nodeEvents(notebookId, userId, { nodeIds: ids }), nodeEvents(notebookId, userId)]);
  const mastery = nodeMastery(nodes, allEvents).get(node.id);

  const material = sources.filter((s) => s.status === "ready" && (s.kind === "material" || s.kind === "syllabus"));
  let citations = [];
  if (material.length) {
    const path = [];
    for (let n = node; n; n = byId.get(n.parentId)) path.unshift(n.name);
    citations = asCitations(await retrievePassages(material, `${path.join(" › ")}. ${node.description ?? ""}`, { k: 5, fetchK: 30 }));
  }
  const ancestors = [];
  for (let n = byId.get(node.parentId); n; n = byId.get(n.parentId)) ancestors.unshift({ id: n.id, name: n.name, level: n.level });
  const pick = (id) => byId.get(id) && { id, name: byId.get(id).name, level: byId.get(id).level };
  return {
    ...node,
    ancestors,
    mastery,
    history: events
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 50)
      .map((e) => ({ score: e.score, kind: e.kind, createdAt: e.createdAt })),
    prerequisites: edges.filter((e) => e.to === node.id).map((e) => pick(e.from)).filter(Boolean),
    dependants: edges.filter((e) => e.from === node.id).map((e) => pick(e.to)).filter(Boolean),
    pastPaperQuestions: questions.filter((q) => q.nodeId && idSet.has(q.nodeId)).slice(0, 30),
    citations,
  };
}
