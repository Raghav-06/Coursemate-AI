import { query } from "./pool.js";
import { canAccessNotebook } from "./access.js";

// Mistake diagnoses (personal).

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);

export function toDiagnosis(r) {
  if (!r) return null;
  return {
    id: r.id,
    notebookId: r.notebook_id,
    sessionId: r.session_id,
    position: r.position,
    questionId: r.question_id ?? null,
    nodeIds: r.node_ids ?? [],
    status: r.status,
    error: r.error ?? null,
    category: r.category ?? null,
    confidence: r.confidence === null || r.confidence === undefined ? null : Number(r.confidence),
    ruleCategory: r.rule_category ?? null,
    signals: r.signals ?? {},
    evidence: r.evidence ?? [],
    misconception: r.misconception ?? null,
    revisitNodeId: r.revisit_node_id ?? null,
    revisitNodeName: r.revisit_node_name ?? null,
    explanation: r.explanation ?? null,
    citations: r.citations ?? [],
    followupQuestionIds: r.followup_question_ids ?? [],
    marksLost: Number(r.marks_lost ?? 0),
    feedback: r.feedback ?? null,
    feedbackNote: r.feedback_note ?? null,
    createdAt: iso(r.created_at),
    ...(r.session_title !== undefined ? { sessionTitle: r.session_title } : {}),
  };
}

/** Creates pending rows for the answers to diagnose (existing ones are kept). Returns the new ones. */
export async function createPending(rows) {
  const created = [];
  for (const r of rows) {
    const { rows: out } = await query(
      `INSERT INTO diagnoses (notebook_id, user_id, session_id, position, question_id, node_ids, signals, rule_category, marks_lost, confidence, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (session_id, position) DO NOTHING RETURNING *`,
      [r.notebookId, r.userId, r.sessionId, r.position, r.questionId, r.nodeIds, JSON.stringify(r.signals), r.ruleCategory, r.marksLost, r.ruleConfidence ?? null, r.ruleCategory]
    );
    if (out[0]) created.push(toDiagnosis(out[0]));
  }
  return created;
}

export async function updateDiagnosis(id, d) {
  await query(
    `UPDATE diagnoses SET status = $2, error = $3, category = COALESCE($4, category), confidence = COALESCE($5, confidence),
            evidence = COALESCE($6, evidence), misconception = $7, revisit_node_id = $8, explanation = $9,
            citations = COALESCE($10, citations), followup_question_ids = COALESCE($11, followup_question_ids)
      WHERE id = $1`,
    [
      id,
      d.status,
      d.error ?? null,
      d.category ?? null,
      d.confidence ?? null,
      d.evidence ? JSON.stringify(d.evidence) : null,
      d.misconception ?? null,
      d.revisitNodeId ?? null,
      d.explanation ?? null,
      d.citations ? JSON.stringify(d.citations) : null,
      d.followupQuestionIds ?? null,
    ]
  );
}

export async function setFollowups(id, questionIds) {
  await query("UPDATE diagnoses SET followup_question_ids = $2 WHERE id = $1", [id, questionIds]);
}

const SELECT = `SELECT d.*, n.name AS revisit_node_name, s.title AS session_title FROM diagnoses d
  LEFT JOIN km_nodes n ON n.id = d.revisit_node_id JOIN practice_sessions s ON s.id = d.session_id`;

export async function sessionDiagnoses(sessionId) {
  const { rows } = await query(`${SELECT} WHERE d.session_id = $1 ORDER BY d.position`, [sessionId]);
  return rows.map(toDiagnosis);
}

/** A user's diagnoses in a course, newest first (optionally since a time). */
export async function listDiagnoses(notebookId, userId, { since, limit = 500 } = {}) {
  const { rows } = await query(
    `${SELECT} WHERE d.notebook_id = $1 AND d.user_id = $2 ${since ? "AND d.created_at >= $4" : ""} ORDER BY d.created_at DESC LIMIT $3`,
    since ? [notebookId, userId, limit, since] : [notebookId, userId, limit]
  );
  return rows.map(toDiagnosis);
}

/** A diagnosis of this user (in a course they may open), or null. */
export async function getDiagnosis(id, userId) {
  const { rows } = await query(
    `${SELECT} JOIN notebooks nb ON nb.id = d.notebook_id WHERE d.id = $1 AND d.user_id = $2 AND ${canAccessNotebook("nb", "$2")}`,
    [id, userId]
  );
  return toDiagnosis(rows[0]);
}

export async function setDiagnosisFeedback(id, feedback, note) {
  await query("UPDATE diagnoses SET feedback = $2::text, feedback_note = $3, feedback_at = CASE WHEN $2::text IS NULL THEN NULL ELSE NOW() END WHERE id = $1", [id, feedback, note || null]);
}

/** The user's earlier answers on these nodes (newest first): for repeated-miss signals. */
export async function recentNodeAnswers(notebookId, userId, nodeIds, before) {
  if (!nodeIds.length) return [];
  const { rows } = await query(
    `SELECT a.correct, a.attempted, b.node_ids, s.finished_at FROM session_answers a
       JOIN practice_sessions s ON s.id = a.session_id JOIN bank_questions b ON b.id = a.question_id
      WHERE s.notebook_id = $1 AND s.user_id = $2 AND a.attempted AND a.correct IS NOT NULL
        AND b.node_ids && $3::uuid[] AND COALESCE(a.answered_at, s.finished_at) < $4
      ORDER BY COALESCE(a.answered_at, s.finished_at) DESC LIMIT 50`,
    [notebookId, userId, nodeIds, before]
  );
  return rows.map((r) => ({ correct: r.correct, nodeIds: r.node_ids }));
}

export async function deleteDiagnosis(id) {
  await query("DELETE FROM diagnoses WHERE id = $1", [id]);
}
