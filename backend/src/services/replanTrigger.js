import { replanIfDue } from "./weeklyPlan.js";
import { responseLanguage } from "./language.js";
import { getExam, todayIn } from "../db/exams.js";

// When weekly plans are (re)planned: on demand (the routes) and, in the
// background, on the first visit of the day or after new results. One plan
// change runs at a time per exam (in this process's memory).

const locks = new Map(); // examId → promise of the queued / running plan change

/** Runs `fn` after any plan change already running for this exam. */
export function withPlanLock(examId, fn) {
  const job = (locks.get(examId) ?? Promise.resolve()).catch(() => {}).then(fn);
  const tail = job.catch(() => {}).finally(() => {
    if (locks.get(examId) === tail) locks.delete(examId);
  });
  locks.set(examId, tail);
  return job;
}

export const isReplanning = (examId) => locks.has(examId);

/** Today's date (YYYY-MM-DD) in a timezone, without a database round trip (UTC if the zone is unknown). */
function localDate(tz) {
  const format = (timeZone) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  try {
    return format(tz || "UTC");
  } catch {
    return format("UTC");
  }
}

/** "Today" for an exam: in its saved timezone, else the browser's. */
export const examToday = (exam, tz) => todayIn(exam.timezone || tz || "UTC");

/**
 * Starts today's replan of a weekly-plan exam in the background when it's due
 * (not replanned today yet, or marked due by new results). Never throws and
 * never waits; failures are logged. Returns true if a replan was started.
 */
export function replanInBackground(exam, userId, tz) {
  if (exam.planKind !== "weekly" || !exam.weekStart || isReplanning(exam.id)) return false;
  const today = localDate(exam.timezone || tz);
  if (!exam.replanDue && exam.lastReplannedOn && exam.lastReplannedOn >= today) return false;
  withPlanLock(exam.id, async () => {
    const today = await examToday(exam, tz);
    // Re-read: another request may have replanned while this one waited.
    const fresh = await getExam(exam.id, userId);
    if (!fresh || fresh.planKind !== "weekly" || !fresh.weekStart || today >= fresh.examDate) return;
    if (!fresh.replanDue && fresh.lastReplannedOn && fresh.lastReplannedOn >= today) return;
    await replanIfDue(fresh, userId, today, { language: await responseLanguage(userId, fresh.notebookId), force: fresh.replanDue });
  }).catch((err) => console.warn(`Background replan of exam ${exam.id} failed: ${err.message}`));
  return true;
}
