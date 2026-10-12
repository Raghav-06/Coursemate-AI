import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { ConfirmDialog, Icon, Menu, Segmented, Spinner, timeAgo, toast } from "../ui";
import QuizPlayer from "./QuizPlayer";
import NewQuizDialog from "./NewQuizDialog";
import AnswerWriting from "./AnswerWriting";

function ScorePill({ quiz }) {
  if (quiz.lastScore === null) return <span className="text-xs text-ink-3">Not taken</span>;
  const pct = quiz.questionCount ? quiz.bestScore / quiz.questionCount : 0;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums ${pct >= 0.7 ? "bg-success/15 text-success" : "bg-panel-3 text-ink-2"}`}>
      Best {quiz.bestScore}/{quiz.questionCount}
    </span>
  );
}

/**
 * Practice: multiple-choice quizzes and answer-writing. `intent` starts
 * something right away: { kind: "quiz", topicIds } makes and plays a quiz on
 * those topics; { kind: "answer", question, marks, … } opens answer writing.
 */
export default function PracticePanel({ notebook, units, sources, onOpenCitation, intent, onIntentUsed, onActivity }) {
  const [tab, setTab] = useState("quiz");
  const [quizzes, setQuizzes] = useState(null);
  const [error, setError] = useState(null);
  const [playing, setPlaying] = useState(null); // quiz
  const [creating, setCreating] = useState(false);
  const [making, setMaking] = useState(false); // quiz from an intent
  const [deleting, setDeleting] = useState(null);
  const [answerPreset, setAnswerPreset] = useState(null);
  const handledIntent = useRef(null); // StrictMode runs effects twice

  const load = useCallback(
    () =>
      api.listQuizzes(notebook.id).then(
        (list) => {
          setQuizzes(list);
          setError(null);
        },
        (err) => setError(err.message)
      ),
    [notebook.id]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!intent || handledIntent.current === intent) return;
    handledIntent.current = intent;
    onIntentUsed?.();
    if (intent.kind === "answer") {
      setPlaying(null);
      setTab("answer");
      setAnswerPreset(intent);
      return;
    }
    if (intent.kind === "quiz") {
      setTab("quiz");
      setMaking(true);
      api
        .createQuiz(notebook.id, { topicIds: intent.topicIds, count: intent.count ?? 5, difficulty: "medium" })
        .then(
          (quiz) => {
            setPlaying(quiz);
            load();
          },
          (err) => toast(err.message, "error")
        )
        .finally(() => setMaking(false));
    }
  }, [intent, onIntentUsed, notebook.id, load]);

  const remove = async (quiz) => {
    try {
      await api.deleteQuiz(quiz.id);
      setQuizzes((list) => list.filter((q) => q.id !== quiz.id));
    } catch (err) {
      toast(err.message, "error");
    }
  };

  if (playing) {
    return (
      <QuizPlayer
        key={playing.id + (playing.run ?? 0)}
        quiz={playing}
        onOpenCitation={onOpenCitation}
        onExit={() => {
          setPlaying(null);
          load();
        }}
        onRetake={() => setPlaying((q) => ({ ...q, run: (q.run ?? 0) + 1 }))}
        onFinished={() => {
          load();
          onActivity?.();
        }}
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-xl font-semibold mr-auto">Practice</h2>
          <Segmented
            label="Practice mode"
            value={tab}
            onChange={setTab}
            options={[
              ["quiz", "Quizzes"],
              ["answer", "Answer writing"],
            ]}
          />
        </div>

        {tab === "answer" ? (
          <AnswerWriting
            notebookId={notebook.id}
            units={units}
            sources={sources}
            onOpenCitation={onOpenCitation}
            preset={answerPreset}
            onPresetUsed={() => setAnswerPreset(null)}
            onGraded={onActivity}
          />
        ) : (
          <>
            <div className="rounded-3xl bg-accent-soft text-accent-soft-fg p-5 flex flex-wrap items-center gap-4">
              <span className="w-12 h-12 rounded-2xl bg-panel/60 flex items-center justify-center">
                <Icon name="quiz" size={26} />
              </span>
              <div className="flex-1 min-w-[180px]">
                <p className="font-display text-lg font-semibold">Test yourself</p>
                <p className="text-sm opacity-80">Multiple-choice questions from your sources, with explanations and the page each answer comes from.</p>
              </div>
              <button type="button" className="btn-primary h-10 px-5" onClick={() => setCreating(true)} disabled={making}>
                {making ? <Spinner /> : <Icon name="add" size={20} />} New quiz
              </button>
            </div>
            {making && (
              <p className="flex items-center gap-2 text-sm text-ink-2">
                <Spinner /> Making a quiz on your weak topics…
              </p>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
            {!quizzes && !error && (
              <div className="flex flex-col gap-2">
                {[0, 1].map((i) => (
                  <div key={i} className="skeleton h-16 rounded-2xl" />
                ))}
              </div>
            )}
            {quizzes?.length === 0 && (
              <div className="flex flex-col items-center text-center gap-3 py-10 px-6 rounded-3xl border border-dashed border-line">
                <Icon name="quiz" size={36} className="text-ink-3" />
                <p className="text-sm font-medium text-ink-2">No quizzes yet</p>
                <p className="text-xs text-ink-3 max-w-sm leading-5">Make a quiz from a unit or the whole course. Your answers update your topic mastery in Progress.</p>
              </div>
            )}
            <div className="flex flex-col gap-2">
              {quizzes?.map((quiz) => (
                <div
                  key={quiz.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setPlaying(quiz)}
                  onKeyDown={(e) => e.key === "Enter" && setPlaying(quiz)}
                  className="flex items-center gap-3 p-3 pl-4 rounded-2xl border border-line bg-panel hover:bg-panel-2 cursor-pointer"
                >
                  <Icon name="quiz" size={22} className="text-accent shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{quiz.title}</p>
                    <p className="text-xs text-ink-3 truncate">
                      {quiz.questionCount} questions · {quiz.difficulty} · {timeAgo(quiz.createdAt)}
                      {quiz.attempts ? ` · ${quiz.attempts} attempt${quiz.attempts === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                  <ScorePill quiz={quiz} />
                  <Menu
                    items={[
                      { label: "Take quiz", icon: "play_arrow", onClick: () => setPlaying(quiz) },
                      { label: "Delete quiz", icon: "delete", danger: true, onClick: () => setDeleting(quiz) },
                    ]}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {creating && (
        <NewQuizDialog
          open
          notebookId={notebook.id}
          units={units}
          sources={sources}
          onClose={() => setCreating(false)}
          onCreated={(quiz) => {
            setCreating(false);
            load();
            setPlaying(quiz);
          }}
        />
      )}
      <ConfirmDialog open={Boolean(deleting)} title="Delete quiz?" message={`"${deleting?.title}" and your attempts will be deleted.`} onConfirm={() => remove(deleting)} onClose={() => setDeleting(null)} />
    </div>
  );
}
