import { useEffect, useState } from "react";
import { api } from "../../api";
import { ConfirmDialog, Icon, IconButton, Menu, Segmented, Spinner } from "../ui";
import UnitChecklist from "../study/UnitChecklist";
import GradedAnswer from "./GradedAnswer";
import { timeAgo, toast } from "../uiUtils";

const MAX_QUESTION = 1000;
const MAX_ANSWER = 12000;
const WORD_GUIDE = { 2: "about 30–60 words", 5: "about 120–200 words", 10: "about 300–500 words" };

const countWords = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/**
 * Answer-writing practice: pick or type an exam question (2/5/10 marks),
 * write an answer and get it graded against the course sources. `preset`
 * ({ question, marks, topicId?, unitIds?, origin? }) opens with a question
 * filled in, e.g. from past-paper insights.
 */
export default function AnswerWriting({ notebookId, units, sources, onOpenCitation, preset, onPresetUsed, onGraded }) {
  const [marks, setMarks] = useState(5);
  const [unitIds, setUnitIds] = useState([]);
  const [question, setQuestion] = useState("");
  const [meta, setMeta] = useState({ origin: "typed", topicId: null });
  const [suggestions, setSuggestions] = useState(null);
  const [suggesting, setSuggesting] = useState(false);
  const [answer, setAnswer] = useState("");
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(null);
  const [historyError, setHistoryError] = useState(null);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.listAnswers(notebookId).then(
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
    setQuestion(preset.question);
    if ([2, 5, 10].includes(preset.marks)) setMarks(preset.marks);
    setUnitIds(preset.unitIds ?? []);
    setMeta({ origin: preset.origin ?? "generated", topicId: preset.topicId ?? null });
    setAnswer("");
    setResult(null);
    setSuggestions(null);
  }
  // …and the parent is told it was used (so it clears it).
  useEffect(() => {
    if (preset) onPresetUsed?.();
  }, [preset, onPresetUsed]);

  const suggest = async () => {
    setSuggesting(true);
    try {
      setSuggestions(await api.writtenQuestions(notebookId, { marks, count: 3, unitIds }));
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setSuggesting(false);
    }
  };

  const pick = (q) => {
    setQuestion(q.question);
    setMeta({ origin: "generated", topicId: q.topicId });
    setSuggestions(null);
  };

  const grade = async (e) => {
    e.preventDefault();
    setGrading(true);
    try {
      const graded = await api.gradeAnswer(notebookId, {
        question: question.trim(),
        marks,
        answer: answer.trim(),
        unitIds,
        origin: meta.origin,
        ...(meta.topicId ? { topicId: meta.topicId } : {}),
      });
      setResult(graded);
      setHistory((list) => [graded, ...(list ?? [])]);
      onGraded?.();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setGrading(false);
    }
  };

  const startOver = () => {
    setResult(null);
    setAnswer("");
    setQuestion("");
    setMeta({ origin: "typed", topicId: null });
  };

  const remove = async (attempt) => {
    try {
      await api.deleteAnswer(attempt.id);
      setHistory((list) => list.filter((a) => a.id !== attempt.id));
      if (result?.id === attempt.id) setResult(null);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  if (result) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <IconButton icon="arrow_back" label="Back" onClick={() => setResult(null)} />
          <h3 className="flex-1 font-display text-base font-semibold">Your grade</h3>
          <button type="button" className="btn-outline" onClick={() => setResult(null)}>
            <Icon name="edit" size={18} /> Improve answer
          </button>
          <button type="button" className="btn-primary" onClick={startOver}>
            New question
          </button>
        </div>
        <GradedAnswer attempt={result} onOpenCitation={onOpenCitation} />
      </div>
    );
  }

  const words = countWords(answer);
  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={grade} className="flex flex-col gap-4 rounded-3xl border border-line p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-ink-2">Marks</span>
          <Segmented label="Marks" value={marks} onChange={setMarks} options={[[2, "2"], [5, "5"], [10, "10"]]} />
          <span className="text-xs text-ink-3">Aim for {WORD_GUIDE[marks]}</span>
        </div>
        {units.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-2 font-medium">Units {unitIds.length ? `(${unitIds.length} chosen)` : "(whole course)"}</summary>
            <div className="mt-2">
              <UnitChecklist units={units} sources={sources} value={unitIds} onChange={setUnitIds} />
            </div>
          </details>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
          Question
          <textarea
            className="input min-h-20 py-2.5 leading-6 font-normal text-ink resize-y"
            value={question}
            maxLength={MAX_QUESTION}
            onChange={(e) => {
              setQuestion(e.target.value);
              if (meta.origin !== "typed") setMeta({ origin: "typed", topicId: null });
            }}
            placeholder="Type an exam question, or let CourseMate suggest one"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 -mt-1">
          <button type="button" className="btn-outline h-8 px-3" onClick={suggest} disabled={suggesting}>
            {suggesting ? <Spinner /> : <Icon name="auto_awesome" size={16} />} Suggest {marks}-mark questions
          </button>
        </div>
        {suggestions && (
          <div className="flex flex-col gap-2 animate-fade-in">
            {suggestions.map((q, i) => (
              <button key={i} type="button" onClick={() => pick(q)} className="text-left p-3 rounded-2xl border border-line hover:bg-panel-2 text-sm leading-6">
                {q.question}
                {q.topic && <span className="block text-xs text-ink-3 mt-1">{q.topic}</span>}
              </button>
            ))}
          </div>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
          Your answer
          <textarea
            className="input min-h-56 py-2.5 leading-6 font-normal text-ink resize-y"
            value={answer}
            maxLength={MAX_ANSWER}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Write your answer as you would in the exam"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-ink-3 tabular-nums mr-auto">{words} words</span>
          {grading && <span className="text-xs text-ink-3">Checking against your sources…</span>}
          <button type="submit" className="btn-primary" disabled={grading || !question.trim() || answer.trim().length < 5}>
            {grading ? <Spinner /> : <Icon name="grading" size={18} />} Grade my answer
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-2">
        <h3 className="font-display text-base font-semibold">Past answers</h3>
        {historyError && <p className="text-sm text-danger">{historyError}</p>}
        {!history && !historyError && <div className="skeleton h-14 rounded-2xl" />}
        {history?.length === 0 && <p className="text-sm text-ink-3">Graded answers appear here.</p>}
        {history?.map((a) => (
          <div
            key={a.id}
            role="button"
            tabIndex={0}
            onClick={() => setResult(a)}
            onKeyDown={(e) => e.key === "Enter" && setResult(a)}
            className="flex items-center gap-3 p-3 pl-4 rounded-2xl border border-line bg-panel hover:bg-panel-2 cursor-pointer"
          >
            <span className="shrink-0 w-14 text-center text-sm font-semibold tabular-nums">
              {a.score}/{a.marks}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{a.question}</p>
              <p className="text-xs text-ink-3 truncate">
                {timeAgo(a.createdAt)}
                {a.topic ? ` · ${a.topic}` : ""}
              </p>
            </div>
            <Menu
              items={[
                {
                  label: "Answer again",
                  icon: "replay",
                  onClick: () => {
                    setQuestion(a.question);
                    setMarks(a.marks);
                    setAnswer("");
                    setMeta({ origin: a.origin, topicId: a.topicId });
                  },
                },
                { label: "Delete", icon: "delete", danger: true, onClick: () => setDeleting(a) },
              ]}
            />
          </div>
        ))}
      </div>
      <ConfirmDialog open={Boolean(deleting)} title="Delete this answer?" message="The graded answer will be removed from your history." onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} />
    </div>
  );
}
