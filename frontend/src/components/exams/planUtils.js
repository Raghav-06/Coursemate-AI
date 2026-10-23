// Shared helpers for revision plans (dates are "YYYY-MM-DD", shown in local time).

export const TASK_META = {
  read: { icon: "menu_book", label: "Read", start: "Ask chat" },
  flashcards: { icon: "style", label: "Flashcards", start: "Review" },
  quiz: { icon: "quiz", label: "Quiz", start: "Start quiz" },
  answer: { icon: "edit_note", label: "Answer writing", start: "Write" },
  past_paper: { icon: "history_edu", label: "Past paper", start: "Open questions" },
  // Weekly plan (agent) tasks
  learn: { icon: "menu_book", label: "Learn", start: "Ask chat" },
  drill: { icon: "fitness_center", label: "Drill", start: "Start" },
  timed_test: { icon: "timer", label: "Timed test", start: "Start" },
  revise_mistakes: { icon: "build", label: "Fix mistakes", start: "Start" },
  mock: { icon: "assignment", label: "Full mock", start: "Start" },
};

// Weekly-plan tasks that open a practice session (POST /api/plan-items/:id/start).
export const SESSION_TASKS = ["drill", "timed_test", "mock", "revise_mistakes"];

export const WEEKDAYS = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
];

export const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const formatMinutes = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);

const localDate = (iso) => new Date(`${iso}T00:00:00`);

export const formatDay = (iso, opts = { weekday: "short", day: "numeric", month: "short" }) => localDate(iso).toLocaleDateString(undefined, opts);

export const dayDiff = (from, to) => Math.round((localDate(to) - localDate(from)) / 86_400_000);

export function countdown(daysLeft) {
  if (daysLeft <= 0) return "Today";
  if (daysLeft === 1) return "Tomorrow";
  return `In ${daysLeft} days`;
}
