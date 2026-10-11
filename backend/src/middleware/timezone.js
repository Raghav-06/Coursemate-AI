import { query } from "../db/pool.js";

// The browser sends its IANA timezone in X-Timezone so "today" (new-card
// caps, daily goals, streaks) follows the user's day. Only names PostgreSQL
// knows are accepted; anything else falls back to UTC.
let known = null;
async function knownZones() {
  if (!known) {
    const { rows } = await query("SELECT name FROM pg_timezone_names");
    known = new Set(rows.map((r) => r.name));
  }
  return known;
}

export async function timezone(req, _res, next) {
  try {
    const value = String(req.get("x-timezone") ?? "").trim();
    req.tz = value && value.length <= 64 && (await knownZones()).has(value) ? value : "UTC";
    next();
  } catch (err) {
    next(err);
  }
}
