/** Horizontal bar for a 0-1 mastery/accuracy value; null = not practised yet. */
export default function MasteryBar({ value, className = "" }) {
  if (value === null || value === undefined) {
    return <div className={`h-2 rounded-full bg-panel-3 ${className}`} title="Not practised yet" />;
  }
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const tone = value >= 0.7 ? "bg-success" : value >= 0.4 ? "bg-amber-400" : "bg-danger";
  return (
    <div className={`h-2 rounded-full bg-panel-3 overflow-hidden ${className}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${pct}%`}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(4, pct)}%` }} />
    </div>
  );
}
