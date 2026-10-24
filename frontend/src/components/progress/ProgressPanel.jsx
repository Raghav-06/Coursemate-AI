import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { Icon, Menu, Spinner } from "../ui";
import MasteryBar from "./MasteryBar";
import { timeAgo, toast } from "../uiUtils";

const POLL_MS = 4000;
const pct = (v) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

function ReviseCard({ topic, onQuiz, onFlashcards, onAsk }) {
  return (
    <div className="flex flex-col gap-2 p-4 rounded-2xl bg-panel border border-line">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-5">{topic.name}</p>
          <p className="text-xs text-ink-3 truncate">
            {topic.unitTitle} · {topic.reason === "new" ? "not practised yet" : `${pct(topic.mastery)} mastery`}
          </p>
        </div>
        {topic.mastery !== null && <MasteryBar value={topic.mastery} className="w-16 mt-1.5" />}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="btn-outline h-8 px-3 text-xs" onClick={() => onQuiz([topic])}>
          <Icon name="quiz" size={16} /> Quiz me
        </button>
        <button type="button" className="btn-outline h-8 px-3 text-xs" onClick={() => onFlashcards([topic])}>
          <Icon name="style" size={16} /> Flashcards
        </button>
        <button type="button" className="btn-outline h-8 px-3 text-xs" onClick={() => onAsk(topic)}>
          <Icon name="chat" size={16} /> Ask in chat
        </button>
      </div>
    </div>
  );
}

function UnitProgress({ unit, onQuiz, onFlashcards, onAsk, onExplain, onRefresh }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-2xl border border-line overflow-hidden">
      <div className="flex items-center gap-3 px-4 h-14 bg-panel">
        <button type="button" className="flex-1 min-w-0 flex items-center gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Icon name={open ? "expand_more" : "chevron_right"} size={20} className="text-ink-3" />
          <span className="text-sm font-semibold truncate">{unit.title}</span>
          {unit.status === "pending" && <Spinner className="w-3.5 h-3.5 text-ink-3" />}
        </button>
        <span className="text-xs text-ink-3 tabular-nums max-sm:hidden">
          {unit.practisedCount}/{unit.topics.length} practised
        </span>
        <MasteryBar value={unit.mastery} className="w-20 sm:w-28" />
        <span className="w-10 text-right text-xs font-semibold tabular-nums">{pct(unit.mastery)}</span>
        <Menu
          items={[
            unit.topics.length ? { label: "Quiz this unit", icon: "quiz", onClick: () => onQuiz(unit.topics.slice(0, 5)) } : null,
            { label: "Refresh topics", icon: "refresh", onClick: () => onRefresh(unit.unitId) },
          ]}
        />
      </div>
      {open && (
        <div className="border-t border-line/60 divide-y divide-line/60">
          {unit.status === "pending" && unit.topics.length === 0 && <p className="px-4 py-3 text-sm text-ink-3">Finding the topics in this unit…</p>}
          {unit.status === "error" && <p className="px-4 py-3 text-sm text-danger">Couldn't extract topics: {unit.error}</p>}
          {unit.status === "empty" && <p className="px-4 py-3 text-sm text-ink-3">Add sources to this unit to see its topics.</p>}
          {unit.topics.map((t) => (
            <div key={t.id} className="group flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate" title={t.description ?? undefined}>
                  {t.name}
                </p>
                <p className="text-xs text-ink-3 truncate">{t.lastPracticedAt ? `${t.attempts} answer${t.attempts === 1 ? "" : "s"} · last ${timeAgo(t.lastPracticedAt)}` : "Not practised yet"}</p>
              </div>
              <MasteryBar value={t.mastery} className="w-20 sm:w-28" />
              <span className="w-10 text-right text-xs tabular-nums">{pct(t.mastery)}</span>
              <Menu
                items={[
                  { label: "Quiz me", icon: "quiz", onClick: () => onQuiz([t]) },
                  { label: "Flashcards", icon: "style", onClick: () => onFlashcards([t]) },
                  { label: "Ask in chat", icon: "chat", onClick: () => onAsk(t) },
                  onExplain && { label: "Explain it back", icon: "record_voice_over", onClick: () => onExplain(t) },
                ]}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The user's topic mastery per unit (weakest first) with "Revise these
 * today". Mastery is weighted recent accuracy from quizzes, graded answers
 * and flashcard ratings.
 */
export default function ProgressPanel({ notebook, onQuiz, onFlashcards, onAsk, onExplain, refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(
    () =>
      api.getProgress(notebook.id).then(
        (d) => {
          setData(d);
          setError(null);
        },
        (err) => setError(err.message)
      ),
    [notebook.id]
  );

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const pending = data?.units.some((u) => u.status === "pending");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, load]);

  const refresh = async (unitId) => {
    try {
      await api.refreshTopics(notebook.id, unitId ?? "general");
      toast("Refreshing topics…");
      setTimeout(load, 500);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const units = data?.units ?? [];
  const hasTopics = units.some((u) => u.topics.length);

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
        <h2 className="font-display text-xl font-semibold">Progress</h2>
        {error && <p className="text-sm text-danger">{error}</p>}
        {!data && !error && (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-14 rounded-2xl" />
            ))}
          </div>
        )}
        {data && units.length === 0 && (
          <div className="flex flex-col items-center text-center gap-3 py-10 px-6 rounded-3xl border border-dashed border-line">
            <Icon name="insights" size={36} className="text-ink-3" />
            <p className="text-sm font-medium text-ink-2">Nothing to track yet</p>
            <p className="text-xs text-ink-3 max-w-sm leading-5">Add sources to your course. CourseMate finds the topics in each unit and tracks how well you know them as you practise.</p>
          </div>
        )}

        {data?.revise.length > 0 && (
          <section className="rounded-3xl bg-accent-soft/60 p-4 sm:p-5 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Icon name="track_changes" size={22} className="text-accent" />
              <h3 className="font-display text-base font-semibold mr-auto">Revise these today</h3>
              <button type="button" className="btn-primary h-8 px-3 text-xs" onClick={() => onQuiz(data.revise)}>
                <Icon name="quiz" size={16} /> Quiz me on all
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.revise.map((t) => (
                <ReviseCard key={t.id} topic={t} onQuiz={onQuiz} onFlashcards={onFlashcards} onAsk={onAsk} />
              ))}
            </div>
          </section>
        )}

        {data && units.length > 0 && !hasTopics && !pending && (
          <p className="text-sm text-ink-3">No topics yet — they appear once your sources finish processing.</p>
        )}
        <div className="flex flex-col gap-3">
          {units.map((u) => (
            <UnitProgress key={u.unitId ?? "general"} unit={u} onQuiz={onQuiz} onFlashcards={onFlashcards} onAsk={onAsk} onExplain={onExplain} onRefresh={refresh} />
          ))}
        </div>
      </div>
    </div>
  );
}
