import { useEffect, useState } from "react";
import { api } from "../api";
import { Icon, Segmented, Spinner } from "./ui";

// Tier colours: the categorical palette validated for the Mistakes chart (index.css --cat-*);
// every other tier (chat default, vision, transcription) is grey "Other".
const TIERS = [
  ["nano", "Nano", "rgb(var(--cat-1))"],
  ["super", "Super", "rgb(var(--cat-2))"],
  ["ultra", "Ultra", "rgb(var(--cat-3))"],
  ["other", "Other", "rgb(var(--ink-3))"],
];
const MAIN_TIERS = ["nano", "super", "ultra"];
const tierKey = (t) => (MAIN_TIERS.includes(t) ? t : "other");

const FEATURE_NAMES = {
  chat: "Chat",
  weekly_plan: "Weekly plan",
  replan_daily: "Daily replan",
  diagnose_mistake: "Mistake diagnosis",
  build_knowledge_map: "Knowledge map",
  generate_questions: "Question writing",
  self_check: "Self-check solve",
  grade_objective: "Grading (objective)",
  grade_descriptive: "Grading (descriptive)",
  tag_topics: "Topic tagging",
  classify_source: "Sorting uploads",
};
const featureName = (f) => FEATURE_NAMES[f] ?? f.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const ms = (v) => (v === null || v === undefined ? "—" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);

/** Every day of the window, oldest first (days without calls included). */
function windowDays(byDay, days) {
  const map = new Map(byDay.map((d) => [d.day, d]));
  // Ends today (the browser's day, as YYYY-MM-DD), or on the last day with calls if the server's day is ahead.
  const today = new Date().toLocaleDateString("en-CA");
  const last = byDay.at(-1)?.day;
  const end = new Date(`${last && last > today ? last : today}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - (days - 1 - i));
    const key = d.toISOString().slice(0, 10);
    const row = map.get(key);
    const byTier = { nano: 0, super: 0, ultra: 0, other: 0 };
    for (const [t, n] of Object.entries(row?.byTier ?? {})) byTier[tierKey(t)] += n;
    return { day: key, calls: row?.calls ?? 0, errors: row?.errors ?? 0, byTier };
  });
}

function DayChart({ days }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...days.map((d) => d.calls));
  const label = (iso, opts = { day: "numeric", month: "short" }) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, opts);
  const shown = hover !== null ? days[hover] : null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-3 h-4">
        {shown
          ? `${label(shown.day, { weekday: "short", day: "numeric", month: "short" })}: ${shown.calls} call${shown.calls === 1 ? "" : "s"}${shown.errors ? `, ${shown.errors} failed` : ""}${
              shown.calls ? ` (${TIERS.filter(([k]) => shown.byTier[k]).map(([k, name]) => `${name} ${shown.byTier[k]}`).join(", ")})` : ""
            }`
          : `Most in a day: ${max}`}
      </p>
      <div className="flex items-end gap-px sm:gap-0.5 h-32 border-b border-line" role="img" aria-label="AI calls per day by tier (table below)">
        {days.map((d, i) => (
          <div
            key={d.day}
            className="flex-1 min-w-0 h-full flex flex-col-reverse cursor-default"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            title={`${d.day}: ${d.calls}`}
          >
            {TIERS.map(([k, , color]) =>
              d.byTier[k] ? <div key={k} style={{ height: `${(d.byTier[k] / max) * 100}%`, background: color }} className={`w-full ${hover === i ? "opacity-80" : ""}`} /> : null
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-ink-3 tabular-nums">
        <span>{label(days[0].day)}</span>
        <span>{label(days[days.length - 1].day)}</span>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        {TIERS.map(([k, name, color]) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} aria-hidden="true" /> {name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Settings → AI usage: the signed-in user's model calls by tier, feature and day, and recent failures. */
export default function AiUsage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [table, setTable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.aiUsage(days).then(
      (d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      },
      (err) => !cancelled && setError(err.message)
    );
    return () => {
      cancelled = true;
    };
  }, [days]);

  const view = data?.days === days ? data : null;

  return (
    <div className="flex flex-col gap-5">
      <Segmented
        label="Period"
        value={String(days)}
        onChange={(v) => setDays(Number(v))}
        options={[
          ["7", "7 days"],
          ["30", "30 days"],
          ["90", "90 days"],
        ]}
      />
      {error && <p className="text-sm text-danger">{error}</p>}
      {!view && !error && <Spinner className="w-5 h-5 text-ink-3" />}
      {view && view.totals.calls === 0 && (
        <p className="text-sm text-ink-3">No AI calls in the last {days} days. They show up here as you chat, practise and plan.</p>
      )}
      {view && view.totals.calls > 0 && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              ["Calls", view.totals.calls],
              ["Failed", `${view.totals.errors}${view.totals.calls ? ` (${Math.round((view.totals.errors / view.totals.calls) * 100)}%)` : ""}`],
              ["Avg. latency", ms(view.totals.avgLatencyMs)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-panel-2 px-3 py-2.5">
                <p className="text-xs text-ink-3">{label}</p>
                <p className="text-lg font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">By tier</h3>
            <ul className="grid sm:grid-cols-3 gap-3">
              {MAIN_TIERS.map((t) => {
                const row = view.byTier.find((r) => r.tier === t);
                const [, name, color] = TIERS.find(([k]) => k === t);
                return (
                  <li key={t} className="rounded-xl border border-line px-3 py-2.5">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} aria-hidden="true" /> {name}
                    </p>
                    <p className="text-xs text-ink-2 mt-1 tabular-nums">
                      {row?.calls ?? 0} call{row?.calls === 1 ? "" : "s"} · {row?.errors ?? 0} failed · {ms(row?.avgLatencyMs)}
                    </p>
                    {row?.models?.length > 0 && (
                      <p className="text-xs font-mono text-ink-3 truncate" title={row.models.join(", ")}>
                        {row.models.join(", ")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            {view.byTier.some((r) => !MAIN_TIERS.includes(r.tier)) && (
              <p className="text-xs text-ink-3">
                Other:{" "}
                {view.byTier
                  .filter((r) => !MAIN_TIERS.includes(r.tier))
                  .map((r) => `${r.tier === "default" ? "chat model" : r.tier} ${r.calls} calls (${r.errors} failed, ${ms(r.avgLatencyMs)})`)
                  .join(" · ")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold mr-auto">Per day</h3>
              <button type="button" className="text-xs text-ink-2 hover:text-ink flex items-center gap-1" onClick={() => setTable((v) => !v)}>
                <Icon name={table ? "bar_chart" : "table_rows"} size={16} /> {table ? "Chart" : "Table"}
              </button>
            </div>
            {table ? (
              <div className="max-h-64 overflow-y-auto scroll-thin rounded-xl border border-line">
                <table className="w-full text-xs tabular-nums">
                  <thead className="text-ink-3 text-left sticky top-0 bg-panel">
                    <tr>
                      <th className="px-3 py-2 font-medium">Day</th>
                      {TIERS.map(([k, name]) => (
                        <th key={k} className="px-2 py-2 font-medium text-right">
                          {name}
                        </th>
                      ))}
                      <th className="px-3 py-2 font-medium text-right">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {windowDays(view.byDay, days)
                      .filter((d) => d.calls)
                      .reverse()
                      .map((d) => (
                        <tr key={d.day} className="border-t border-line/70">
                          <td className="px-3 py-1.5">{d.day}</td>
                          {TIERS.map(([k]) => (
                            <td key={k} className="px-2 py-1.5 text-right">
                              {d.byTier[k] || ""}
                            </td>
                          ))}
                          <td className="px-3 py-1.5 text-right">{d.errors || ""}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <DayChart days={windowDays(view.byDay, days)} />
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">By feature</h3>
            <ul className="flex flex-col divide-y divide-line/70 text-sm">
              {view.byFeature.slice(0, 12).map((f) => (
                <li key={`${f.feature}:${f.tier}`} className="flex items-center gap-3 py-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TIERS.find(([k]) => k === tierKey(f.tier))[2] }} aria-hidden="true" />
                  <span className="flex-1 min-w-0 truncate">{featureName(f.feature)}</span>
                  <span className="text-xs text-ink-3 tabular-nums shrink-0">
                    {f.calls} · {f.errors ? `${f.errors} failed · ` : ""}
                    {ms(f.avgLatencyMs)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Recent failures</h3>
            {view.recentFailures.length === 0 ? (
              <p className="text-sm text-ink-3">None in this period.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {view.recentFailures.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm rounded-xl bg-panel-2 px-3 py-2">
                    <Icon name="error" size={18} className="mt-0.5 shrink-0 text-danger" />
                    <div className="min-w-0 flex-1">
                      <p>
                        {featureName(f.feature)} <span className="text-ink-3">· {f.tier}</span>
                        {f.errorCode && <span className="ml-1.5 font-mono text-xs px-1.5 py-0.5 rounded bg-panel-3">{f.errorCode}</span>}
                      </p>
                      <p className="text-xs text-ink-3 truncate">
                        {new Date(f.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                        {f.model ? ` · ${f.model}` : ""}
                        {f.course ? ` · ${f.course}` : ""} · {ms(f.latencyMs)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!view.tokensRecorded && <p className="text-xs text-ink-3">Token counts aren't recorded — only each call's tier, model, feature, time taken and outcome (never your text).</p>}
        </>
      )}
    </div>
  );
}
