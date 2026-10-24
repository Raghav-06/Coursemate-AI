// Helpers shared by the UI components (kept apart from ui.jsx so it only exports components).

// Simple global toast: call toast("message") from anywhere; the Toaster shows it.
const listeners = new Set();
export function toast(message, tone = "info") {
  const item = { id: Math.random(), message, tone };
  listeners.forEach((fn) => fn(item));
}

/** Calls `fn(item)` for each new toast; returns the unsubscribe function. */
export function onToast(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function copyText(text) {
  navigator.clipboard?.writeText(text).then(
    () => toast("Copied to clipboard"),
    () => toast("Couldn't copy to clipboard", "error")
  );
}

export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export function timeAgo(iso) {
  const date = new Date(iso);
  const seconds = (Date.now() - date) / 1000;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
