import { query, withTransaction } from "./pool.js";

// Questions extracted from a course's past exam papers, mapped to units and
// topics. They belong to the course (everyone who can open it sees them).

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);

function toQuestion(r) {
  return {
    id: r.id,
    notebookId: r.notebook_id,
    sourceId: r.source_id,
    sourceTitle: r.source_title ?? null,
    examName: r.exam_name ?? null,
    position: r.position,
    number: r.number ?? null,
    text: r.text,
    marks: r.marks === null || r.marks === undefined ? null : Number(r.marks),
    year: r.year ?? null,
    section: r.section ?? null,
    unitId: r.unit_id ?? null,
    topicId: r.topic_id ?? null,
    topic: r.topic_name ?? null,
    nodeId: r.node_id ?? null,
    similarity: r.similarity === null || r.similarity === undefined ? null : Number(r.similarity),
    citations: r.citations ?? [],
    createdAt: iso(r.created_at),
  };
}

/** Replaces the questions of one past paper. */
export async function replacePaperQuestions(notebookId, sourceId, questions) {
  await withTransaction(async (client) => {
    await client.query("DELETE FROM past_paper_questions WHERE source_id = $1", [sourceId]);
    for (const [position, q] of questions.entries()) {
      await client.query(
        `INSERT INTO past_paper_questions (notebook_id, source_id, position, number, text, marks, year, section, unit_id, topic_id, similarity, citations)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          notebookId,
          sourceId,
          position,
          q.number ?? null,
          q.text,
          q.marks ?? null,
          q.year ?? null,
          q.section ?? null,
          q.unitId ?? null,
          q.topicId ?? null,
          q.similarity ?? null,
          JSON.stringify(q.citations ?? []),
        ]
      );
    }
  });
}

export async function deletePaperQuestions(sourceId) {
  await query("DELETE FROM past_paper_questions WHERE source_id = $1", [sourceId]);
}

/**
 * A course's past-paper questions, optionally filtered: unitId ("general" =
 * no unit), topicId, year, sourceId. Only questions of papers still marked as
 * past papers are returned.
 */
export async function listPaperQuestions(notebookId, { unitId, topicId, year, sourceId } = {}) {
  const where = ["q.notebook_id = $1", "s.kind = 'past_paper'"];
  const values = [notebookId];
  const add = (sql, value) => {
    values.push(value);
    where.push(sql.replace("?", `$${values.length}`));
  };
  if (unitId === "general") where.push("q.unit_id IS NULL");
  else if (unitId) add("q.unit_id = ?", unitId);
  if (topicId) add("q.topic_id = ?", topicId);
  if (year) add("q.year = ?", year);
  if (sourceId) add("q.source_id = ?", sourceId);
  const { rows } = await query(
    `SELECT q.*, s.title AS source_title, s.exam_name, t.name AS topic_name
       FROM past_paper_questions q
       JOIN sources s ON s.id = q.source_id
       LEFT JOIN topics t ON t.id = q.topic_id
      WHERE ${where.join(" AND ")}
      ORDER BY q.year DESC NULLS LAST, s.created_at, q.position`,
    values
  );
  return rows.map(toQuestion);
}

/** One past-paper question of a course, or null. */
export async function getPaperQuestion(id, notebookId) {
  const { rows } = await query(
    `SELECT q.*, s.title AS source_title, s.exam_name, t.name AS topic_name
       FROM past_paper_questions q JOIN sources s ON s.id = q.source_id LEFT JOIN topics t ON t.id = q.topic_id
      WHERE q.id = $1 AND q.notebook_id = $2`,
    [id, notebookId]
  );
  return rows[0] ? toQuestion(rows[0]) : null;
}

/** Sets a question's unit and/or topic by hand (undefined = unchanged). */
export async function updatePaperQuestion(id, { unitId, topicId }) {
  await query(
    `UPDATE past_paper_questions SET
        unit_id = CASE WHEN $2 THEN $3::uuid ELSE unit_id END,
        topic_id = CASE WHEN $4 THEN $5::uuid ELSE topic_id END
      WHERE id = $1`,
    [id, unitId !== undefined, unitId ?? null, topicId !== undefined, topicId ?? null]
  );
}
