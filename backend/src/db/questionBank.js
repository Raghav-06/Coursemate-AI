import { query, withTransaction } from "./pool.js";
import { canAccessNotebook } from "./access.js";

// The course question bank (bank_questions) and problem reports.

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);

/** Without `withKey`, the answer and solution are left out (shown only when revealed). */
export function toBankQuestion(r, { withKey = false } = {}) {
  if (!r) return null;
  return {
    id: r.id,
    notebookId: r.notebook_id,
    nodeIds: r.node_ids ?? [],
    examType: r.exam_type ?? null,
    format: r.format,
    type: r.type,
    difficulty: r.difficulty,
    stem: r.stem,
    options: r.options ?? null,
    ...(withKey ? { answer: r.answer, solution: r.solution ?? null } : {}),
    citations: r.citations ?? [],
    expectedSeconds: r.expected_seconds,
    marks: Number(r.marks),
    negative: Number(r.negative),
    verified: r.verified,
    verification: withKey ? r.verification : { status: r.verification?.status ?? null, attempts: r.verification?.attempts ?? null },
    qualityFlags: r.quality_flags ?? [],
    hidden: r.hidden,
    createdAt: iso(r.created_at),
  };
}

export async function insertBankQuestions(notebookId, userId, questions) {
  return withTransaction(async (client) => {
    const out = [];
    for (const q of questions) {
      const { rows } = await client.query(
        `INSERT INTO bank_questions (notebook_id, node_ids, exam_type, format, type, difficulty, stem, options, answer, solution,
                                     citations, expected_seconds, marks, negative, verified, verification, quality_flags, hidden, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING *`,
        [
          notebookId,
          q.nodeIds,
          q.examType ?? null,
          q.format,
          q.type,
          q.difficulty,
          q.stem,
          q.options === null || q.options === undefined ? null : JSON.stringify(q.options),
          JSON.stringify(q.answer),
          q.solution ?? null,
          JSON.stringify(q.citations ?? []),
          q.expectedSeconds,
          q.marks,
          q.negative ?? 0,
          q.verified,
          JSON.stringify(q.verification ?? {}),
          JSON.stringify(q.qualityFlags ?? []),
          !q.verified,
          userId,
        ]
      );
      out.push(rows[0]);
    }
    return out;
  });
}

/**
 * Verified, visible questions of a course; filters: nodeIds (any of them),
 * formats, ids, excludeIds, limit. Answers only with `withKey`.
 */
export async function listBankQuestions(notebookId, { nodeIds, formats, ids, excludeIds, limit = 100, withKey = false, includeHidden = false } = {}) {
  const where = ["notebook_id = $1"];
  const values = [notebookId];
  const add = (sql, value) => {
    values.push(value);
    where.push(sql.replaceAll("?", `$${values.length}`));
  };
  if (!includeHidden) where.push("verified AND NOT hidden");
  if (nodeIds?.length) add("node_ids && ?::uuid[]", nodeIds);
  if (formats?.length) add("format = ANY(?::text[])", formats);
  if (ids) add("id = ANY(?::uuid[])", ids);
  if (excludeIds?.length) add("NOT (id = ANY(?::uuid[]))", excludeIds);
  values.push(limit);
  const { rows } = await query(`SELECT * FROM bank_questions WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT $${values.length}`, values);
  return rows.map((r) => toBankQuestion(r, { withKey }));
}

/** A question of a course the user may open (with its key), or null. */
export async function getBankQuestion(id, userId) {
  const { rows } = await query(
    `SELECT q.* FROM bank_questions q JOIN notebooks n ON n.id = q.notebook_id WHERE q.id = $1 AND ${canAccessNotebook("n", "$2")}`,
    [id, userId]
  );
  return rows[0] ? toBankQuestion(rows[0], { withKey: true }) : null;
}

/** Hides a question for everyone and logs the report. */
export async function reportQuestion(questionId, userId, reason, note) {
  await withTransaction(async (client) => {
    await client.query("INSERT INTO question_reports (question_id, user_id, reason, note) VALUES ($1, $2, $3, $4)", [questionId, userId, reason, note || null]);
    await client.query(
      `UPDATE bank_questions SET hidden = TRUE,
              quality_flags = CASE WHEN quality_flags ? $2 THEN quality_flags ELSE quality_flags || to_jsonb($2::text) END
        WHERE id = $1`,
      [questionId, `reported_${reason}`]
    );
  });
}

/** Counts per course for the bank summary: verified, rejected, reported. */
export async function bankStats(notebookId) {
  const { rows } = await query(
    `SELECT COUNT(*) FILTER (WHERE verified AND NOT hidden)::int AS verified,
            COUNT(*) FILTER (WHERE NOT verified)::int AS rejected,
            (SELECT COUNT(DISTINCT question_id)::int FROM question_reports r JOIN bank_questions b ON b.id = r.question_id WHERE b.notebook_id = $1) AS reported
       FROM bank_questions WHERE notebook_id = $1`,
    [notebookId]
  );
  return rows[0];
}
