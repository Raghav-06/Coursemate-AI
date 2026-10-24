import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { navigate } from "../../hooks";
import { Icon, Modal } from "../ui";
import TaskRow from "../exams/TaskRow";
import { countdown, formatDay } from "../exams/planUtils";
import { toast } from "../uiUtils";

const KIND_LABELS = { card: ["card", "cards"], quiz: ["quiz answer", "quiz answers"], answer: ["graded answer", "graded answers"], chat: ["question", "questions"], explain: ["explanation", "explanations"] };

function GoalRing({ done, goal }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, done / Math.max(1, goal));
  return (
    <svg viewBox="0 0 80 80" className="w-24 h-24 shrink-0 -rotate-90" role="img" aria-label={`${done} of ${goal} study actions today`}>
      <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" className="stroke-panel-3" />
      <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" strokeLinecap="round" className={pct >= 1 ? "stroke-success" : "stroke-accent"} strokeDasharray={`${pct * c} ${c}`} />
      <text x="40" y="40" textAnchor="middle" dominantBaseline="central" className="rotate-90 origin-center fill-ink text-[18px] font-semibold tabular-nums">
        {done}
      </text>
    </svg>
  );
}

function GoalDialog({ goal, onClose, onSaved }) {
  const [value, setValue] = useState(goal);
  const save = async (e) => {
    e.preventDefault();
    try {
      const out = await api.updateSettings({ dailyGoal: Number(value) });
      onSaved(out.dailyGoal);
      onClose();
    } catch (err) {
      toast(err.message, "error");
    }
  };
  return (
    <Modal open onClose={onClose} title="Daily goal" width="max-w-sm" bodyClassName="px-6 pb-6">
      <form onSubmit={save} className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">Study actions per day — each flashcard review, quiz answer, graded answer or question to the chat counts as one. Meet it to keep your streak going.</p>
        <input className="input" type="number" min={1} max={500} value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-label="Actions per day" />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!(Number(value) >= 1 && Number(value) <= 500)}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Home "Today": daily goal and streak, the next exam with today's tasks, cards due across courses. */
export default function TodayPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [editingGoal, setEditingGoal] = useState(false);

  const load = useCallback(
    () =>
      api.today().then(
        (d) => {
          setData(d);
          setError(null);
        },
        (err) => setError(err.message)
      ),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (task, done) => {
    setData((d) => ({ ...d, nextExam: { ...d.nextExam, todayTasks: d.nextExam.todayTasks.map((t) => (t.id === task.id ? { ...t, done } : t)) } }));
    try {
      await api.setTaskDone(task.id, done);
    } catch (err) {
      toast(err.message, "error");
      load();
    }
  };

  if (error) return <p className="text-sm text-danger mb-6">{error}</p>;
  if (!data) {
    return (
      <div className="grid gap-4 lg:grid-cols-3 mb-10">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-48 rounded-3xl" />
        ))}
      </div>
    );
  }

  const met = data.done >= data.goal;
  const breakdown = Object.entries(data.byKind)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${n} ${(KIND_LABELS[kind] ?? [kind, kind])[n === 1 ? 0 : 1]}`)
    .join(" · ");
  const maxDay = Math.max(data.goal, ...data.last7.map((d) => d.total));
  const exam = data.nextExam;

  return (
    <section aria-labelledby="today-heading" className="mb-10">
      <h2 id="today-heading" className="font-display text-xl font-semibold mb-4">
        Today
      </h2>
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Goal and streak */}
        <div className="rounded-2xl bg-panel border border-line/70 shadow-card p-5 flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <GoalRing done={data.done} goal={data.goal} />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{met ? "Goal met — nice work!" : `${data.goal - data.done} to go today`}</p>
              <p className="text-xs text-ink-3">
                Goal: {data.goal} actions ·{" "}
                <button type="button" className="text-accent hover:underline" onClick={() => setEditingGoal(true)}>
                  change
                </button>
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold">
                <Icon name="local_fire_department" filled size={20} className={data.streak.current ? "text-gold" : "text-ink-3"} />
                {data.streak.current}-day streak
              </p>
              <p className="text-xs text-ink-3">Best: {data.streak.best} days</p>
            </div>
          </div>
          {breakdown && <p className="text-xs text-ink-2">{breakdown}</p>}
          <div className="flex items-end gap-1.5 mt-auto" aria-label="Last 7 days">
            {data.last7.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col items-center gap-1" title={`${formatDay(d.day)}: ${d.total}`}>
                <div className="w-full h-12 flex items-end">
                  <div className={`w-full rounded-md ${d.total >= data.goal ? "bg-success" : d.total ? "bg-accent/60" : "bg-panel-3"}`} style={{ height: `${Math.max(8, (d.total / maxDay) * 100)}%` }} />
                </div>
                <span className="text-[10px] text-ink-3">{formatDay(d.day, { weekday: "narrow" })}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Next exam */}
        <div className="rounded-2xl bg-panel border border-line/70 shadow-card p-5 flex flex-col gap-3 min-w-0">
          {exam ? (
            <>
              <div className="flex items-start gap-3">
                <div className="w-14 h-14 rounded-2xl bg-accent text-accent-fg flex flex-col items-center justify-center leading-none shrink-0">
                  <span className="text-xl font-semibold tabular-nums">{exam.daysLeft}</span>
                  <span className="text-[9px] uppercase tracking-wide mt-1">{exam.daysLeft === 1 ? "day" : "days"}</span>
                </div>
                <div className="min-w-0">
                  <p className="font-display font-semibold truncate">{exam.name}</p>
                  <p className="text-xs text-ink-3 truncate">
                    {countdown(exam.daysLeft)} · {formatDay(exam.examDate)} · {exam.notebookEmoji} {exam.notebookTitle}
                  </p>
                </div>
              </div>
              <div className="flex-1 flex flex-col">
                {exam.todayTasks.length === 0 ? (
                  <p className="text-sm text-ink-3">{exam.taskCount ? "No tasks planned for today." : "No revision plan yet."}</p>
                ) : (
                  <div className="divide-y divide-line/60">
                    {exam.todayTasks.slice(0, 5).map((t) => (
                      <TaskRow key={t.id} task={t} onToggle={toggle} compact />
                    ))}
                  </div>
                )}
                {exam.todayTasks.length > 5 && <p className="text-xs text-ink-3 mt-1">+{exam.todayTasks.length - 5} more</p>}
                {exam.missedCount > 0 && <p className="text-xs text-amber-600 dark:text-amber-300 mt-2">{exam.missedCount} missed task{exam.missedCount === 1 ? "" : "s"} — re-plan in the course.</p>}
              </div>
              <button type="button" className="btn-outline self-start h-9 px-4 text-sm" onClick={() => navigate(`/notebook/${exam.notebookId}?view=exams`)}>
                Open plan <Icon name="arrow_forward" size={16} />
              </button>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 py-4">
              <Icon name="event_upcoming" size={32} className="text-ink-3" />
              <p className="text-sm font-medium text-ink-2">No upcoming exams</p>
              <p className="text-xs text-ink-3 max-w-xs">Open a course and add your exam in its Exams tab to get a day-by-day revision plan.</p>
            </div>
          )}
        </div>

        {/* Cards due */}
        <div className="rounded-2xl bg-panel border border-line/70 shadow-card p-5 flex flex-col gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <Icon name="style" size={22} className="text-accent" />
            <p className="font-display font-semibold">Flashcards</p>
            <span className="ml-auto text-sm font-semibold tabular-nums">{data.cardsDueTotal} to review</span>
          </div>
          {data.cardsDue.length === 0 ? (
            <p className="text-sm text-ink-3">You're all caught up. Make a deck from any course's Study tab.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {data.cardsDue.slice(0, 5).map((c) => (
                <button
                  key={c.notebookId}
                  type="button"
                  onClick={() => navigate(`/notebook/${c.notebookId}?view=study`)}
                  className="flex items-center gap-3 px-2 h-11 rounded-xl hover:bg-panel-2 text-left"
                >
                  <span className="text-lg">{c.emoji}</span>
                  <span className="flex-1 min-w-0 text-sm truncate">{c.title}</span>
                  <span className="text-xs text-ink-3 tabular-nums">
                    {c.due} due{c.newToday ? ` · ${c.newToday} new` : ""}
                  </span>
                  <Icon name="chevron_right" size={18} className="text-ink-3" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {editingGoal && (
        <GoalDialog
          goal={data.goal}
          onClose={() => setEditingGoal(false)}
          onSaved={() => {
            load();
          }}
        />
      )}
    </section>
  );
}
