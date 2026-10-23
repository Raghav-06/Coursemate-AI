import { query } from "./pool.js";

// One row per model call (no prompt text): which tier and model did which
// task, how long it took and whether it worked. Feeds Settings → AI usage.

const pending = new Set();

/** Logs a call in the background; logging never fails the call. */
export function logAiCall(call) {
  const job = query(
    `INSERT INTO ai_calls (user_id, notebook_id, tier, model, task, latency_ms, ok, error_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [call.userId ?? null, call.notebookId ?? null, call.tier, call.model ?? null, call.task, Math.round(call.latencyMs), call.ok, call.errorCode ?? null]
  )
    .catch(() => {}) // e.g. scripts running without a database
    .finally(() => pending.delete(job));
  pending.add(job);
}

/** Waits for queued log writes (scripts call this before exiting). */
export async function flushAiLog() {
  await Promise.all([...pending]);
}

/**
 * Settings → AI usage for one user over the last `days` days (days counted in
 * `tz`): totals, per tier, per feature (task), per day, and the latest failed
 * calls. ai_calls stores no token or character counts, so none are reported.
 */
export async function aiUsageReport(userId, days, tz) {
  const values = [userId, days, tz];
  // From the start of the day `days - 1` days ago, in the user's timezone.
  const since = (a = "") => `${a}user_id = $1 AND ${a}created_at >= (date_trunc('day', NOW() AT TIME ZONE $3) - make_interval(days => $2 - 1)) AT TIME ZONE $3`;
  const window = since();
  const stats = "COUNT(*)::int AS calls, COUNT(*) FILTER (WHERE NOT ok)::int AS errors, ROUND(AVG(latency_ms))::int AS avg_ms";
  const [totals, byTier, byTask, byDay, failures] = await Promise.all([
    query(`SELECT ${stats} FROM ai_calls WHERE ${window}`, values),
    query(`SELECT tier, ${stats}, ARRAY_AGG(DISTINCT model) FILTER (WHERE model IS NOT NULL) AS models FROM ai_calls WHERE ${window} GROUP BY tier ORDER BY calls DESC`, values),
    query(`SELECT task, tier, ${stats} FROM ai_calls WHERE ${window} GROUP BY task, tier ORDER BY calls DESC`, values),
    query(
      `SELECT to_char((created_at AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS day, tier, ${stats} FROM ai_calls WHERE ${window} GROUP BY 1, tier ORDER BY 1`,
      values
    ),
    query(
      `SELECT c.created_at, c.tier, c.model, c.task, c.latency_ms, c.error_code, n.title AS course
         FROM ai_calls c LEFT JOIN notebooks n ON n.id = c.notebook_id
        WHERE ${since("c.")} AND NOT c.ok
        ORDER BY c.created_at DESC LIMIT 10`,
      values
    ),
  ]);
  const row = (r) => ({ calls: r.calls, errors: r.errors, avgLatencyMs: r.avg_ms });
  const dayMap = new Map();
  for (const r of byDay.rows) {
    const d = dayMap.get(r.day) ?? { day: r.day, calls: 0, errors: 0, byTier: {} };
    d.calls += r.calls;
    d.errors += r.errors;
    d.byTier[r.tier] = r.calls;
    dayMap.set(r.day, d);
  }
  return {
    days,
    tokensRecorded: false,
    totals: totals.rows[0].calls ? row(totals.rows[0]) : { calls: 0, errors: 0, avgLatencyMs: null },
    byTier: byTier.rows.map((r) => ({ tier: r.tier, models: r.models ?? [], ...row(r) })),
    byFeature: byTask.rows.map((r) => ({ feature: r.task, tier: r.tier, ...row(r) })),
    byDay: [...dayMap.values()],
    recentFailures: failures.rows.map((r) => ({
      at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      tier: r.tier,
      model: r.model,
      feature: r.task,
      latencyMs: r.latency_ms,
      errorCode: r.error_code,
      course: r.course ?? null,
    })),
  };
}

/**
 * A user's AI usage over the last `days` days: per tier and task, calls,
 * average latency and failures (across their courses, plus calls without one).
 */
export async function aiUsage(userId, days = 30) {
  const { rows } = await query(
    `SELECT tier, task, model, COUNT(*)::int AS calls, ROUND(AVG(latency_ms))::int AS avg_ms,
            COUNT(*) FILTER (WHERE NOT ok)::int AS failed
       FROM ai_calls
      WHERE user_id = $1 AND created_at > NOW() - make_interval(days => $2)
      GROUP BY tier, task, model
      ORDER BY tier, calls DESC`,
    [userId, days]
  );
  return rows.map((r) => ({ tier: r.tier, task: r.task, model: r.model, calls: r.calls, avgMs: r.avg_ms, failed: r.failed }));
}
