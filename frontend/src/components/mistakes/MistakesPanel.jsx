import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { Icon, Segmented, Spinner, timeAgo, toast } from "../ui";
import DiagnosisCard, { CategoryBadge } from "./DiagnosisCard";
import { ADVICE, CATEGORY, CATEGORY_KEYS } from "./categories";

const weekLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** Mistakes by category per week: stacked bars (2px gaps, hover tooltip) or a table. */
function WeeklyChart({ weeks }) {
  const [hover, setHover] = useState(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(1, ...weeks.map((w) => CATEGORY_KEYS.reduce((s, k) => s + w[k], 0)));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-label="Legend">
          {CATEGORY_KEYS.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: CATEGORY[k].color }} /> {CATEGORY[k].label}
            </span>
          ))}
        </div>
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => setAsTable((t) => !t)}>
          {asTable ? "Show chart" : "Show as table"}
        </button>
      </div>
      {asTable ? (
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-ink-3">
                <th className="py-1 pr-3 font-medium">Week of</th>
                {CATEGORY_KEYS.map((k) => (
                  <th key={k} className="py-1 pr-3 font-medium">
                    {CATEGORY[k].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.week} className="border-t border-line/60">
                  <td className="py-1 pr-3 whitespace-nowrap">{weekLabel(w.week)}</td>
                  {CATEGORY_KEYS.map((k) => (
                    <td key={k} className="py-1 pr-3">
                      {w[k]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <div className="flex items-end gap-2 sm:gap-3 h-40 border-b border-line">
            {weeks.map((w) => {
              const total = CATEGORY_KEYS.reduce((s, k) => s + w[k], 0);
              return (
                <div
                  key={w.week}
                  className="flex-1 h-full flex flex-col justify-end cursor-default"
                  onMouseEnter={() => setHover(w)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(w)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  aria-label={`Week of ${weekLabel(w.week)}: ${CATEGORY_KEYS.map((k) => `${w[k]} ${CATEGORY[k].label.toLowerCase()}`).join(", ")}`}
                >
                  <div className="flex flex-col-reverse gap-[2px]" style={{ height: `${(total / max) * 100}%` }}>
                    {CATEGORY_KEYS.filter((k) => w[k]).map((k, i, list) => (
                      <div key={k} className={i === list.length - 1 ? "rounded-t" : ""} style={{ background: CATEGORY[k].color, flexGrow: w[k], minHeight: 3 }} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-2 sm:gap-3 mt-1">
            {weeks.map((w, i) => (
              <span key={w.week} className="flex-1 text-center text-[11px] text-ink-3 truncate">
                {i % 2 === weeks.length % 2 || weeks.length < 6 ? weekLabel(w.week) : ""}
              </span>
            ))}
          </div>
          {hover && (
            <div className="absolute top-0 right-0 rounded-xl bg-panel-2 border border-line shadow-pop px-3 py-2 text-xs pointer-events-none">
              <p className="font-semibold mb-1">Week of {weekLabel(hover.week)}</p>
              {CATEGORY_KEYS.map((k) => (
                <p key={k} className="flex items-center gap-1.5 text-ink-2">
                  <span className="w-2 h-2 rounded-sm" style={{ background: CATEGORY[k].color }} /> {CATEGORY[k].label}: <b className="text-ink tabular-nums">{hover[k]}</b>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FixButton({ diagnosisId, onPlaySession, label = "Fix this" }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn-outline h-8 px-3 text-xs shrink-0"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          onPlaySession((await api.practiseDiagnosis(diagnosisId)).id);
        } catch (err) {
          toast(err.message, "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Spinner /> : <Icon name="healing" size={16} />} {label}
    </button>
  );
}

function RecentItem({ d, onOpenCitation, onPlaySession }) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(null);
  const toggle = async () => {
    setOpen((o) => !o);
    if (!full) api.getDiagnosis(d.id).then(setFull, (err) => toast(err.message, "error"));
  };
  return (
    <div className="rounded-2xl border border-line bg-panel">
      <button type="button" className="w-full flex items-center gap-3 p-3 text-left" onClick={toggle} aria-expanded={open}>
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CATEGORY[d.category]?.color ?? "rgb(var(--panel-3))" }} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm truncate">{d.misconception ?? (d.status === "pending" ? "Diagnosing…" : "No diagnosis")}</span>
          <span className="block text-xs text-ink-3 truncate">
            {d.sessionTitle} · Q{d.position + 1} · {timeAgo(d.createdAt)}
            {d.marksLost ? ` · −${d.marksLost} marks` : ""}
          </span>
        </span>
        <Icon name={open ? "expand_less" : "expand_more"} size={20} className="text-ink-3" />
      </button>
      {open && (
        <div className="px-3 pb-3">
          {full ? <DiagnosisCard diagnosis={full} citations={full.citations} onOpenCitation={onOpenCitation} onPractise={(s) => onPlaySession(s.id)} advice={ADVICE} /> : <Spinner className="w-4 h-4 text-ink-3" />}
        </div>
      )}
    </div>
  );
}

/**
 * The Mistakes dashboard: why marks are lost (concept gap / careless / time
 * pressure) over time, the top misconceptions, the topics costing the most
 * marks, and "Fix this" targeted practice.
 */
export default function MistakesPanel({ notebook, onOpenCitation, onPlaySession }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [focus, setFocus] = useState("all");
  const load = useCallback(() => api.mistakes(notebook.id).then(setData, (err) => setError(err.message)), [notebook.id]);
  useEffect(() => {
    load();
  }, [load]);

  const maxLost = Math.max(1, ...(data?.costlyNodes ?? []).map((c) => c.lostMarks));
  const misconceptions = (data?.topMisconceptions ?? []).filter((m) => focus === "all" || m.category === focus);

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
        <div>
          <h2 className="font-display text-xl font-semibold">Mistakes</h2>
          <p className="text-sm text-ink-3">Why you lose marks — diagnosed after every practice session.</p>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        {!data && !error && <Spinner className="w-6 h-6 text-ink-3" />}
        {data && data.total === 0 && (
          <div className="flex flex-col items-center text-center gap-3 py-12 px-6 rounded-3xl border border-dashed border-line">
            <Icon name="troubleshoot" size={36} className="text-ink-3" />
            <p className="text-sm font-medium text-ink-2">No diagnosed mistakes yet</p>
            <p className="text-xs text-ink-3 max-w-sm leading-5">Take a practice session or mock in Practice → Exam practice. Every wrong answer is diagnosed as a concept gap, a careless error or time pressure, with what to fix.</p>
          </div>
        )}
        {data && data.total > 0 && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {CATEGORY_KEYS.map((k) => (
                <div key={k} className="rounded-2xl bg-panel-2 p-4 flex flex-col gap-1.5">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: CATEGORY[k].color }} /> {CATEGORY[k].label}
                  </p>
                  <p className="font-display text-3xl font-semibold tabular-nums">
                    {data.totals[k]}
                    <span className="text-sm font-sans font-normal text-ink-3"> · {Math.round((data.totals[k] / data.total) * 100)}%</span>
                  </p>
                  <p className="text-xs text-ink-3 leading-5">{data.advice[k].text}</p>
                </div>
              ))}
            </div>

            <section className="rounded-2xl border border-line p-4 sm:p-5">
              <h3 className="text-sm font-semibold mb-3">Mistakes per week</h3>
              <WeeklyChart weeks={data.byWeek} />
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Top misconceptions</h3>
                <div className="max-w-full overflow-x-auto scroll-thin">
                  <Segmented label="Category" value={focus} onChange={setFocus} options={[["all", "All"], ...CATEGORY_KEYS.map((k) => [k, CATEGORY[k].label])]} />
                </div>
              </div>
              {misconceptions.length === 0 && <p className="text-sm text-ink-3">None in this category.</p>}
              {misconceptions.map((m) => (
                <div key={m.diagnosisId} className="flex items-start gap-3 p-4 rounded-2xl border border-line bg-panel">
                  <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                    <p className="text-sm font-medium leading-6">{m.misconception}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                      <CategoryBadge category={m.category} />
                      <span>
                        {m.count}× · {m.nodes.join(", ")} · last {timeAgo(m.lastSeen)}
                      </span>
                    </div>
                  </div>
                  <FixButton diagnosisId={m.diagnosisId} onPlaySession={onPlaySession} />
                </div>
              ))}
            </section>

            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold">Topics costing the most marks</h3>
              <div className="rounded-2xl border border-line divide-y divide-line/60">
                {data.costlyNodes.map((c) => (
                  <div key={c.nodeId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-[140px]">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-xs text-ink-3">
                        {c.mistakes} mistake{c.mistakes === 1 ? "" : "s"} ·{" "}
                        {CATEGORY_KEYS.filter((k) => c.categories[k])
                          .map((k) => `${c.categories[k]} ${CATEGORY[k].label.toLowerCase()}`)
                          .join(", ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-24 sm:w-32 h-2 rounded-full bg-panel-3 overflow-hidden" aria-hidden="true">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${(c.lostMarks / maxLost) * 100}%` }} />
                      </div>
                      <span className="w-16 text-right text-sm font-semibold tabular-nums">−{c.lostMarks}</span>
                    </div>
                    <FixButton diagnosisId={c.diagnosisId} onPlaySession={onPlaySession} />
                  </div>
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Recent diagnoses</h3>
              {data.recent.map((d) => (
                <RecentItem key={d.id} d={d} onOpenCitation={onOpenCitation} onPlaySession={onPlaySession} />
              ))}
              {data.flagged > 0 && <p className="text-xs text-ink-3">{data.flagged} diagnosis{data.flagged === 1 ? "" : "es"} you flagged as not right are left out of the numbers above.</p>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
