import { useEffect, useState } from "react";
import { api } from "../../api";
import Markdown from "../Markdown";
import { ConfirmDialog, Icon, Menu, Spinner } from "../ui";
import { PointList } from "./GradedAnswer";
import { timeAgo, toast } from "../uiUtils";

const MAX_PROMPT = 500;
const MAX_EXPLANATION = 8000;

function ScoreChip({ label, value }) {
  const tone = value >= 7 ? "bg-success/15 text-success" : value >= 4 ? "bg-amber-400/20 text-amber-600 dark:text-amber-400" : "bg-danger/10 text-danger";
  return (
    <span className={`flex flex-col items-center justify-center w-20 h-20 rounded-full font-display ${tone}`}>
      <span className="text-2xl font-semibold leading-none tabular-nums">{value}</span>
      <span className="text-[11px] opacity-80">{label} /10</span>
    </span>
  );
}

function Feedback({ result, onOpenCitation, onFollowUp }) {
  const { feedback, citations } = result;
  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <ScoreChip label="clarity" value={result.clarity} />
        <ScoreChip label="accuracy" value={result.accuracy} />
        <div className="flex-1 min-w-[180px]">
          <p className="font-medium leading-6">{result.prompt}</p>
          {result.topic && <p className="text-xs text-ink-3 mt-1">Topic: {result.topic}</p>}
          {feedback.summary && <p className="text-sm text-ink-2 mt-1">{feedback.summary}</p>}
        </div>
      </div>
      <details className="rounded-2xl bg-panel-2 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium text-ink-2">Your explanation</summary>
        <p className="mt-2 whitespace-pre-wrap leading-6 text-ink">{result.explanation}</p>
      </details>
      <PointList title="What you got right" icon="check_circle" tone="text-success" points={feedback.correctPoints} citations={citations} onOpenCitation={onOpenCitation} />
      <PointList title="Gaps" icon="playlist_add" tone="text-amber-600 dark:text-amber-400" points={feedback.gaps} citations={citations} onOpenCitation={onOpenCitation} />
      <PointList title="Misconceptions" icon="error" tone="text-danger" points={feedback.misconceptions} citations={citations} onOpenCitation={onOpenCitation} />
      {feedback.followUp && (
        <div className="rounded-2xl border border-accent/40 bg-accent-soft/30 p-4 flex flex-col gap-3">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-accent">
            <Icon name="help" size={18} filled /> Follow-up question
          </h4>
          <Markdown text={feedback.followUp} citations={citations} onOpenCitation={onOpenCitation} />
          <button type="button" className="btn-primary self-start h-9 px-4 text-sm" onClick={() => onFollowUp(feedback.followUp, result.topicId)}>
            <Icon name="record_voice_over" size={18} /> Explain this next
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Explain-it-back: pick a topic (or type what you're explaining), explain it
 * in your own words, and get it compared with your sources. `preset`
 * ({ topicId?, prompt? }) starts with a topic chosen, e.g. from Progress.
 */
export default function ExplainBack({ notebookId, onOpenCitation, preset, onPresetUsed, onDone }) {
  const [topics, setTopics] = useState([]); // [{ unitTitle, topics }]
  const [topicId, setTopicId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.getTopics(notebookId).then((groups) => !cancelled && setTopics(groups.filter((g) => g.topics.length)), () => {});
    api.listExplanations(notebookId).then(
      (list) => !cancelled && setHistory(list),
      (err) => !cancelled && setHistoryError(err.message)
    );
    return () => {
      cancelled = true;
    };
  }, [notebookId]);

  // A new preset fills the form: state is adjusted while rendering, once per
  // preset, instead of in an effect…
  const [handledPreset, setHandledPreset] = useState(null);
  if (preset && preset !== handledPreset) {
    setHandledPreset(preset);
    setTopicId(preset.topicId ?? "");
    setPrompt(preset.prompt ?? "");
    setExplanation("");
    setResult(null);
  }
  // …and the parent is told it was used (so it clears it).
  useEffect(() => {
    if (preset) onPresetUsed?.();
  }, [preset, onPresetUsed]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await api.explainBack(notebookId, { topicId: topicId || undefined, prompt: prompt.trim() || undefined, explanation });
      setResult(saved);
      setHistory((list) => [saved, ...(list ?? [])]);
      onDone?.();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const followUp = (question, nextTopicId) => {
    setPrompt(question.slice(0, MAX_PROMPT));
    setTopicId(nextTopicId ?? "");
    setExplanation("");
    setResult(null);
  };

  const remove = async (item) => {
    try {
      await api.deleteExplanation(item.id);
      setHistory((list) => list.filter((x) => x.id !== item.id));
      if (result?.id === item.id) setResult(null);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  if (result) {
    return (
      <div className="flex flex-col gap-4">
        <button type="button" className="btn-ghost self-start h-9 px-3 text-sm" onClick={() => setResult(null)}>
          <Icon name="arrow_back" size={18} /> Explain something else
        </button>
        <Feedback result={result} onOpenCitation={onOpenCitation} onFollowUp={followUp} />
      </div>
    );
  }

  const ready = (topicId || prompt.trim()) && explanation.trim().length >= 20;
  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="flex flex-col gap-4 rounded-3xl border border-line p-4 sm:p-5">
        <p className="text-sm text-ink-2">
          Teaching is the best test of understanding. Explain a topic as if to a classmate — CourseMate checks it against your sources and tells you what's right, what's
          missing and what's wrong.
        </p>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
          Topic
          <select className="input" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            <option value="">{prompt ? "— (explaining the question below)" : "Choose a topic…"}</option>
            {topics.map((g) => (
              <optgroup key={g.unitId ?? "general"} label={g.title}>
                {g.topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
          {topicId ? "Focus (optional)" : "Or type what you're explaining"}
          <input className="input" value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={MAX_PROMPT} placeholder="e.g. Why the Carnot engine is the most efficient" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
          Your explanation
          <textarea
            className="input min-h-48 leading-6"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            maxLength={MAX_EXPLANATION}
            placeholder="Explain it in your own words, without looking at your notes"
          />
        </label>
        <div className="flex items-center justify-end gap-3">
          {busy && <span className="text-xs text-ink-3">Checking against your sources…</span>}
          <button type="submit" className="btn-primary" disabled={busy || !ready}>
            {busy ? <Spinner /> : <Icon name="fact_check" size={18} />} Check my explanation
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <h3 className="font-display text-base font-semibold">Past explanations</h3>
        {historyError && <p className="text-sm text-danger">{historyError}</p>}
        {!history && !historyError && <div className="skeleton h-14 rounded-2xl" />}
        {history?.length === 0 && <p className="text-sm text-ink-3">Your checked explanations appear here.</p>}
        {history?.map((x) => (
          <div
            key={x.id}
            role="button"
            tabIndex={0}
            onClick={() => setResult(x)}
            onKeyDown={(e) => e.key === "Enter" && setResult(x)}
            className="flex items-center gap-3 p-3 pl-4 rounded-2xl border border-line bg-panel hover:bg-panel-2 cursor-pointer"
          >
            <span className="w-12 text-center text-sm font-semibold tabular-nums">{x.accuracy}/10</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{x.prompt}</p>
              <p className="text-xs text-ink-3 truncate">
                {timeAgo(x.createdAt)}
                {x.topic ? ` · ${x.topic}` : ""} · clarity {x.clarity}/10
              </p>
            </div>
            <Menu items={[{ label: "Delete", icon: "delete", danger: true, onClick: () => setDeleting(x) }]} />
          </div>
        ))}
      </div>
      <ConfirmDialog open={Boolean(deleting)} title="Delete this explanation?" message="It will be removed from your history." onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} />
    </div>
  );
}
