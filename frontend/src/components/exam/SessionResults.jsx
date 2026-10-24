import { useState } from "react";
import { Icon, IconButton } from "../ui";
import Markdown from "../Markdown";
import QuestionBody from "./QuestionBody";
import { fmtTime } from "./sessionResultsUtils";
import { TYPE_LABEL } from "./questionUtils";

const pct = (v) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);
const CONF = { sure: "Sure", unsure: "Unsure", guess: "Guess" };

function Tile({ label, value, sub, tone = "" }) {
  return (
    <div className="rounded-2xl bg-panel-2 p-4 min-w-0">
      <p className="text-xs text-ink-3">{label}</p>
      <p className={`font-display text-2xl font-semibold tabular-nums mt-0.5 ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-ink-3 mt-0.5 truncate">{sub}</p>}
    </div>
  );
}

/** Your time on a question against the expected time (bar up to 2× expected). */
function TimeBar({ spent, expected }) {
  const ratio = expected ? spent / expected : 0;
  return (
    <div className="flex items-center gap-2 min-w-0" title={`You: ${fmtTime(spent)} · expected ${fmtTime(expected)}`}>
      <div className="relative h-1.5 w-20 sm:w-28 rounded-full bg-panel-3 overflow-hidden shrink-0">
        <div className={`absolute inset-y-0 left-0 rounded-full ${ratio > 1.5 ? "bg-danger" : ratio < 0.35 ? "bg-gold" : "bg-accent"}`} style={{ width: `${Math.min(100, ratio * 50)}%` }} />
        <div className="absolute inset-y-0 left-1/2 w-px bg-ink-3" />
      </div>
      <span className="text-xs tabular-nums text-ink-3">{fmtTime(spent)}</span>
    </div>
  );
}

function Row({ row, onOpenCitation, renderExtra }) {
  const [open, setOpen] = useState(false);
  const status = !row.attempted ? "skipped" : row.correct ? "correct" : "wrong";
  const icon = { correct: ["check_circle", "text-success"], wrong: ["cancel", "text-danger"], skipped: ["radio_button_unchecked", "text-ink-3"] }[status];
  return (
    <div className="rounded-2xl border border-line bg-panel">
      <button type="button" className="w-full flex items-center gap-3 p-3 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name={icon[0]} size={22} className={`${icon[1]} shrink-0`} filled />
        <span className="w-8 text-sm font-semibold tabular-nums">Q{row.position + 1}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm truncate">{row.nodeNames[0] ?? TYPE_LABEL[row.question.type]}</span>
          <span className="block text-xs text-ink-3 truncate">
            {TYPE_LABEL[row.question.type]}
            {row.confidence ? ` · ${CONF[row.confidence]}` : ""}
            {row.answerChanges ? ` · changed ${row.answerChanges}×` : ""}
          </span>
        </span>
        <span className="max-sm:hidden">
          <TimeBar spent={row.timeSpentMs / 1000} expected={row.question.expectedSeconds} />
        </span>
        <span className={`w-12 text-right text-sm font-semibold tabular-nums ${row.marks > 0 ? "text-success" : row.marks < 0 ? "text-danger" : "text-ink-3"}`}>
          {row.marks > 0 ? `+${row.marks}` : row.marks}
        </span>
        <Icon name={open ? "expand_less" : "expand_more"} size={20} className="text-ink-3" />
      </button>
      {open && (
        <div className="border-t border-line/60 p-4 flex flex-col gap-4">
          <p className="sm:hidden text-xs text-ink-3">
            Time: {fmtTime(row.timeSpentMs / 1000)} (expected {fmtTime(row.question.expectedSeconds)})
          </p>
          <QuestionBody question={row.question} value={row.answer} answerKey={row.question.answer} disabled onOpenCitation={onOpenCitation} />
          {row.question.type === "descriptive" && row.answer?.text && (
            <div className="rounded-xl border border-line p-3 text-sm whitespace-pre-line">
              <p className="text-xs font-semibold text-ink-3 mb-1">Your answer</p>
              {row.answer.text}
            </div>
          )}
          {row.grading?.points && (
            <ul className="text-sm flex flex-col gap-1">
              {row.grading.points.map((p) => (
                <li key={p.point} className="flex gap-2">
                  <Icon name={p.awarded >= p.marks ? "check" : p.awarded > 0 ? "remove" : "close"} size={18} className={p.awarded >= p.marks ? "text-success" : p.awarded > 0 ? "text-gold" : "text-danger"} />
                  <span className="flex-1">{p.point}</span>
                  <span className="tabular-nums text-ink-3">
                    {p.awarded}/{p.marks}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {row.grading?.feedback && <Markdown text={row.grading.feedback} citations={row.question.citations} onOpenCitation={onOpenCitation} className="text-sm!" />}
          {row.grading?.reason && row.grading.by !== "code" && <p className="text-xs text-ink-3">Grader: {row.grading.reason}</p>}
          {renderExtra?.(row)}
          <div className="rounded-xl bg-panel-2 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">Solution</p>
            <Markdown text={row.question.solution ?? row.question.answer?.modelAnswer ?? ""} citations={row.question.citations} onOpenCitation={onOpenCitation} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Results of a practice session: score with the exam's marking, accuracy, time per question, solutions. */
export default function SessionResults({ results, onOpenCitation, onClose, renderExtra, header }) {
  const { session, summary, rows } = results;
  const scoreShare = summary.maxScore ? Math.max(0, summary.score) / summary.maxScore : 0;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <IconButton icon="arrow_back" label="Back to practice" onClick={onClose} />
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold truncate">{session.title}</h2>
          <p className="text-xs text-ink-3">Results</p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Score" value={`${summary.score} / ${summary.maxScore}`} sub={summary.negativeMarks ? `${summary.negativeMarks} from wrong answers` : "no negative marks"} tone={scoreShare >= 0.6 ? "text-success" : scoreShare < 0.3 ? "text-danger" : ""} />
        <Tile label="Accuracy" value={pct(summary.accuracy)} sub={`${summary.correct} right · ${summary.wrong} wrong`} />
        <Tile label="Attempted" value={`${summary.attempted}/${summary.questions}`} sub={`${summary.questions - summary.attempted} left blank`} />
        <Tile label="Time" value={fmtTime(summary.timeUsedSeconds)} sub={`expected ~${fmtTime(summary.expectedSeconds)}`} />
      </div>
      {header}
      {summary.sections.length > 1 && (
        <div className="rounded-2xl border border-line overflow-hidden">
          {summary.sections.map((s) => (
            <div key={s.section} className="flex items-center gap-3 px-4 py-2.5 border-b border-line/60 last:border-0 text-sm">
              <span className="flex-1 min-w-0 truncate font-medium">{s.section}</span>
              <span className="text-ink-3 tabular-nums">
                {s.correct}/{s.questions} right
              </span>
              <span className="w-20 text-right font-semibold tabular-nums">
                {s.marks}/{s.maxMarks}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Questions</h3>
        <p className="text-xs text-ink-3 max-sm:hidden">Bar: your time; the line marks the expected time</p>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <Row key={r.position} row={r} onOpenCitation={onOpenCitation} renderExtra={renderExtra} />
        ))}
      </div>
    </div>
  );
}
