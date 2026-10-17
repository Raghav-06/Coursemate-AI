import { completeJson } from "./llm.js";
import { cleanText, firstNumber, formatPassages } from "./studyContext.js";
import { nodeMastery } from "./knowledgeMap.js";
import { generateQuestions, profileFor } from "./questionGen.js";
import { nodesWithPaths, questionSources } from "./questionJobs.js";
import { getNotebook } from "../db/store.js";
import { listEdges, listNodes, nodeEvents } from "../db/knowledgeMap.js";
import { insertBankQuestions } from "../db/questionBank.js";
import { addTopicEvents } from "../db/practice.js";
import { sessionAnswers, sessionQuestions } from "../db/sessions.js";
import { createPending, recentNodeAnswers, setFollowups, updateDiagnosis } from "../db/diagnoses.js";

// Mistake diagnosis. For every wrong answer (and every question the student
// worked on but left blank):
//   1. signals in code — time vs expected, the clock when answered, position
//      in the test, confidence, answer changes, mastery of the node and its
//      prerequisites before this session, recent results on the same nodes;
//   2. rules for clear cases (strong mastery + very fast/"sure" → careless;
//      little time left + rushed/guessed → time pressure; repeated misses or a
//      weak prerequisite → concept gap);
//   3. Ultra makes the final call with the question, key, solution, the
//      student's answer and working, the signals and the map neighbourhood:
//      category, the specific misconception, which prerequisite to revisit, a
//      short cited explanation;
//   4. Super writes two self-checked follow-up questions.
// Concept gaps also count as weak evidence on the node to revisit (mastery
// and the plan pick it up).

export const CATEGORIES = ["concept_gap", "careless_error", "time_pressure"];
const VERY_FAST = 0.35;
const VERY_SLOW = 1.6;
const LATE_SHARE = 0.75;
const LITTLE_TIME_SHARE = 0.1;
const LITTLE_TIME_S = 120;
const BLANK_WORKED = 0.3; // a blank counts when the student spent this share of the expected time on it
const CONCURRENCY = 2;

const PROMPT = [
  "You are an expert exam coach diagnosing WHY a student got a question wrong. Choose one category:",
  "concept_gap — they don't understand (or misremember) the underlying idea or a prerequisite;",
  "careless_error — they know it but slipped (sign, unit, misread, arithmetic, picked the wrong option by accident);",
  "time_pressure — they ran out of time or rushed/guessed because of the clock.",
  "Use the evidence: the student's answer and working compared with the solution, the timing and confidence signals, their mastery of the topic and its prerequisites, and the suggestion from simple rules (which can be wrong).",
  "Name the specific misconception in ONE sentence about the physics/maths/subject itself (e.g. \"Treats static friction as always equal to μN\"), not a generic statement. For careless errors and time pressure, state the slip or the timing problem instead.",
  "Pick which listed map node to revisit (a prerequisite when the gap is there). Write a short targeted explanation (3-5 sentences, LaTeX for math, cite the passages as [n]) that fixes the misconception. List 2-4 short pieces of evidence for your call.",
].join("\n");

const round = (n, d = 2) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);

/** Code-computed signals for one answer. Pure. */
export function computeSignals({ answer, question, session, total, node, nodeM, prereqs, recent }) {
  const timeSpentS = Math.round(answer.timeSpentMs / 1000);
  const ratio = question.expectedSeconds ? timeSpentS / question.expectedSeconds : null;
  const timed = Boolean(session.durationSeconds);
  const remainingShare = timed && answer.timeRemainingS !== null ? answer.timeRemainingS / session.durationSeconds : null;
  const recentAttempts = recent.length;
  const recentCorrect = recent.filter((r) => r.correct).length;
  return {
    blank: !answer.attempted,
    timeSpentS,
    expectedS: question.expectedSeconds,
    speedRatio: round(ratio),
    speed: ratio === null ? "normal" : ratio < VERY_FAST ? "very_fast" : ratio > VERY_SLOW ? "very_slow" : "normal",
    timed,
    timeRemainingS: timed ? answer.timeRemainingS : null,
    timeRemainingShare: round(remainingShare),
    littleTimeLeft: timed && answer.timeRemainingS !== null && (remainingShare < LITTLE_TIME_SHARE || answer.timeRemainingS < LITTLE_TIME_S),
    position: answer.position + 1,
    of: total,
    latePosition: total > 3 && answer.position + 1 > total * LATE_SHARE,
    confidence: answer.confidence,
    answerChanges: answer.answerChanges,
    node: node ? { name: node.name, score: nodeM?.score ?? null, attempts: nodeM?.attempts ?? 0, status: nodeM?.status ?? "not_started" } : null,
    prereqs: prereqs.map((p) => ({ name: p.name, score: p.m?.score ?? null, attempts: p.m?.attempts ?? 0, status: p.m?.status ?? "not_started" })),
    recentAttempts,
    recentAccuracy: recentAttempts ? round(recentCorrect / recentAttempts) : null,
    repeatedMisses: recent.slice(0, 10).filter((r) => !r.correct).length + 1,
  };
}

/** The rules' suggestion: { category | null, confidence, reasons }. Pure. */
export function ruleCategory(s) {
  const fast = s.speed === "very_fast";
  const strong = s.node && s.node.status === "strong" && s.node.attempts >= 3;
  const weakPrereq = s.prereqs.filter((p) => p.status === "weak");
  if (s.blank && (s.littleTimeLeft || (s.timed && s.latePosition))) return { category: "time_pressure", confidence: 0.8, reasons: ["left blank late in a timed test"] };
  if ((s.littleTimeLeft || (s.timed && s.latePosition && fast)) && (fast || s.confidence === "guess")) {
    return { category: "time_pressure", confidence: 0.75, reasons: [s.littleTimeLeft ? `answered with ${s.timeRemainingS}s left` : "late in the test", fast ? "much faster than expected" : "marked as a guess"] };
  }
  if (strong && (fast || s.confidence === "sure")) {
    return { category: "careless_error", confidence: fast && s.confidence === "sure" ? 0.85 : 0.75, reasons: [`strong mastery of ${s.node.name}`, ...(fast ? ["much faster than expected"] : []), ...(s.confidence === "sure" ? ["marked as sure"] : [])] };
  }
  if (s.repeatedMisses >= 3 || weakPrereq.length || (s.node?.status === "weak" && s.node.attempts >= 3)) {
    return {
      category: "concept_gap",
      confidence: 0.75,
      reasons: [
        ...(s.repeatedMisses >= 3 ? [`missed ${s.repeatedMisses} recent questions on this`] : []),
        ...weakPrereq.map((p) => `weak on the prerequisite ${p.name}`),
        ...(s.node?.status === "weak" && s.node.attempts >= 3 ? [`weak mastery of ${s.node.name}`] : []),
      ],
    };
  }
  return { category: null, confidence: null, reasons: [] };
}

function describeAnswer(q, a) {
  if (!a) return "(left blank)";
  if (q.type === "mcq_single" || q.type === "mcq_multi") return a.choice?.length ? a.choice.map((id) => `(${id}) ${q.options.find((o) => o.id === id)?.text ?? ""}`).join("; ") : "(left blank)";
  if (q.type === "numerical") return `${a.value ?? ""} ${a.unit ?? ""}`.trim() || "(left blank)";
  if (q.type === "matching") return Object.entries(a.pairs ?? {}).map(([k, v]) => `${k}→${v}`).join(", ") || "(left blank)";
  return String(a.text ?? "").slice(0, 3000) || "(left blank)";
}

function describeKey(q) {
  if (q.type === "mcq_single" || q.type === "mcq_multi") return q.answer.correct.map((id) => `(${id}) ${q.options.find((o) => o.id === id)?.text ?? ""}`).join("; ");
  if (q.type === "numerical") return `${q.answer.value} ${q.answer.unit} (± ${q.answer.tolerance})`;
  if (q.type === "matching") return Object.entries(q.answer.pairs).map(([k, v]) => `${k}→${v}`).join(", ");
  if (q.type === "one_word") return q.answer.text;
  return q.answer.rubric.map((r) => `${r.point} (${r.marks})`).join("; ");
}

function signalText(s) {
  return [
    s.blank ? "Left blank after working on it." : null,
    `Time: ${s.timeSpentS}s vs ~${s.expectedS}s expected (${s.speed.replace("_", " ")}).`,
    s.timed ? `Test clock when answered: ${s.timeRemainingS ?? "?"}s left${s.littleTimeLeft ? " (little time left)" : ""}.` : "Untimed.",
    `Position ${s.position} of ${s.of}${s.latePosition ? " (late in the test)" : ""}.`,
    s.confidence ? `Student said: ${s.confidence}.` : "No confidence given.",
    s.answerChanges ? `Changed the answer ${s.answerChanges} time(s).` : null,
    s.node ? `Mastery of ${s.node.name} before this test: ${s.node.score === null ? "not practised" : `${Math.round(s.node.score * 100)}% over ${s.node.attempts} answers`}.` : null,
    s.prereqs.length ? `Prerequisites: ${s.prereqs.map((p) => `${p.name} ${p.score === null ? "not practised" : `${Math.round(p.score * 100)}%`}`).join(", ")}.` : null,
    s.recentAttempts ? `Recent accuracy on similar questions: ${Math.round(s.recentAccuracy * 100)}% of ${s.recentAttempts}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Ultra's diagnosis of one answer, validated. */
async function diagnoseWithModel({ q, a, signals, rule, neighbourhood, language }) {
  const passages = q.citations.map((c, i) => ({ number: c.number ?? i + 1, sourceTitle: c.sourceTitle, location: c.location, text: c.text }));
  const out = await completeJson(
    PROMPT,
    (passages.length ? `Source passages:\n\n${formatPassages(passages)}\n\n` : "") +
      `Question (${q.marks} marks): ${q.stem}\n` +
      (q.options && Array.isArray(q.options) ? `Options:\n${q.options.map((o) => `(${o.id}) ${o.text}`).join("\n")}\n` : "") +
      `\nCorrect answer: ${describeKey(q)}\nSolution: ${String(q.solution ?? "").slice(0, 3000)}\n\n` +
      `Student's answer: ${describeAnswer(q, a.answer)}\n` +
      (a.workingText || a.workingOcr ? `Student's working: ${[a.workingText, a.workingOcr].filter(Boolean).join("\n").slice(0, 2000)}\n` : "") +
      `\nSignals:\n${signalText(signals)}\n\nRule suggestion: ${rule.category ? `${rule.category} (${rule.reasons.join("; ")})` : "unclear"}\n\n` +
      `Knowledge-map nodes you may point to:\n${neighbourhood.map((n, i) => `${i + 1}. ${n.name} (${n.role})`).join("\n")}\n\n` +
      'Return JSON: {"category": "concept_gap" | "careless_error" | "time_pressure", "confidence": number (0-1), "misconception": string, "revisit": number | null, "explanation": string, "evidence": [string]}',
    { task: "diagnose_mistake", language }
  );
  const valid = new Set(passages.map((p) => p.number));
  const category = CATEGORIES.includes(out?.category) ? out.category : rule.category ?? "concept_gap";
  const conf = Number(out?.confidence);
  const revisit = neighbourhood[firstNumber(out?.revisit) - 1] ?? null;
  const explanation = cleanText(out?.explanation, 3000).replace(/\[(\d+)\]/g, (m, n) => (valid.has(Number(n)) ? m : ""));
  const cited = [...new Set([...explanation.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))];
  return {
    category,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : rule.confidence ?? 0.5,
    misconception: cleanText(out?.misconception, 300) || null,
    revisitNodeId: revisit?.id ?? (category === "concept_gap" ? neighbourhood[0]?.id ?? null : null),
    explanation: explanation || null,
    citations: q.citations.filter((c, i) => cited.includes(c.number ?? i + 1)),
    evidence: [...(Array.isArray(out?.evidence) ? out.evidence.map((e) => cleanText(e, 200)).filter(Boolean).slice(0, 4) : []), ...rule.reasons.map((r) => `Rule: ${r}`)].slice(0, 6),
  };
}

const FOLLOWUP_DIFFICULTY = { concept_gap: "easy", careless_error: "medium", time_pressure: "medium" };

async function followUps(notebook, d, q, nodeId, language) {
  const nodes = await nodesWithPaths(notebook.id, [nodeId]);
  const sources = await questionSources(notebook.id);
  if (!nodes.length || !sources.length) return [];
  const profile = profileFor(notebook);
  const formatIds = profile.formats.some((f) => f.id === q.format) ? [q.format] : undefined;
  const result = await generateQuestions({ notebook, nodes, sources, count: 2, formatIds, difficulty: FOLLOWUP_DIFFICULTY[d.category], avoid: [q.stem], language });
  const rows = await insertBankQuestions(notebook.id, d.userId, result.questions);
  return rows.filter((r) => r.verified).map((r) => r.id);
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

const running = new Map(); // sessionId → promise

/**
 * Diagnoses a session's wrong answers (or just `positions`) in the
 * background. Already diagnosed answers are skipped.
 */
export function diagnoseSession(session, { language, positions } = {}) {
  const key = `${session.id}:${positions?.join(",") ?? "all"}`;
  if (running.has(key)) return running.get(key);
  const job = (async () => {
    const [notebook, items, answers, nodes, edges, events] = await Promise.all([
      getNotebook(session.notebookId),
      sessionQuestions(session.id, { withKey: true }),
      sessionAnswers(session.id),
      listNodes(session.notebookId),
      listEdges(session.notebookId),
      nodeEvents(session.notebookId, session.userId),
    ]);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const before = session.startedAt ?? session.createdAt;
    const mastery = nodeMastery(nodes, events.filter((e) => e.createdAt < before));
    const qByPos = new Map(items.map((i) => [i.position, i.question]));
    const targets = answers.filter((a) => {
      if (positions && !positions.includes(a.position)) return false;
      const q = qByPos.get(a.position);
      if (!q || a.correct === null && a.attempted) return false; // couldn't be graded
      if (a.attempted) return a.correct === false;
      return a.timeSpentMs >= Math.max(20_000, BLANK_WORKED * q.expectedSeconds * 1000);
    });
    if (!targets.length) return;

    const pending = [];
    for (const a of targets) {
      const q = qByPos.get(a.position);
      const node = byId.get(q.nodeIds[0]);
      const prereqs = node ? edges.filter((e) => e.to === node.id).map((e) => byId.get(e.from)).filter(Boolean).map((p) => ({ ...p, m: mastery.get(p.id) })) : [];
      const recent = await recentNodeAnswers(session.notebookId, session.userId, q.nodeIds, a.answeredAt ?? session.finishedAt ?? new Date().toISOString());
      const signals = computeSignals({ answer: a, question: q, session, total: items.length, node, nodeM: node ? mastery.get(node.id) : null, prereqs, recent });
      const rule = ruleCategory(signals);
      pending.push({ a, q, node, prereqs, signals, rule, row: { notebookId: session.notebookId, userId: session.userId, sessionId: session.id, position: a.position, questionId: q.id, nodeIds: q.nodeIds, signals: { ...signals, ruleReasons: rule.reasons }, ruleCategory: rule.category, ruleConfidence: rule.confidence, marksLost: Math.round((q.marks - (a.marks ?? 0)) * 100) / 100 } });
    }
    const created = await createPending(pending.map((p) => p.row));
    const byPos = new Map(created.map((d) => [d.position, d]));

    await mapLimit(pending.filter((p) => byPos.has(p.a.position)), CONCURRENCY, async (p) => {
      const d = byPos.get(p.a.position);
      const parent = p.node ? byId.get(p.node.parentId) : null;
      const siblings = p.node ? nodes.filter((n) => n.parentId === p.node.parentId && n.id !== p.node.id).slice(0, 4) : [];
      const neighbourhood = [
        ...(p.node ? [{ id: p.node.id, name: p.node.name, role: "the question's topic" }] : []),
        ...p.prereqs.map((x) => ({ id: x.id, name: x.name, role: `prerequisite, mastery ${x.m?.score === null || x.m?.score === undefined ? "not practised" : `${Math.round(x.m.score * 100)}%`}` })),
        ...(parent ? [{ id: parent.id, name: parent.name, role: "its chapter" }] : []),
        ...siblings.map((x) => ({ id: x.id, name: x.name, role: "related topic" })),
      ];
      try {
        const result = await diagnoseWithModel({ q: p.q, a: p.a, signals: p.signals, rule: p.rule, neighbourhood, language });
        await updateDiagnosis(d.id, { status: "ready", ...result });
        if (result.category === "concept_gap" && result.revisitNodeId) {
          const revisit = byId.get(result.revisitNodeId);
          await addTopicEvents(session.userId, [{ nodeId: result.revisitNodeId, topicId: revisit?.topicId ?? null, kind: "diagnosis", score: 0.3, weight: 0.5 }]);
        }
        try {
          const ids = await followUps(notebook, { ...d, ...result, userId: session.userId }, p.q, result.revisitNodeId ?? p.node?.id, language);
          await setFollowups(d.id, ids);
        } catch (err) {
          console.warn(`Follow-up questions for diagnosis ${d.id} failed: ${err.message}`);
        }
      } catch (err) {
        console.warn(`Diagnosis ${d.id} failed: ${err.message}`);
        // The rules' call (if any) stays as a fallback.
        await updateDiagnosis(d.id, { status: p.rule.category ? "ready" : "error", error: err.message.slice(0, 300), evidence: p.rule.reasons.map((r) => `Rule: ${r}`) });
      }
    });
  })()
    .catch((err) => console.warn(`Diagnosing session ${session.id} failed: ${err.message}`))
    .finally(() => running.delete(key));
  running.set(key, job);
  return job;
}

export const isDiagnosing = (sessionId) => [...running.keys()].some((k) => k.startsWith(`${sessionId}:`));
