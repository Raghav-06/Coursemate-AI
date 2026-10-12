import crypto from "node:crypto";
import { completeJson } from "./llm.js";
import { cleanText, formatPassages, samplePassages } from "./studyContext.js";
import { listSources, listUnits } from "../db/store.js";
import {
  deleteUnitTopics,
  listTopicSets,
  listTopics,
  recentTopicEvents,
  replaceUnitTopics,
  setTopicSetStatus,
  unitKey,
} from "../db/practice.js";

// Each unit's topics (5-15) are extracted by the model from that unit's
// sources and refreshed when those sources change. A unit's "signature"
// fingerprints its ready sources; a different signature means stale topics.

const MIN_TOPICS = 5;
const MAX_TOPICS = 15;
const REFRESH_DELAY_MS = 2000;

const TOPIC_PROMPT = [
  "You organise college course material into the topics a student revises for an exam.",
  "From the numbered source passages of ONE unit, list between 5 and 15 distinct topics that together cover the unit.",
  "Each topic name is 2-6 words, specific to this material (e.g. \"Carnot cycle efficiency\", not \"Introduction\"); add a one-sentence description of what it covers.",
  "Keep the original technical terms. No duplicates or near-duplicates.",
].join("\n");

/** Sources of a unit as the topic extractor sees them (ready course material only). */
export function unitSources(sources, unitId, unitIds) {
  return sources.filter(
    (s) =>
      s.status === "ready" &&
      (s.kind ?? "material") === "material" &&
      (unitId ? s.unitId === unitId : !s.unitId || !unitIds.has(s.unitId))
  );
}

export function signatureOf(sources) {
  if (sources.length === 0) return "empty";
  const parts = sources.map((s) => `${s.id}:${s.chunkCount ?? 0}:${s.charCount ?? 0}`).sort();
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex");
}

async function extractTopics(unitTitle, sources) {
  const passages = await samplePassages(sources, { max: 30 });
  if (passages.length === 0) return [];
  const out = await completeJson(
    TOPIC_PROMPT,
    `Unit: ${unitTitle}\n\nSource passages:\n\n${formatPassages(passages)}\n\nReturn JSON: {"topics": [{"name": string, "description": string}]}`
  );
  const raw = Array.isArray(out?.topics) ? out.topics : Array.isArray(out) ? out : [];
  const seen = new Set();
  const topics = [];
  for (const item of raw) {
    const name = cleanText(typeof item === "string" ? item : item?.name, 80).replace(/^["'\d.\s-]+|["']$/g, "");
    const key = name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    topics.push({ name, description: cleanText(item?.description, 300) || null });
    if (topics.length >= MAX_TOPICS) break;
  }
  if (topics.length === 0) throw new Error("The model returned no topics.");
  if (topics.length < MIN_TOPICS) console.warn(`Only ${topics.length} topics extracted for "${unitTitle}".`);
  return topics;
}

const running = new Map(); // `${notebookId}:${key}` → promise
const timers = new Map();

/** Re-extracts one unit's topics now if its sources changed (or `force`). */
export async function refreshUnitTopics(notebookId, unitId, { force = false } = {}) {
  const key = unitKey(unitId);
  const id = `${notebookId}:${key}`;
  if (running.has(id)) return running.get(id);
  const job = (async () => {
    const [sources, units, sets] = await Promise.all([listSources(notebookId), listUnits(notebookId), listTopicSets(notebookId)]);
    const unitIds = new Set(units.map((u) => u.id));
    if (unitId && !unitIds.has(unitId)) return; // unit deleted meanwhile
    const mine = unitSources(sources, unitId, unitIds);
    const signature = signatureOf(mine);
    const current = sets.find((s) => s.unitKey === key);
    if (!force && current?.status === "ready" && current.signature === signature) return;

    if (mine.length === 0) {
      await deleteUnitTopics(notebookId, unitId);
      return;
    }
    await setTopicSetStatus(notebookId, key, { status: "pending" });
    try {
      const title = unitId ? units.find((u) => u.id === unitId).title : "General";
      await replaceUnitTopics(notebookId, unitId, await extractTopics(title, mine));
      await setTopicSetStatus(notebookId, key, { status: "ready", signature });
    } catch (err) {
      console.warn(`Topic extraction failed for ${id}: ${err.message}`);
      // The signature is recorded so the same sources aren't retried on every read.
      await setTopicSetStatus(notebookId, key, { status: "error", signature, error: err.message });
    }
  })().finally(() => running.delete(id));
  running.set(id, job);
  return job;
}

/** Debounced refresh, for when sources finish, move or disappear. Fire-and-forget. */
export function scheduleTopicRefresh(notebookId, unitId) {
  const id = `${notebookId}:${unitKey(unitId)}`;
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      refreshUnitTopics(notebookId, unitId).catch((err) => console.warn(`Topic refresh failed for ${id}: ${err.message}`));
    }, REFRESH_DELAY_MS)
  );
}

/**
 * The course's topics grouped by unit, with each unit's status. Units whose
 * sources changed since their topics were extracted are refreshed in the
 * background (status "pending").
 */
export async function courseTopics(notebookId) {
  const [sources, units, sets, topics] = await Promise.all([listSources(notebookId), listUnits(notebookId), listTopicSets(notebookId), listTopics(notebookId)]);
  const unitIds = new Set(units.map((u) => u.id));
  const groups = [...units.map((u) => ({ unitId: u.id, title: u.title })), { unitId: null, title: "General" }];
  return groups
    .map(({ unitId, title }) => {
      const key = unitKey(unitId);
      const mine = unitSources(sources, unitId, unitIds);
      const set = sets.find((s) => s.unitKey === key);
      let status;
      if (mine.length === 0) status = "empty";
      else if (running.has(`${notebookId}:${key}`) || timers.has(`${notebookId}:${key}`)) status = "pending";
      else if (set && set.signature === signatureOf(mine) && set.status !== "pending") status = set.status; // ready | error
      else {
        scheduleTopicRefresh(notebookId, unitId);
        status = "pending";
      }
      return { unitId, title, status, error: status === "error" ? set?.error ?? null : null, sourceCount: mine.length, topics: topics.filter((t) => t.unitId === unitId) };
    })
    .filter((g) => g.unitId !== null || g.sourceCount > 0 || g.topics.length > 0);
}

// ---- Matching model output to topics --------------------------------------------

const words = (s) => new Set(String(s ?? "").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * The topic a free-text topic name refers to (exact, contained, or ≥50% word
 * overlap), or null. Units can share topic names, so topics of `preferUnitId`
 * (a unit id, or null for General) win ties when given.
 */
export function matchTopic(topics, name, preferUnitId) {
  if (preferUnitId !== undefined) {
    topics = [...topics.filter((t) => t.unitId === preferUnitId), ...topics.filter((t) => t.unitId !== preferUnitId)];
  }
  const n = norm(name);
  if (!n) return null;
  const exact = topics.find((t) => norm(t.name) === n);
  if (exact) return exact;
  const contained = topics.find((t) => norm(t.name).includes(n) || n.includes(norm(t.name)));
  if (contained) return contained;
  const target = words(name);
  let best = null;
  let bestScore = 0;
  for (const t of topics) {
    const tw = words(t.name);
    let overlap = 0;
    for (const w of tw) if (target.has(w)) overlap += 1;
    const score = overlap / Math.max(1, Math.min(tw.size, target.size));
    if (score > bestScore) [best, bestScore] = [t, score];
  }
  return bestScore >= 0.5 ? best : null;
}

// ---- Mastery ---------------------------------------------------------------------

const RECENCY = 0.85; // each older event counts 15% less

/** Weighted recent accuracy (0-1) of a topic's events, newest first; null without events. */
export function masteryOf(events) {
  let num = 0;
  let den = 0;
  events.forEach((e, i) => {
    const w = e.weight * RECENCY ** i;
    num += w * e.score;
    den += w;
  });
  return den ? num / den : null;
}

/**
 * Progress for a user: units with their topics' mastery (weakest first) and a
 * short "revise these today" list.
 */
export async function courseProgress(notebookId, userId) {
  const [groups, events] = await Promise.all([courseTopics(notebookId), recentTopicEvents(notebookId, userId)]);
  const byTopic = new Map();
  for (const e of events) {
    if (!byTopic.has(e.topicId)) byTopic.set(e.topicId, []);
    byTopic.get(e.topicId).push(e);
  }

  const units = groups.map((g) => {
    const topics = g.topics
      .map((t) => {
        const list = byTopic.get(t.id) ?? [];
        const mastery = masteryOf(list);
        return {
          id: t.id,
          name: t.name,
          description: t.description,
          unitId: g.unitId,
          unitTitle: g.title,
          mastery: mastery === null ? null : Math.round(mastery * 100) / 100,
          attempts: list.length,
          lastPracticedAt: list[0]?.createdAt ?? null,
        };
      })
      .sort((a, b) => (a.mastery ?? -1) - (b.mastery ?? -1) || a.name.localeCompare(b.name));
    const practised = topics.filter((t) => t.mastery !== null);
    return {
      unitId: g.unitId,
      title: g.title,
      status: g.status,
      error: g.error,
      mastery: practised.length ? Math.round((practised.reduce((s, t) => s + t.mastery, 0) / practised.length) * 100) / 100 : null,
      practisedCount: practised.length,
      topics,
    };
  });

  const all = units.flatMap((u) => u.topics);
  const weak = all.filter((t) => t.mastery !== null && t.mastery < 0.7).sort((a, b) => a.mastery - b.mastery);
  const unpractised = all.filter((t) => t.mastery === null);
  const revise = [...weak.map((t) => ({ ...t, reason: "weak" })), ...unpractised.map((t) => ({ ...t, reason: "new" }))].slice(0, 5);

  return { units, revise };
}
