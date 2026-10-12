import { query, withTransaction } from "./pool.js";
import { canAccessNotebook } from "./access.js";

// Topics, quizzes, graded written answers and topic mastery. Topics belong to
// the course; quizzes, attempts, written answers and topic events are
// personal (keyed by user).

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);
export const unitKey = (unitId) => unitId ?? "general";

// ---- Topics ------------------------------------------------------------------

function toTopic(r) {
  return { id: r.id, notebookId: r.notebook_id, unitId: r.unit_id ?? null, name: r.name, description: r.description ?? null, position: r.position };
}

export async function listTopics(notebookId) {
  const { rows } = await query("SELECT * FROM topics WHERE notebook_id = $1 ORDER BY unit_id NULLS LAST, position", [notebookId]);
  return rows.map(toTopic);
}

export async function getTopicsByIds(notebookId, ids) {
  if (!ids.length) return [];
  const { rows } = await query("SELECT * FROM topics WHERE notebook_id = $1 AND id = ANY($2::uuid[])", [notebookId, ids]);
  return rows.map(toTopic);
}

export async function listTopicSets(notebookId) {
  const { rows } = await query("SELECT * FROM topic_sets WHERE notebook_id = $1", [notebookId]);
  return rows.map((r) => ({ unitKey: r.unit_key, signature: r.signature, status: r.status, error: r.error, updatedAt: iso(r.updated_at) }));
}

export async function setTopicSetStatus(notebookId, key, { status, signature, error = null }) {
  await query(
    `INSERT INTO topic_sets (notebook_id, unit_key, status, signature, error, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (notebook_id, unit_key) DO UPDATE SET
       status = EXCLUDED.status, signature = COALESCE(EXCLUDED.signature, topic_sets.signature),
       error = EXCLUDED.error, updated_at = NOW()`,
    [notebookId, key, status, signature ?? null, error]
  );
}

const normName = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Replaces a unit's topics with `topics` ([{ name, description }]). Topics
 * whose name survives keep their id, so mastery history stays attached.
 */
export async function replaceUnitTopics(notebookId, unitId, topics) {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT id, name FROM topics WHERE notebook_id = $1 AND unit_id IS NOT DISTINCT FROM $2",
      [notebookId, unitId]
    );
    const existing = new Map(rows.map((r) => [normName(r.name), r.id]));
    const keep = new Set();
    for (const [position, topic] of topics.entries()) {
      const id = existing.get(normName(topic.name));
      if (id) {
        keep.add(id);
        await client.query("UPDATE topics SET name = $2, description = $3, position = $4 WHERE id = $1", [id, topic.name, topic.description ?? null, position]);
      } else {
        await client.query(
          "INSERT INTO topics (notebook_id, unit_id, name, description, position) VALUES ($1, $2, $3, $4, $5)",
          [notebookId, unitId, topic.name, topic.description ?? null, position]
        );
      }
    }
    const stale = rows.filter((r) => !keep.has(r.id)).map((r) => r.id);
    if (stale.length) await client.query("DELETE FROM topics WHERE id = ANY($1::uuid[])", [stale]);
  });
}

export async function deleteUnitTopics(notebookId, unitId) {
  await query("DELETE FROM topics WHERE notebook_id = $1 AND unit_id IS NOT DISTINCT FROM $2", [notebookId, unitId]);
  await query("DELETE FROM topic_sets WHERE notebook_id = $1 AND unit_key = $2", [notebookId, unitKey(unitId)]);
}

// ---- Topic events & mastery -----------------------------------------------------

export async function addTopicEvents(userId, events) {
  for (const e of events) {
    if (!e.topicId) continue;
    await query("INSERT INTO topic_events (user_id, topic_id, kind, score, weight) VALUES ($1, $2, $3, $4, $5)", [
      userId,
      e.topicId,
      e.kind,
      Math.max(0, Math.min(1, e.score)),
      e.weight ?? 1,
    ]);
  }
}

/** The user's most recent events per topic of a course (newest first, up to `perTopic` each). */
export async function recentTopicEvents(notebookId, userId, perTopic = 25) {
  const { rows } = await query(
    `SELECT topic_id, score, weight, kind, created_at FROM (
       SELECT e.*, ROW_NUMBER() OVER (PARTITION BY e.topic_id ORDER BY e.created_at DESC, e.id DESC) AS rn
         FROM topic_events e JOIN topics t ON t.id = e.topic_id
        WHERE t.notebook_id = $1 AND e.user_id = $2
     ) ranked WHERE rn <= $3 ORDER BY topic_id, created_at DESC`,
    [notebookId, userId, perTopic]
  );
  return rows.map((r) => ({ topicId: r.topic_id, score: Number(r.score), weight: Number(r.weight), kind: r.kind, createdAt: iso(r.created_at) }));
}

// ---- Quizzes -------------------------------------------------------------------

function toQuestion(r, { withAnswer = false } = {}) {
  return {
    id: r.id,
    position: r.position,
    question: r.question,
    options: r.options,
    ...(withAnswer ? { answerIndex: r.answer_index, explanation: r.explanation ?? null } : {}),
    topicId: r.topic_id ?? null,
    topic: r.topic ?? null,
    sourceId: r.source_id ?? null,
    sourceTitle: r.source_title ?? null,
    location: r.location ?? null,
    ...(withAnswer ? { quote: r.quote ?? null } : {}),
  };
}

function toQuiz(r) {
  if (!r) return null;
  const quiz = {
    id: r.id,
    notebookId: r.notebook_id,
    userId: r.user_id,
    title: r.title,
    difficulty: r.difficulty,
    unitIds: r.unit_ids ?? [],
    createdAt: iso(r.created_at),
  };
  if (r.question_count !== undefined) {
    Object.assign(quiz, {
      questionCount: Number(r.question_count),
      attempts: Number(r.attempt_count ?? 0),
      bestScore: r.best_score === null || r.best_score === undefined ? null : Number(r.best_score),
      lastScore: r.last_score === null || r.last_score === undefined ? null : Number(r.last_score),
    });
  }
  return quiz;
}

export async function createQuiz({ notebookId, userId, title, difficulty, unitIds, questions }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      "INSERT INTO quizzes (notebook_id, user_id, title, difficulty, unit_ids) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [notebookId, userId, title, difficulty, JSON.stringify(unitIds ?? [])]
    );
    for (const [position, q] of questions.entries()) {
      await client.query(
        `INSERT INTO quiz_questions (quiz_id, position, question, options, answer_index, explanation, topic_id, topic, source_id, location, quote)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [rows[0].id, position, q.question, JSON.stringify(q.options), q.answerIndex, q.explanation, q.topicId ?? null, q.topic ?? null, q.sourceId ?? null, q.location ?? null, q.quote ?? null]
      );
    }
    return toQuiz(rows[0]);
  });
}

export async function listQuizzes(notebookId, userId) {
  const { rows } = await query(
    `SELECT q.*,
            (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS question_count,
            (SELECT COUNT(*) FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.user_id = $2 AND a.finished_at IS NOT NULL) AS attempt_count,
            (SELECT MAX(score) FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.user_id = $2 AND a.finished_at IS NOT NULL) AS best_score,
            (SELECT score FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.user_id = $2 AND a.finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1) AS last_score
       FROM quizzes q WHERE q.notebook_id = $1 AND q.user_id = $2
      ORDER BY q.created_at DESC`,
    [notebookId, userId]
  );
  return rows.map(toQuiz);
}

/** A quiz of this user in a course they may open, or null. */
export async function getQuiz(id, userId) {
  const { rows } = await query(
    `SELECT q.* FROM quizzes q JOIN notebooks n ON n.id = q.notebook_id
      WHERE q.id = $1 AND q.user_id = $2 AND ${canAccessNotebook("n", "$2")}`,
    [id, userId]
  );
  return toQuiz(rows[0]);
}

export async function listQuizQuestions(quizId, { withAnswers = false } = {}) {
  const { rows } = await query(
    `SELECT qq.*, s.title AS source_title FROM quiz_questions qq LEFT JOIN sources s ON s.id = qq.source_id
      WHERE qq.quiz_id = $1 ORDER BY qq.position`,
    [quizId]
  );
  return rows.map((r) => toQuestion(r, { withAnswer: withAnswers }));
}

export async function deleteQuiz(id) {
  await query("DELETE FROM quizzes WHERE id = $1", [id]);
}

function toAttempt(r) {
  if (!r) return null;
  return {
    id: r.id,
    quizId: r.quiz_id,
    userId: r.user_id,
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    score: r.score,
    total: r.total,
    ...(r.notebook_id ? { notebookId: r.notebook_id } : {}),
  };
}

export async function startAttempt(quizId, userId, total) {
  const { rows } = await query("INSERT INTO quiz_attempts (quiz_id, user_id, total) VALUES ($1, $2, $3) RETURNING *", [quizId, userId, total]);
  return toAttempt(rows[0]);
}

/** An attempt by this user (in a course they may open), or null. */
export async function getAttempt(id, userId) {
  const { rows } = await query(
    `SELECT a.*, q.notebook_id FROM quiz_attempts a
       JOIN quizzes q ON q.id = a.quiz_id JOIN notebooks n ON n.id = q.notebook_id
      WHERE a.id = $1 AND a.user_id = $2 AND ${canAccessNotebook("n", "$2")}`,
    [id, userId]
  );
  return toAttempt(rows[0]);
}

export async function getQuestion(quizId, questionId) {
  const { rows } = await query(
    `SELECT qq.*, s.title AS source_title FROM quiz_questions qq LEFT JOIN sources s ON s.id = qq.source_id
      WHERE qq.id = $1 AND qq.quiz_id = $2`,
    [questionId, quizId]
  );
  return rows[0] ? toQuestion(rows[0], { withAnswer: true }) : null;
}

/** Records an answer; false if this question was already answered in the attempt. */
export async function recordAnswer({ attemptId, questionId, chosenIndex, correct, timeMs }) {
  const { rowCount } = await query(
    `INSERT INTO quiz_answers (attempt_id, question_id, chosen_index, correct, time_ms)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (attempt_id, question_id) DO NOTHING`,
    [attemptId, questionId, chosenIndex, correct, timeMs]
  );
  return rowCount === 1;
}

export async function listAttemptAnswers(attemptId) {
  const { rows } = await query("SELECT * FROM quiz_answers WHERE attempt_id = $1 ORDER BY answered_at", [attemptId]);
  return rows.map((r) => ({ questionId: r.question_id, chosenIndex: r.chosen_index, correct: r.correct, timeMs: r.time_ms }));
}

export async function finishAttempt(attemptId) {
  const { rows } = await query(
    `UPDATE quiz_attempts SET finished_at = COALESCE(finished_at, NOW()),
            score = (SELECT COUNT(*) FROM quiz_answers WHERE attempt_id = $1 AND correct)
      WHERE id = $1 RETURNING *`,
    [attemptId]
  );
  return toAttempt(rows[0]);
}

// ---- Written answers ------------------------------------------------------------

function toAnswerAttempt(r) {
  return {
    id: r.id,
    notebookId: r.notebook_id,
    question: r.question,
    marks: r.marks,
    answer: r.answer,
    score: Number(r.score),
    feedback: r.feedback,
    citations: r.citations ?? [],
    topicId: r.topic_id ?? null,
    topic: r.topic_name ?? null,
    unitIds: r.unit_ids ?? [],
    origin: r.origin,
    createdAt: iso(r.created_at),
  };
}

export async function addAnswerAttempt(a) {
  const { rows } = await query(
    `INSERT INTO answer_attempts (notebook_id, user_id, question, marks, answer, score, feedback, citations, topic_id, unit_ids, origin)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [a.notebookId, a.userId, a.question, a.marks, a.answer, a.score, JSON.stringify(a.feedback), JSON.stringify(a.citations ?? []), a.topicId ?? null, JSON.stringify(a.unitIds ?? []), a.origin ?? "typed"]
  );
  return toAnswerAttempt(rows[0]);
}

export async function listAnswerAttempts(notebookId, userId, limit = 50) {
  const { rows } = await query(
    `SELECT a.*, t.name AS topic_name FROM answer_attempts a LEFT JOIN topics t ON t.id = a.topic_id
      WHERE a.notebook_id = $1 AND a.user_id = $2 ORDER BY a.created_at DESC LIMIT $3`,
    [notebookId, userId, limit]
  );
  return rows.map(toAnswerAttempt);
}

export async function getAnswerAttempt(id, userId) {
  const { rows } = await query(
    `SELECT a.*, t.name AS topic_name FROM answer_attempts a
       JOIN notebooks n ON n.id = a.notebook_id LEFT JOIN topics t ON t.id = a.topic_id
      WHERE a.id = $1 AND a.user_id = $2 AND ${canAccessNotebook("n", "$2")}`,
    [id, userId]
  );
  return rows[0] ? toAnswerAttempt(rows[0]) : null;
}

export async function deleteAnswerAttempt(id) {
  await query("DELETE FROM answer_attempts WHERE id = $1", [id]);
}

// ---- Explain-it-back -----------------------------------------------------------------

function toExplanation(r) {
  return {
    id: r.id,
    notebookId: r.notebook_id,
    topicId: r.topic_id ?? null,
    topic: r.topic_name ?? null,
    prompt: r.prompt,
    explanation: r.explanation,
    clarity: r.clarity,
    accuracy: r.accuracy,
    feedback: r.feedback,
    citations: r.citations ?? [],
    unitIds: r.unit_ids ?? [],
    createdAt: iso(r.created_at),
  };
}

export async function addExplanation(e) {
  const { rows } = await query(
    `INSERT INTO explanations (notebook_id, user_id, topic_id, prompt, explanation, clarity, accuracy, feedback, citations, unit_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [e.notebookId, e.userId, e.topicId ?? null, e.prompt, e.explanation, e.clarity, e.accuracy, JSON.stringify(e.feedback), JSON.stringify(e.citations ?? []), JSON.stringify(e.unitIds ?? [])]
  );
  return toExplanation(rows[0]);
}

export async function listExplanations(notebookId, userId, limit = 50) {
  const { rows } = await query(
    `SELECT x.*, t.name AS topic_name FROM explanations x LEFT JOIN topics t ON t.id = x.topic_id
      WHERE x.notebook_id = $1 AND x.user_id = $2 ORDER BY x.created_at DESC LIMIT $3`,
    [notebookId, userId, limit]
  );
  return rows.map(toExplanation);
}

/** An explanation by this user (in a course they may open), or null. */
export async function getExplanation(id, userId) {
  const { rows } = await query(
    `SELECT x.*, t.name AS topic_name FROM explanations x
       JOIN notebooks n ON n.id = x.notebook_id LEFT JOIN topics t ON t.id = x.topic_id
      WHERE x.id = $1 AND x.user_id = $2 AND ${canAccessNotebook("n", "$2")}`,
    [id, userId]
  );
  return rows[0] ? toExplanation(rows[0]) : null;
}

export async function deleteExplanation(id) {
  await query("DELETE FROM explanations WHERE id = $1", [id]);
}
