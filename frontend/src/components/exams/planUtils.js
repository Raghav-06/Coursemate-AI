// Shared helpers for revision plans (dates are "YYYY-MM-DD", shown in local time).

export const TASK_META = {
  read: { icon: "menu_book", label: "Read", start: "Ask chat" },
  flashcards: { icon: "style", label: "Flashcards", start: "Review" },
  quiz: { icon: "quiz", label: "Quiz", start: "Start quiz" },
  answer: { icon: "edit_note", label: "Answer writing", start: "Write" },
  past_paper: { icon: "history_edu", label: "Past paper", start: "Open questions" },
};

const localDate = (iso) => new Date(`${iso}T00:00:00`);

export const formatDay = (iso, opts = { weekday: "short", day: "numeric", month: "short" }) => localDate(iso).toLocaleDateString(undefined, opts);

export const dayDiff = (from, to) => Math.round((localDate(to) - localDate(from)) / 86_400_000);

export function countdown(daysLeft) {
  if (daysLeft <= 0) return "Today";
  if (daysLeft === 1) return "Tomorrow";
  return `In ${daysLeft} days`;
}
