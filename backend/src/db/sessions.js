import { query, withTransaction } from "./pool.js";
import { canAccessNotebook } from "./access.js";
import { toBankQuestion } from "./questionBank.js";

// Practice sessions (personal), their questions and the student's answers.

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);
const num = (v) => (v === null || v === undefined ? null : Number(v));

export function toSession(r) {
  if (!r) return null;
  return {
    id: r.id,
    notebookId: r.notebook_id,
    userId: r.user_id,
    kind: r.kind,
    examType: r.exam_type ?? null,
    title: r.title,
    nodeIds: r.node_ids ?? [],
    durationSeconds: r.duration_seconds ?? null,
    status: r.status,
    error: r.error ?? null,
    settings: r.settings ?? {},
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    score: num(r.score),
    maxScore: num(r.max_score),
    createdAt: iso(r.created_at),
    ...(r.question_count !== undefined ? { questionCount: Number(r.question_count) } : {}),
  };
}

function toAnswer(r) {
  return {
    position: r.position,
    questionId: r.question_id,
    answer: r.answer ?? null,
    attempted: r.attempted,
    correct: r.correct,
    fraction: num(r.fraction),
    marks: num(r.marks),
    timeSpentMs: r.time_spent_ms,
    timeRemainingS: r.time_remaining_s,
    answerChanges: r.answer_changes,
    confidence: r.confidence ?? null,
    workingText: r.working_text ?? null,
    workingOcr: r.working_ocr ?? null,
    grading: r.grading ?? null,
    locked: r.locked,
    answeredAt: iso(r.answered_at),
  };
}

export async function createSession(s) {
  const { rows } = await query(
    `INSERT INTO practice_sessions (notebook_id, user_id, kind, exam_type, title, node_ids, duration_seconds, status, settings)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [s.notebookId, s.userId, s.kind, s.examType ?? null, s.title, s.nodeIds ?? [], s.durationSeconds ?? null, s.status ?? "ready", JSON.stringify(s.settings ?? {})]
  );
  return toSession(rows[0]);
}

/** Sets the session's questions ([{ questionId, section }]) and empty answer rows. */
export async function setSessionQuestions(sessionId, questions) {
  await withTransaction(async (client) => {
    await client.query("DELETE FROM session_questions WHERE session_id = $1", [sessionId]);
    await client.query("DELETE FROM session_answers WHERE session_id = $1", [sessionId]);
    for (const [position, q] of questions.entries()) {
      await client.query("INSERT INTO session_questions (session_id, position, question_id, section) VALUES ($1, $2, $3, $4)", [sessionId, position, q.questionId, q.section ?? null]);
      await client.query("INSERT INTO session_answers (session_id, position, question_id) VALUES ($1, $2, $3)", [sessionId, position, q.questionId]);
    }
  });
}

export async function updateSession(id, patch) {
  const cols = { status: "status", error: "error", startedAt: "started_at", finishedAt: "finished_at", score: "score", maxScore: "max_score", durationSeconds: "duration_seconds", title: "title" };
  const sets = [];
  const values = [];
  for (const [k, c] of Object.entries(cols)) {
    if (patch[k] === undefined) continue;
    values.push(patch[k]);
    sets.push(`${c} = $${values.length}`);
  }
  if (!sets.length) return;
  values.push(id);
  await query(`UPDATE practice_sessions SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
}

/** Moves a session from one status to another; false if it wasn't in `from` (so only one caller wins). */
export async function claimSession(id, from, to, extra = "") {
  const { rowCount } = await query(`UPDATE practice_sessions SET status = $3${extra} WHERE id = $1 AND status = ANY($2::text[])`, [id, from, to]);
  return rowCount === 1;
}

/** A session of this user in a course they may open, or null. */
export async function getSession(id, userId) {
  const { rows } = await query(
    `SELECT s.* FROM practice_sessions s JOIN notebooks n ON n.id = s.notebook_id
      WHERE s.id = $1 AND s.user_id = $2 AND ${canAccessNotebook("n", "$2")}`,
    [id, userId]
  );
  return toSession(rows[0]);
}

export async function listSessions(notebookId, userId, limit = 30) {
  const { rows } = await query(
    `SELECT s.*, (SELECT COUNT(*) FROM session_questions q WHERE q.session_id = s.id) AS question_count
       FROM practice_sessions s WHERE s.notebook_id = $1 AND s.user_id = $2 ORDER BY s.created_at DESC LIMIT $3`,
    [notebookId, userId, limit]
  );
  return rows.map(toSession);
}

/** The session's questions in order ({ position, section, question }), with keys only when asked. */
export async function sessionQuestions(sessionId, { withKey = false } = {}) {
  const { rows } = await query(
    `SELECT sq.position, sq.section, b.* FROM session_questions sq JOIN bank_questions b ON b.id = sq.question_id
      WHERE sq.session_id = $1 ORDER BY sq.position`,
    [sessionId]
  );
  return rows.map((r) => ({ position: r.position, section: r.section, question: toBankQuestion(r, { withKey }) }));
}

export async function sessionAnswers(sessionId) {
  const { rows } = await query("SELECT * FROM session_answers WHERE session_id = $1 ORDER BY position", [sessionId]);
  return rows.map(toAnswer);
}

export async function getAnswer(sessionId, position) {
  const { rows } = await query("SELECT * FROM session_answers WHERE session_id = $1 AND position = $2", [sessionId, position]);
  return rows[0] ? toAnswer(rows[0]) : null;
}

const ANSWER_COLS = {
  answer: ["answer", true],
  attempted: ["attempted"],
  correct: ["correct"],
  fraction: ["fraction"],
  marks: ["marks"],
  timeSpentMs: ["time_spent_ms"],
  timeRemainingS: ["time_remaining_s"],
  answerChanges: ["answer_changes"],
  confidence: ["confidence"],
  workingText: ["working_text"],
  workingOcr: ["working_ocr"],
  grading: ["grading", true],
  locked: ["locked"],
  answeredAt: ["answered_at"],
};

export async function updateAnswer(sessionId, position, patch) {
  const sets = ["updated_at = NOW()"];
  const values = [];
  for (const [k, [c, json]] of Object.entries(ANSWER_COLS)) {
    if (patch[k] === undefined) continue;
    values.push(json && patch[k] !== null ? JSON.stringify(patch[k]) : patch[k]);
    sets.push(`${c} = $${values.length}`);
  }
  values.push(sessionId, position);
  const { rows } = await query(`UPDATE session_answers SET ${sets.join(", ")} WHERE session_id = $${values.length - 1} AND position = $${values.length} RETURNING *`, values);
  return rows[0] ? toAnswer(rows[0]) : null;
}

/** Bank questions this user has already met in the course (to prefer fresh ones). */
export async function seenQuestionIds(notebookId, userId) {
  const { rows } = await query(
    `SELECT DISTINCT sq.question_id FROM session_questions sq JOIN practice_sessions s ON s.id = sq.session_id
      WHERE s.notebook_id = $1 AND s.user_id = $2`,
    [notebookId, userId]
  );
  return rows.map((r) => r.question_id);
}
