import { config } from "../config/index.js";
import { addDays, daysBetween } from "./examPlan.js";
import {
  activityByDay,
  cardsDueByCourse,
  getDailyGoal,
  listPlanItems,
  newCardsStartedTodayByCourse,
  todayIn,
  upcomingExams,
} from "../db/exams.js";

// The "Today" panel: daily goal progress, streak, the next exam with today's
// tasks, and flashcards due across courses.

/**
 * Streaks from daily totals: `current` counts consecutive days meeting the
 * goal up to today (today only once it's met — until then the streak runs to
 * yesterday), `best` is the longest run in the window.
 */
export function streaks(days, today, goal) {
  const met = new Set(days.filter((d) => d.total >= goal).map((d) => d.day));
  let current = 0;
  for (let d = met.has(today) ? today : addDays(today, -1); met.has(d); d = addDays(d, -1)) current += 1;
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of [...met].sort()) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best: Math.max(best, current) };
}

export async function todaySummary(userId, tz) {
  const today = await todayIn(tz);
  const [goal, days, exams, due, startedToday] = await Promise.all([
    getDailyGoal(userId),
    activityByDay(userId, today),
    upcomingExams(userId, today),
    cardsDueByCourse(userId),
    newCardsStartedTodayByCourse(userId, tz),
  ]);
  const todays = days.find((d) => d.day === today) ?? { total: 0, byKind: {} };
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i - 6);
    return { day, total: days.find((d) => d.day === day)?.total ?? 0 };
  });

  let nextExam = null;
  if (exams[0]) {
    const items = await listPlanItems(exams[0].id, { to: today });
    nextExam = {
      ...exams[0],
      daysLeft: daysBetween(today, exams[0].examDate),
      todayTasks: items.filter((i) => i.date === today),
      missedCount: items.filter((i) => i.date < today && !i.done && i.type !== "flashcards").length,
    };
  }

  const cardsDue = due
    .map((c) => ({ ...c, newToday: Math.min(c.fresh, Math.max(0, config.limits.newCardsPerDay - (startedToday.get(c.notebookId) ?? 0))) }))
    .map((c) => ({ ...c, total: c.due + c.newToday }))
    .filter((c) => c.total > 0);

  return {
    today,
    goal,
    done: todays.total,
    byKind: todays.byKind,
    streak: streaks(days, today, goal),
    last7,
    nextExam,
    upcomingExams: exams.map((e) => ({ ...e, daysLeft: daysBetween(today, e.examDate) })),
    cardsDue,
    cardsDueTotal: cardsDue.reduce((s, c) => s + c.total, 0),
  };
}
