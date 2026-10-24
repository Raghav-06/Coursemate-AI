import { useMemo, useState } from "react";
import { Checkbox, Icon } from "../ui";
import { MASTERY, weightBand } from "../map/mapUtils";

/**
 * Picks knowledge-map nodes (chapters and topics, up to `max`), grouped by
 * chapter, with mastery dots and weight. `value`: selected node ids.
 */
export default function NodePicker({ nodes, value, onChange, max = 5 }) {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const chapters = nodes.filter((n) => n.level === "chapter");
    const q = query.trim().toLowerCase();
    return chapters
      .map((c) => ({ chapter: c, topics: nodes.filter((n) => n.parentId === c.id && n.level === "topic" && (!q || n.name.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))) }))
      .filter((g) => g.topics.length || (!q ? false : g.chapter.name.toLowerCase().includes(q)));
  }, [nodes, query]);
  const toggle = (id) => onChange(value.includes(id) ? value.filter((v) => v !== id) : value.length >= max ? value : [...value, id]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Icon name="search" size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input className="input pl-9!" placeholder="Find a chapter or topic" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a topic" />
      </div>
      <p className="text-xs text-ink-3">
        {value.length}/{max} picked
      </p>
      <div className="max-h-72 overflow-y-auto scroll-thin rounded-xl border border-line divide-y divide-line/60">
        {groups.length === 0 && <p className="p-3 text-sm text-ink-3">Nothing matches.</p>}
        {groups.map(({ chapter, topics }) => (
          <div key={chapter.id} className="py-1">
            <label className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer">
              <Checkbox checked={value.includes(chapter.id)} onChange={() => toggle(chapter.id)} label={`Whole chapter: ${chapter.name}`} />
              <span className="text-sm font-semibold flex-1 min-w-0 truncate">{chapter.name}</span>
              <span className="text-[11px] text-ink-3">whole chapter</span>
            </label>
            {topics.map((t) => (
              <label key={t.id} className="flex items-center gap-2.5 pl-8 pr-3 py-1.5 cursor-pointer hover:bg-panel-2">
                <Checkbox checked={value.includes(t.id)} onChange={() => toggle(t.id)} label={t.name} />
                <span className={`w-2 h-2 rounded-full shrink-0 ${MASTERY[t.mastery?.status ?? "not_started"].dot}`} />
                <span className="text-sm flex-1 min-w-0 truncate">{t.name}</span>
                {weightBand(t.weight) && <span className="text-[11px] text-ink-3 max-sm:hidden">{weightBand(t.weight).label}</span>}
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
