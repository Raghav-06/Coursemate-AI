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
