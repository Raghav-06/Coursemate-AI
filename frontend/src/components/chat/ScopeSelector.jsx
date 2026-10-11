import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui";

/**
 * "Whole course" or a set of units the chat retrieves from. `scope` is an
 * array of unit ids ("general" = sources without a unit); empty = whole course.
 */
export default function ScopeSelector({ units, sources, scope, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unitIds = new Set(units.map((u) => u.id));
  const hasGeneral = sources.some((s) => !s.unitId || !unitIds.has(s.unitId));
  const options = [...units.map((u) => ({ id: u.id, title: u.title })), ...(hasGeneral ? [{ id: "general", title: "General" }] : [])];
  const countFor = (id) => sources.filter((s) => s.status === "ready" && (id === "general" ? !s.unitId || !unitIds.has(s.unitId) : s.unitId === id)).length;

  const active = scope.filter((id) => options.some((o) => o.id === id));
  const label =
    active.length === 0 ? "Whole course" : active.length === 1 ? options.find((o) => o.id === active[0]).title : `${active.length} units`;

  const toggle = (id) => onChange(active.includes(id) ? active.filter((x) => x !== id) : [...active, id]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`inline-flex items-center gap-1.5 h-8 max-w-[260px] pl-2.5 pr-2 rounded-full border text-xs font-medium transition-colors ${
          active.length ? "border-accent bg-accent-soft text-accent-soft-fg" : "border-line text-ink-2 hover:bg-panel-2"
        }`}
        title="Choose which units the answer comes from"
      >
        <Icon name="filter_alt" size={16} />
        <span className="truncate">{label}</span>
        <Icon name={open ? "expand_less" : "expand_more"} size={16} />
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 mb-2 z-40 w-72 max-h-80 overflow-y-auto scroll-thin rounded-2xl bg-panel-2 border border-line shadow-pop py-2 animate-fade-in">
          <p className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Answer from</p>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={active.length === 0}
            onClick={() => {
              onChange([]);
              setOpen(false);
            }}
            className="w-full flex items-center gap-3 px-4 h-10 text-sm text-left hover:bg-panel-3"
          >
            <Icon name={active.length === 0 ? "radio_button_checked" : "radio_button_unchecked"} size={18} className={active.length === 0 ? "text-accent" : "text-ink-3"} />
            Whole course
          </button>
          <div className="my-1 border-t border-line/60" />
          {options.map((o) => (
            <label key={o.id} className="flex items-center gap-3 px-4 h-10 text-sm cursor-pointer hover:bg-panel-3">
              <input type="checkbox" checked={active.includes(o.id)} onChange={() => toggle(o.id)} className="w-4 h-4 accent-[rgb(var(--accent))]" />
              <span className="flex-1 truncate">{o.title}</span>
              <span className="text-xs text-ink-3">{countFor(o.id)}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
