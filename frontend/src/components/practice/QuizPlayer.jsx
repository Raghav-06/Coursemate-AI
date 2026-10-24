import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import Markdown, { MathText } from "../Markdown";
import { Icon, IconButton, Spinner } from "../ui";
import CitationLink from "../study/CitationLink";
import MasteryBar from "../progress/MasteryBar";
import { toast } from "../uiUtils";

const LETTERS = ["A", "B", "C", "D"];

function formatTime(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Summary({ review, onExit, onRetake, onOpenCitation }) {
  const { attempt, byTopic, questions, totalTimeMs } = review;
  const pct = attempt.total ? Math.round((attempt.score / attempt.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex flex-col items-center text-center gap-2 pt-4">
        <span className={`w-20 h-20 rounded-full flex items-center justify-center font-display text-2xl font-semibold ${pct >= 70 ? "bg-success/15 text-success" : pct >= 40 ? "bg-amber-400/20 text-amber-600 dark:text-amber-400" : "bg-danger/10 text-danger"}`}>
          {pct}%
        </span>
        <h3 className="font-display text-xl font-semibold">
          {attempt.score} / {attempt.total} correct
        </h3>
        <p className="text-sm text-ink-3">Total time {formatTime(totalTimeMs)}</p>
        <div className="flex gap-2 mt-2">
          <button type="button" className="btn-outline" onClick={onExit}>
            Back to quizzes
          </button>
          <button type="button" className="btn-primary" onClick={onRetake}>
            <Icon name="replay" size={18} /> Retake
          </button>
        </div>
      </div>

      {byTopic.length > 0 && (
        <div className="rounded-2xl border border-line p-4">
          <h4 className="text-sm font-semibold mb-3">By topic</h4>
          <div className="flex flex-col gap-3">
            {byTopic.map((t) => (
              <div key={t.topic} className="flex items-center gap-3 text-sm">
                <span className="flex-1 min-w-0 truncate">{t.topic}</span>
                <span className="text-xs text-ink-3 tabular-nums w-10 text-right">
                  {t.correct}/{t.total}
                </span>
                <MasteryBar value={t.correct / t.total} className="w-28" />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-semibold">Review</h4>
        {questions.map((q, i) => (
          <div key={q.id} className="rounded-2xl border border-line p-4">
            <div className="flex gap-2 text-sm font-medium">
              <Icon name={q.answer?.correct ? "check_circle" : "cancel"} filled size={20} className={q.answer?.correct ? "text-success shrink-0" : "text-danger shrink-0"} />
              <span>
                {i + 1}. <MathText text={q.question} />
              </span>
            </div>
            <p className="mt-2 pl-7 text-sm text-ink-2">
              Answer: <strong>{q.options[q.answerIndex]}</strong>
              {q.answer && !q.answer.correct && <span className="text-danger"> · you chose {q.options[q.answer.chosenIndex]}</span>}
              {!q.answer && <span className="text-ink-3"> · not answered</span>}
            </p>
            {q.explanation && <p className="mt-1 pl-7 text-sm text-ink-3"><MathText text={q.explanation} /></p>}
            <div className="mt-2 pl-7">
              <CitationLink citation={q.citation} onOpen={onOpenCitation} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Plays a quiz one question at a time: pick an option (click, 1-4 or A-D),
 * see whether it was right with the explanation and citation, then Next
 * (Enter). Each answer is checked and stored by the server with its time.
 */
export default function QuizPlayer({ quiz, onExit, onRetake, onOpenCitation, onFinished }) {
  const [run, setRun] = useState(null); // { attempt, questions }
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState(null); // reveal for the current question
  const [chosen, setChosen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);
  const shownAt = useRef(0);

  useEffect(() => {
    let cancelled = false;
    api.startQuizAttempt(quiz.id).then(
      (r) => {
        if (cancelled) return;
        setRun(r);
        shownAt.current = performance.now();
      },
      (err) => !cancelled && setError(err.message)
    );
    return () => {
      cancelled = true;
    };
  }, [quiz.id]);

  const question = run?.questions[index];
  const last = run && index === run.questions.length - 1;

  const choose = useCallback(
    async (i) => {
      if (!question || result || busy) return;
      setBusy(true);
      setChosen(i);
      try {
        setResult(await api.answerQuizQuestion(run.attempt.id, { questionId: question.id, chosenIndex: i, timeMs: Math.round(performance.now() - shownAt.current) }));
      } catch (err) {
        setChosen(null);
        toast(err.message, "error");
      } finally {
        setBusy(false);
      }
    },
    [question, result, busy, run]
  );

  const next = useCallback(async () => {
    if (!result || busy) return;
    if (!last) {
      setIndex((i) => i + 1);
      setResult(null);
      setChosen(null);
      shownAt.current = performance.now();
      return;
    }
    setBusy(true);
    try {
      setReview(await api.finishQuizAttempt(run.attempt.id));
      onFinished?.();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  }, [result, busy, last, run, onFinished]);

  useEffect(() => {
    const onKey = (e) => {
      if (review || e.target.closest?.("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toUpperCase();
      if (!result && ["1", "2", "3", "4", "A", "B", "C", "D"].includes(key)) {
        e.preventDefault();
        choose(/\d/.test(key) ? Number(key) - 1 : LETTERS.indexOf(key));
      } else if (result && (e.key === "Enter" || e.key === "ArrowRight")) {
        e.preventDefault();
        next();
      } else if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [review, result, choose, next, onExit]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 sm:px-5 h-12 border-b border-line/60 shrink-0">
        <IconButton icon="arrow_back" label="Back to quizzes" onClick={onExit} />
        <h3 className="flex-1 min-w-0 truncate text-sm font-medium">{quiz.title}</h3>
        {run && !review && (
          <span className="text-xs text-ink-3 tabular-nums">
            {index + 1} / {run.questions.length}
          </span>
        )}
      </div>
      {run && !review && (
        <div className="h-1 bg-panel-3 shrink-0">
          <div className="h-full bg-accent transition-all" style={{ width: `${((index + (result ? 1 : 0)) / run.questions.length) * 100}%` }} />
        </div>
      )}
      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {error && <p className="text-sm text-danger text-center">{error}</p>}
          {!run && !error && (
            <div className="flex justify-center py-16 text-ink-3">
              <Spinner className="w-6 h-6" />
            </div>
          )}
          {review && (
            <Summary review={review} onExit={onExit} onOpenCitation={onOpenCitation} onRetake={onRetake} />
          )}
          {question && !review && (
            <div key={question.id} className="animate-fade-in">
              {question.topic && <p className="text-xs text-ink-3 mb-2">{question.topic}</p>}
              <Markdown text={question.question} className="text-lg! leading-8! font-medium" />
              <div className="mt-6 flex flex-col gap-2.5">
                {question.options.map((option, i) => {
                  const isAnswer = result && i === result.answerIndex;
                  const isWrongPick = result && i === chosen && !result.correct;
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={Boolean(result) || busy}
                      onClick={() => choose(i)}
                      className={`flex items-start gap-3 w-full text-left p-3.5 rounded-2xl border text-[15px] leading-6 transition-colors disabled:cursor-default ${
                        isAnswer
                          ? "border-success bg-success/10"
                          : isWrongPick
                            ? "border-danger bg-danger/10"
                            : chosen === i
                              ? "border-accent bg-accent-soft/50"
                              : "border-line hover:bg-panel-2"
                      }`}
                    >
                      <span
                        className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                          isAnswer ? "bg-success text-white" : isWrongPick ? "bg-danger text-white" : "bg-panel-3 text-ink-2"
                        }`}
                      >
                        {isAnswer ? <Icon name="check" size={16} /> : isWrongPick ? <Icon name="close" size={16} /> : LETTERS[i]}
                      </span>
                      <span className="pt-0.5"><MathText text={option} /></span>
                    </button>
                  );
                })}
              </div>
              {result && (
                <div className="mt-5 rounded-2xl bg-panel-2 p-4 animate-fade-in">
                  <p className={`text-sm font-semibold ${result.correct ? "text-success" : "text-danger"}`}>{result.correct ? "Correct!" : "Not quite."}</p>
                  {result.explanation && <p className="mt-1 text-sm text-ink-2 leading-6"><MathText text={result.explanation} /></p>}
                  <div className="mt-2">
                    <CitationLink citation={result.citation} onOpen={onOpenCitation} />
                  </div>
                </div>
              )}
              {result && (
                <button type="button" className="btn-primary w-full h-11 mt-5" onClick={next} disabled={busy}>
                  {busy && <Spinner />} {last ? "See results" : "Next question"} <span className="text-xs opacity-80 max-sm:hidden">(Enter)</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
