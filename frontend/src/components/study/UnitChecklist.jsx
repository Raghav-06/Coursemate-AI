/**
 * Picks units to generate from. `value` is an array of unit ids
 * ("general" = sources without a unit); empty = the whole course.
 */
export default function UnitChecklist({ units, sources, value, onChange }) {
  const unitIds = new Set(units.map((u) => u.id));
  const ready = sources.filter((s) => s.status === "ready");
  const countFor = (id) => ready.filter((s) => (id === "general" ? !s.unitId || !unitIds.has(s.unitId) : s.unitId === id)).length;
  const options = [...units.map((u) => [u.id, u.title]), ...(countFor("general") > 0 ? [["general", "General"]] : [])];

  if (units.length === 0) return <p className="text-sm text-ink-3">From all {ready.length} ready sources in this course.</p>;

  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="flex flex-col rounded-xl border border-line divide-y divide-line/60 max-h-56 overflow-y-auto scroll-thin">
      <label className="flex items-center gap-3 px-3 h-10 text-sm cursor-pointer hover:bg-panel-2">
        <input type="checkbox" checked={value.length === 0} onChange={() => onChange([])} className="w-4 h-4 accent-[rgb(var(--accent))]" />
        <span className="flex-1 font-medium">Whole course</span>
        <span className="text-xs text-ink-3">{ready.length}</span>
      </label>
      {options.map(([id, title]) => (
        <label key={id} className="flex items-center gap-3 px-3 h-10 text-sm cursor-pointer hover:bg-panel-2">
          <input type="checkbox" checked={value.includes(id)} onChange={() => toggle(id)} className="w-4 h-4 accent-[rgb(var(--accent))]" />
          <span className="flex-1 truncate">{title}</span>
          <span className="text-xs text-ink-3">{countFor(id)}</span>
        </label>
      ))}
    </div>
  );
}
