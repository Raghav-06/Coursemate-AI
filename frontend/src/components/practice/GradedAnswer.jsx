import Markdown from "../Markdown";
import { Icon } from "../ui";

// A feedback point with its supporting passages as citation chips.
const pointText = (p) => `${p.text}${p.citations.length ? " " + p.citations.map((n) => `[${n}]`).join("") : ""}`;

function PointList({ title, icon, tone, points, citations, onOpenCitation }) {
  if (!points?.length) return null;
  return (
    <div className="rounded-2xl border border-line p-4">
      <h4 className={`flex items-center gap-2 text-sm font-semibold mb-2 ${tone}`}>
        <Icon name={icon} size={18} filled /> {title}
      </h4>
      <ul className="flex flex-col gap-1.5">
        {points.map((p, i) => (
          <li key={i} className="flex gap-2 text-sm leading-6">
            <span className="text-ink-3">•</span>
            <Markdown text={pointText(p)} citations={citations} onOpenCitation={onOpenCitation} className="flex-1 min-w-0 [&_p]:m-0" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The examiner's feedback on a written answer: marks, points and a cited model answer. */
export default function GradedAnswer({ attempt, onOpenCitation, showAnswer = true }) {
  const { feedback, citations } = attempt;
  const pct = attempt.marks ? attempt.score / attempt.marks : 0;
  const tone = pct >= 0.7 ? "bg-success/15 text-success" : pct >= 0.4 ? "bg-amber-400/20 text-amber-600 dark:text-amber-400" : "bg-danger/10 text-danger";
  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center gap-4">
        <span className={`shrink-0 min-w-20 h-20 px-3 rounded-full flex flex-col items-center justify-center font-display ${tone}`}>
          <span className="text-2xl font-semibold leading-none tabular-nums">{attempt.score}</span>
          <span className="text-xs opacity-80">of {attempt.marks}</span>
        </span>
        <div className="min-w-0">
          <p className="font-medium leading-6">{attempt.question}</p>
          {attempt.topic && <p className="text-xs text-ink-3 mt-1">Topic: {attempt.topic}</p>}
        </div>
      </div>
      {showAnswer && (
        <details className="rounded-2xl bg-panel-2 px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink-2">Your answer</summary>
          <p className="mt-2 whitespace-pre-wrap leading-6 text-ink">{attempt.answer}</p>
        </details>
      )}
      <PointList title="What you got right" icon="check_circle" tone="text-success" points={feedback.correctPoints} citations={citations} onOpenCitation={onOpenCitation} />
      <PointList title="What you missed" icon="playlist_add" tone="text-amber-600 dark:text-amber-400" points={feedback.missingPoints} citations={citations} onOpenCitation={onOpenCitation} />
      <PointList title="Mistakes" icon="error" tone="text-danger" points={feedback.mistakes} citations={citations} onOpenCitation={onOpenCitation} />
      {feedback.modelAnswer && (
        <div className="rounded-2xl border border-accent/40 bg-accent-soft/30 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold mb-2 text-accent">
            <Icon name="workspace_premium" size={18} filled /> Model answer
          </h4>
          <Markdown text={feedback.modelAnswer} citations={citations} onOpenCitation={onOpenCitation} />
        </div>
      )}
    </div>
  );
}
