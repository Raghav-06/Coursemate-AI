import { query, withTransaction } from "./pool.js";
import { canAccessNotebook } from "./access.js";

// Exams, revision plans and daily activity — all personal (keyed by user).

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);
// DATE columns come back as "YYYY-MM-DD" strings (see the type parser in pool.js).
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ?? null);

// ---- Exams -----------------------------------------------------------------------

function toExam(r) {
  if (!r) return null;
  return {
    id: r.id,
    notebookId: r.notebook_id,
    notebookTitle: r.notebook_title ?? undefined,
    notebookEmoji: r.notebook_emoji ?? undefined,
    name: r.name,
    examDate: day(r.exam_date),
    unitIds: r.unit_ids ?? [],
    planGeneratedAt: iso(r.plan_generated_at),
    createdAt: iso(r.created_at),
    ...(r.task_count !== undefined ? { taskCount: Number(r.task_count), doneCount: Number(r.done_count) } : {}),
  };
}

const EXAM_COUNTS = `(SELECT COUNT(*) FROM exam_plan_items i WHERE i.exam_id = e.id) AS task_count,
                     (SELECT COUNT(*) FROM exam_plan_items i WHERE i.exam_id = e.id AND i.done) AS done_count`;

export async function listExams(notebookId, userId) {
  const { rows } = await query(
    `SELECT e.*, ${EXAM_COUNTS} FROM exams e WHERE e.notebook_id = $1 AND e.user_id = $2 ORDER BY e.exam_date, e.created_at`,
    [notebookId, userId]
  );
  return rows.map(toExam);
}

export async function countExams(notebookId, userId) {
  const { rows } = await query("SELECT COUNT(*)::int AS count FROM exams WHERE notebook_id = $1 AND user_id = $2", [notebookId, userId]);
  return rows[0].count;
}

/** This user's exam (in a course they may open), or null. */
export async function getExam(id, userId) {
  const { rows } = await query(
    `SELECT e.*, n.title AS notebook_title, n.emoji AS notebook_emoji, ${EXAM_COUNTS}
       FROM exams e JOIN notebooks n ON n.id = e.notebook_id
      WHERE e.id = $1 AND e.user_id = $2 AND ${canAccessNotebook("n", "$2")}`,
    [id, userId]
  );
  return toExam(rows[0]);
}

export async function createExam({ notebookId, userId, name, examDate, unitIds }) {
  const { rows } = await query(
    "INSERT INTO exams (notebook_id, user_id, name, exam_date, unit_ids) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [notebookId, userId, name, examDate, JSON.stringify(unitIds ?? [])]
  );
  return toExam(rows[0]);
}

export async function updateExam(id, { name, examDate, unitIds }) {
  await query(
    `UPDATE exams SET name = COALESCE($2, name), exam_date = COALESCE($3::date, exam_date),
                      unit_ids = COALESCE($4::jsonb, unit_ids), updated_at = NOW()
      WHERE id = $1`,
    [id, name ?? null, examDate ?? null, unitIds === undefined ? null : JSON.stringify(unitIds)]
  );
}

export async function deleteExam(id) {
  await query("DELETE FROM exams WHERE id = $1", [id]);
}

/** Upcoming exams (today or later) of a user across the courses they may open, soonest first. */
export async function upcomingExams(userId, today, limit = 5) {
  const { rows } = await query(
    `SELECT e.*, n.title AS notebook_title, n.emoji AS notebook_emoji, ${EXAM_COUNTS}
       FROM exams e JOIN notebooks n ON n.id = e.notebook_id
      WHERE e.user_id = $1 AND e.exam_date >= $2::date AND ${canAccessNotebook("n", "$1")}
      ORDER BY e.exam_date, e.created_at LIMIT $3`,
    [userId, today, limit]
  );
  return rows.map(toExam);
}

// ---- Plan items ------------------------------------------------------------------

function toItem(r) {
  return {
    id: r.id,
    examId: r.exam_id,
    date: day(r.plan_date),
    position: r.position,
    type: r.task_type,
    unitId: r.unit_id ?? null,
    topicId: r.topic_id ?? null,
    topic: r.topic_name ?? null,
    title: r.title,
    details: r.details ?? null,
    targetCount: r.target_count ?? null,
    done: r.done,
    doneAt: iso(r.done_at),
  };
}

const ITEM_SELECT = `SELECT i.*, t.name AS topic_name FROM exam_plan_items i LEFT JOIN topics t ON t.id = i.topic_id`;

export async function listPlanItems(examId, { from, to } = {}) {
  const values = [examId];
  let range = "";
  if (from) {
    values.push(from);
    range += ` AND i.plan_date >= $${values.length}::date`;
  }
  if (to) {
    values.push(to);
    range += ` AND i.plan_date <= $${values.length}::date`;
  }
  const { rows } = await query(`${ITEM_SELECT} WHERE i.exam_id = $1${range} ORDER BY i.plan_date, i.position`, values);
  return rows.map(toItem);
}

/** Replaces an exam's plan: deletes every task not done (missed ones included), keeps done ones, inserts `items`. */
export async function replacePlan(examId, items) {
  await withTransaction(async (client) => {
    await client.query("DELETE FROM exam_plan_items WHERE exam_id = $1 AND NOT done", [examId]);
    for (const it of items) {
      await client.query(
        `INSERT INTO exam_plan_items (exam_id, plan_date, position, task_type, unit_id, topic_id, title, details, target_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [examId, it.date, it.position, it.type, it.unitId ?? null, it.topicId ?? null, it.title, it.details ?? null, it.targetCount ?? null]
      );
    }
    await client.query("UPDATE exams SET plan_generated_at = NOW(), updated_at = NOW() WHERE id = $1", [examId]);
  });
}

/** Moves items to new dates/positions: [{ id, date, position }]. */
export async function moveItems(moves) {
  await withTransaction(async (client) => {
    for (const m of moves) {
      await client.query("UPDATE exam_plan_items SET plan_date = $2, position = $3 WHERE id = $1", [m.id, m.date, m.position]);
    }
  });
}

export async function deletePlanItems(ids) {
  if (ids.length) await query("DELETE FROM exam_plan_items WHERE id = ANY($1::uuid[])", [ids]);
}

/** A plan item of this user's exam, or null. */
export async function getPlanItem(id, userId) {
  const { rows } = await query(
    `${ITEM_SELECT} JOIN exams e ON e.id = i.exam_id JOIN notebooks n ON n.id = e.notebook_id
      WHERE i.id = $1 AND e.user_id = $2 AND ${canAccessNotebook("n", "$2")}`,
    [id, userId]
  );
  return rows[0] ? toItem(rows[0]) : null;
}

export async function setItemDone(id, done) {
  const { rows } = await query(
    `UPDATE exam_plan_items SET done = $2, done_at = CASE WHEN $2 THEN COALESCE(done_at, NOW()) ELSE NULL END
      WHERE id = $1 RETURNING *`,
    [id, done]
  );
  return rows[0] ? toItem(rows[0]) : null;
}

// ---- Activity, goal and streak -------------------------------------------------------

/** Today's date (YYYY-MM-DD) in a timezone. */
export async function todayIn(tz) {
  const { rows } = await query("SELECT to_char((NOW() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS today", [tz]);
  return rows[0].today;
}

/** Counts one study action (or `n`) for a user today, in their timezone. */
export async function recordActivity(userId, tz, kind, n = 1) {
  await query(
    `INSERT INTO user_activity (user_id, day, kind, count) VALUES ($1, (NOW() AT TIME ZONE $2)::date, $3, $4)
     ON CONFLICT (user_id, day, kind) DO UPDATE SET count = user_activity.count + EXCLUDED.count`,
    [userId, tz, kind, n]
  );
}

/** Daily totals for the last `days` days up to today: [{ day, total, byKind }] (days with activity only). */
export async function activityByDay(userId, today, days = 400) {
  const { rows } = await query(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, kind, count FROM user_activity
      WHERE user_id = $1 AND day > $2::date - $3::int AND day <= $2::date ORDER BY day`,
    [userId, today, days]
  );
  const map = new Map();
  for (const r of rows) {
    const d = map.get(r.day) ?? { day: r.day, total: 0, byKind: {} };
    d.total += r.count;
    d.byKind[r.kind] = (d.byKind[r.kind] ?? 0) + r.count;
    map.set(r.day, d);
  }
  return [...map.values()];
}

export async function getDailyGoal(userId) {
  const { rows } = await query("SELECT daily_goal FROM users WHERE id = $1", [userId]);
  return rows[0]?.daily_goal ?? 20;
}

export async function setDailyGoal(userId, goal) {
  await query("UPDATE users SET daily_goal = $2, updated_at = NOW() WHERE id = $1", [userId, goal]);
}

// ---- Cards due across courses ------------------------------------------------------

/** For each course the user may open: cards due now and new cards not yet started. */
export async function cardsDueByCourse(userId) {
  const { rows } = await query(
    `SELECT n.id, n.title, n.emoji,
            COUNT(c.id) FILTER (WHERE r.card_id IS NOT NULL AND r.due_at <= NOW())::int AS due,
            COUNT(c.id) FILTER (WHERE r.card_id IS NULL)::int AS fresh
       FROM notebooks n
       JOIN decks d ON d.notebook_id = n.id
       JOIN cards c ON c.deck_id = d.id
       LEFT JOIN card_reviews r ON r.card_id = c.id AND r.user_id = $1
      WHERE ${canAccessNotebook("n", "$1")}
      GROUP BY n.id
     HAVING COUNT(c.id) > 0
      ORDER BY 4 DESC, n.updated_at DESC`,
    [userId]
  );
  return rows.map((r) => ({ notebookId: r.id, title: r.title, emoji: r.emoji, due: r.due, fresh: r.fresh }));
}

/** New cards each course has started today for this user: Map notebookId → count. */
export async function newCardsStartedTodayByCourse(userId, tz) {
  const { rows } = await query(
    `SELECT notebook_id, COUNT(*)::int AS count FROM review_log
      WHERE user_id = $1 AND was_new AND reviewed_at >= (date_trunc('day', NOW() AT TIME ZONE $2) AT TIME ZONE $2)
      GROUP BY notebook_id`,
    [userId, tz]
  );
  return new Map(rows.map((r) => [r.notebook_id, r.count]));
}

/** Cards due now / new in some units of a course (null unit = decks without a unit). */
export async function cardsInScope(notebookId, userId, unitIds) {
  const scoped = unitIds?.length ? "AND (d.unit_id = ANY($3::uuid[]) OR ($4 AND d.unit_id IS NULL))" : "";
  const values = [notebookId, userId];
  if (scoped) values.push(unitIds.filter((u) => u !== null), unitIds.includes(null));
  const { rows } = await query(
    `SELECT COUNT(c.id) FILTER (WHERE r.card_id IS NOT NULL AND r.due_at <= NOW())::int AS due,
            COUNT(c.id) FILTER (WHERE r.card_id IS NULL)::int AS fresh,
            COUNT(c.id)::int AS total
       FROM decks d JOIN cards c ON c.deck_id = d.id
       LEFT JOIN card_reviews r ON r.card_id = c.id AND r.user_id = $2
      WHERE d.notebook_id = $1 ${scoped}`,
    values
  );
  return rows[0];
}
