import { useState } from "react";
import { api } from "../../api";
import { Icon, Spinner } from "../ui";
import Markdown from "../Markdown";
import { CATEGORY } from "./categories";
import { toast } from "../uiUtils";

export function CategoryBadge({ category }) {
  const c = CATEGORY[category];
  if (!c) return null;
  return (
    <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-panel-2 text-sm font-semibold text-ink">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
      <Icon name={c.icon} size={16} className="text-ink-2" />
      {c.label}
    </span>
  );
}

/**
 * Why an answer went wrong: category, misconception, evidence, what to revisit,
 * a cited explanation, "Fix this" (targeted practice) and "Not right".
 */
export default function DiagnosisCard({ diagnosis: initial, citations = [], onOpenCitation, onPractise, advice }) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  if (d.status === "pending") {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-panel-2 px-4 py-3 text-sm text-ink-2">
        <Spinner /> Working out why this went wrong…
      </p>
    );
  }
  if (d.status === "error") {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-panel-2 px-4 py-3 text-sm text-ink-2">
        <Icon name="error" size={18} className="text-danger" /> The diagnosis couldn't be made.
        <button
          type="button"
          className="text-accent font-medium hover:underline"
          onClick={async () => {
            try {
              await api.retryDiagnosis(d.id);
              setD({ ...d, status: "pending" });
            } catch (err) {
              toast(err.message, "error");
            }
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  const flag = async () => {
    const next = d.feedback === "not_right" ? null : "not_right";
    try {
      setD(await api.diagnosisFeedback(d.id, next));
      if (next) toast("Thanks — noted for review. It won't count in your mistake stats.");
    } catch (err) {
      toast(err.message, "error");
    }
  };
  const practise = async () => {
    setBusy(true);
    try {
      onPractise(await api.practiseDiagnosis(d.id));
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-2xl border border-line p-4 flex flex-col gap-3" aria-label="Why this went wrong">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">Why it went wrong</span>
        <CategoryBadge category={d.category} />
        {d.confidence !== null && <span className="text-xs text-ink-3">{Math.round(d.confidence * 100)}% sure</span>}
        {d.feedback === "not_right" && <span className="text-xs text-ink-3">· you flagged this</span>}
      </div>
      {d.misconception && <p className="font-medium leading-6">{d.misconception}</p>}
      {d.evidence.length > 0 && (
        <ul className="text-sm text-ink-2 list-disc pl-5 flex flex-col gap-0.5">
          {d.evidence.map((e) => (
            <li key={e}>{e.replace(/^Rule: /, "")}</li>
          ))}
        </ul>
      )}
      {d.revisitNodeName && (
        <p className="text-sm">
          <Icon name="undo" size={16} className="align-[-3px] text-ink-3" /> Revisit: <b>{d.revisitNodeName}</b>
        </p>
      )}
      {d.explanation && <Markdown text={d.explanation} citations={citations} onOpenCitation={onOpenCitation} className="text-sm!" />}
      {advice?.[d.category] && <p className="text-xs text-ink-3 leading-5">{advice[d.category].text}</p>}
      <div className="flex flex-wrap gap-2">
        {onPractise && (
          <button type="button" className="btn-primary h-9" onClick={practise} disabled={busy}>
            {busy ? <Spinner /> : <Icon name="healing" size={18} />} Fix this
            {d.followupQuestionIds.length && d.category !== "time_pressure" ? ` (${d.followupQuestionIds.length} follow-ups)` : d.category === "time_pressure" ? " (speed drill)" : ""}
          </button>
        )}
        <button type="button" className="btn-ghost h-9" onClick={flag} aria-pressed={d.feedback === "not_right"}>
          <Icon name="thumb_down" size={18} filled={d.feedback === "not_right"} /> {d.feedback === "not_right" ? "Flagged as not right" : "Not right"}
        </button>
      </div>
    </section>
  );
}
