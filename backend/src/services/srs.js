// SM-2 spaced repetition with four buttons (as in Anki):
//   again — forgot: back to the start, shown again in 10 minutes, ease -0.20
//           (a lapse; no penalty while the card is still being learned)
//   hard  — recalled with effort: SM-2 quality 3 (ease -0.14), interval ×1.2
//   good  — recalled: SM-2 quality 4 (ease unchanged), interval ×ease
//   easy  — effortless: SM-2 quality 5 (ease +0.10), interval ×ease×1.3
// First successful review: 1 day (easy: 4); second: 6 days (hard: 3, easy: 8).

export const RATINGS = ["again", "hard", "good", "easy"];

const MIN_EASE = 1.3;
const RELEARN_MINUTES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const NEW_STATE = { ease: 2.5, intervalDays: 0, repetitions: 0, lapses: 0 };

// SM-2 ease update for quality q (0-5).
const easeAfter = (ease, q) => Math.max(MIN_EASE, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

/** The user's state after rating a card; `state` is null for a new card. */
export function schedule(state, rating, now = new Date()) {
  const s = { ...NEW_STATE, ...(state ?? {}) };
  if (rating === "again") {
    // Forgetting a learned card is a lapse and costs ease; failing one still
    // being learned (no successful review yet) costs nothing.
    const lapsed = s.repetitions > 0;
    return {
      ease: lapsed ? Math.round(Math.max(MIN_EASE, s.ease - 0.2) * 100) / 100 : s.ease,
      intervalDays: 0,
      repetitions: 0,
      lapses: lapsed ? s.lapses + 1 : s.lapses,
      dueAt: new Date(now.getTime() + RELEARN_MINUTES * 60 * 1000).toISOString(),
    };
  }

  const quality = { hard: 3, good: 4, easy: 5 }[rating];
  if (!quality) throw Object.assign(new Error(`Rating must be one of ${RATINGS.join(", ")}.`), { status: 400 });
  const ease = easeAfter(s.ease, quality);

  let interval;
  if (s.repetitions === 0) interval = rating === "easy" ? 4 : 1;
  else if (s.repetitions === 1) interval = { hard: 3, good: 6, easy: 8 }[rating];
  else {
    const prev = Math.max(1, s.intervalDays);
    interval = rating === "hard" ? prev * 1.2 : rating === "good" ? prev * ease : prev * ease * 1.3;
    interval = Math.max(prev + 1, interval); // always move forward
  }
  interval = Math.round(interval);

  return {
    ease: Math.round(ease * 100) / 100,
    intervalDays: interval,
    repetitions: s.repetitions + 1,
    lapses: s.lapses,
    dueAt: new Date(now.getTime() + interval * DAY_MS).toISOString(),
  };
}

/** Human label for the wait until the next review: "10m", "1d", "3w", "4mo", "1.2y". */
export function intervalLabel(next, now = new Date()) {
  const minutes = Math.round((new Date(next.dueAt) - now) / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const days = next.intervalDays;
  if (days < 1) return `${Math.round(minutes / 60)}h`;
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round((days / 365) * 10) / 10}y`;
}

/** What each rating would do: { again: "10m", hard: "1d", good: "1d", easy: "4d" }. */
export function previewIntervals(state, now = new Date()) {
  return Object.fromEntries(RATINGS.map((r) => [r, intervalLabel(schedule(state, r, now), now)]));
}
