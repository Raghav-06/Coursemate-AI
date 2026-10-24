// Mastery colours and exam-weight bands for knowledge-map nodes.

export const MASTERY = {
  not_started: { label: "Not started", dot: "bg-panel-3 ring-1 ring-line", fill: "rgb(var(--panel-3))", text: "text-ink-3" },
  weak: { label: "Weak", dot: "bg-danger", fill: "rgb(var(--danger) / 0.18)", text: "text-danger" },
  ok: { label: "OK", dot: "bg-gold", fill: "rgb(var(--gold) / 0.22)", text: "text-gold" },
  strong: { label: "Strong", dot: "bg-success", fill: "rgb(var(--success) / 0.2)", text: "text-success" },
};

export function weightBand(weight) {
  if (weight === null || weight === undefined || weight <= 0) return null;
  return weight >= 0.67 ? { label: "High weight", bars: 3 } : weight >= 0.34 ? { label: "Medium weight", bars: 2 } : { label: "Low weight", bars: 1 };
}
