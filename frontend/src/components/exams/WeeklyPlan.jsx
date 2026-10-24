import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { Icon, Modal, Spinner, toast } from "../ui";
import { SESSION_TASKS, TASK_META, WEEKDAYS, dayDiff, formatDay, formatMinutes } from "./planUtils";

const POLL_MS = 3000;
const CHANGES_SHOWN = 5;

function SkipDialog({ task, onClose, onSkip }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSkip(task, reason.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={busy ? undefined : onClose} title="Skip this task?" bodyClassName="px-6 pb-6">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-ink-2">
          <span className="font-medium text-ink">{task.title}</span> will be marked as skipped.
        </p>
        <p className="text-xs text-ink-3">We'll move it to another day this week if there's room.</p>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
          Why? (optional)
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Already covered this in class" autoFocus />
        </label>
        <div className="flex justify-end gap-3">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? <Spinner /> : <Icon name="redo" size={18} />} Skip task
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TaskCard({ task, starting, onStart, onDone, onSkip, onUnskip }) {
  const meta = TASK_META[task.type] ?? TASK_META.drill;
  const startable = SESSION_TASKS.includes(task.type) || task.type === "learn" || task.type === "flashcards";
  return (
    <div className={`flex flex-col gap-2 p-3 rounded-2xl border border-line bg-panel ${task.done || task.skipped ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-3">
        <Icon name={meta.icon} size={20} className={`mt-0.5 shrink-0 ${task.done ? "text-success" : task.skipped ? "text-ink-3" : "text-accent"}`} />
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium leading-6 ${task.done || task.skipped ? "line-through" : ""}`}>{task.title}</p>
          <p className="text-xs text-ink-3 leading-5">
            {meta.label}
            {task.nodeName ? ` · ${task.nodeName}` : ""}
            {task.minutes ? ` · ${formatMinutes(task.minutes)}` : ""}
            {task.targetCount ? ` · ${task.targetCount} questions` : ""}
          </p>
          {task.reason && <p className="text-xs text-ink-2 leading-5 mt-0.5">{task.reason}</p>}
          {task.payload?.movedFrom && (
            <p className="text-xs text-ink-3 leading-5 mt-0.5 inline-flex items-center gap-1">
              <Icon name="redo" size={14} /> Moved from {formatDay(task.payload.movedFrom, { weekday: "short" })}
            </p>
          )}
          {task.skipped && (
            <p className="text-xs text-ink-3 leading-5 mt-0.5">
              Skipped{task.skipReason ? `: “${task.skipReason}”` : ""}
            </p>
          )}
        </div>
        {task.done && (
          <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-success">
            <Icon name="check_circle" size={16} filled /> Done
          </span>
        )}
      </div>
      {!task.done && (
        <div className="flex flex-wrap justify-end gap-2">
          {task.skipped ? (
            <button type="button" className="btn-ghost h-8 px-3 text-xs" onClick={() => onUnskip(task)}>
              <Icon name="undo" size={16} /> Unskip
            </button>
          ) : (
            <>
              <button type="button" className="btn-ghost h-8 px-3 text-xs" onClick={() => onSkip(task)}>
                Skip
              </button>
              <button type="button" className="btn-outline h-8 px-3 text-xs" onClick={() => onDone(task, true)}>
                <Icon name="check" size={16} /> Mark done
              </button>
              {startable && (
                <button type="button" className="btn-primary h-8 px-3 text-xs" disabled={starting} onClick={() => onStart(task)}>
                  {starting ? <Spinner /> : <Icon name="play_arrow" size={16} />} {task.sessionId && SESSION_TASKS.includes(task.type) ? "Resume" : meta.start}
                </button>
              )}
            </>
          )}
        </div>
      )}
      {task.done && (
        <button type="button" className="self-end btn-ghost h-8 px-3 text-xs" onClick={() => onDone(task, false)}>
          <Icon name="undo" size={16} /> Not done
        </button>
      )}
    </div>
  );
}

function DayCell({ day, today, selected, onSelect }) {
  const off = day.rest || day.afterExam;
  const scale = Math.max(day.budgetMinutes, day.plannedMinutes, 1);
  const diff = dayDiff(today, day.date);
  const name = WEEKDAYS.find(([d]) => d === day.weekday)?.[1] ?? day.weekday;
  return (
    <button
      type="button"
      onClick={() => onSelect(day.date)}
      aria-pressed={selected}
      aria-label={`${name} ${formatDay(day.date, { day: "numeric", month: "long" })}: ${off ? (day.rest ? "rest day" : "after the exam") : `${day.items.length} tasks, ${day.plannedMinutes} of ${day.budgetMinutes} minutes`}`}
      className={`min-w-0 overflow-hidden flex flex-col items-stretch gap-1.5 rounded-xl border p-1 sm:p-2 text-left transition-colors ${
        selected ? "border-accent bg-accent-soft/50" : diff === 0 ? "border-accent/60" : "border-line hover:bg-panel-2"
      } ${off ? "opacity-50" : ""}`}
    >
      <span className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between sm:gap-1">
        <span className={`text-[10px] sm:text-[11px] font-semibold uppercase sm:tracking-wide ${diff === 0 ? "text-accent" : "text-ink-3"}`}>{name.slice(0, 3)}</span>
        <span className="text-xs tabular-nums text-ink-2">{formatDay(day.date, { day: "numeric" })}</span>
      </span>
      {off ? (
        <span className="text-[11px] text-ink-3 h-[30px] flex items-center">{day.rest ? "Rest" : "—"}</span>
      ) : (
        <>
          {/* Minutes: planned (light) and done (green) against the day's budget. */}
          <span className="relative h-1.5 rounded-full bg-panel-3 overflow-hidden" aria-hidden="true">
            <span className="absolute inset-y-0 left-0 bg-accent/40 rounded-full" style={{ width: `${(day.plannedMinutes / scale) * 100}%` }} />
            <span className="absolute inset-y-0 left-0 bg-success rounded-full" style={{ width: `${(day.doneMinutes / scale) * 100}%` }} />
          </span>
          <span className="text-[11px] tabular-nums text-ink-3 truncate">
            {day.plannedMinutes}<span className="hidden sm:inline">/{day.budgetMinutes}</span>m
          </span>
          <span className="flex flex-wrap gap-0.5 min-h-[14px]" aria-hidden="true">
            {day.items.map((t) => (
              <Icon
                key={t.id}
                name={(TASK_META[t.type] ?? TASK_META.drill).icon}
                size={13}
                className={t.done ? "text-success" : t.skipped ? "text-ink-3 opacity-60" : "text-accent"}
              />
            ))}
          </span>
        </>
      )}
    </button>
  );
}

function ChangeList({ changes }) {
  const [all, setAll] = useState(false);
  if (!changes) return <div className="skeleton h-20 rounded-2xl" />;
  if (!changes.length) return <p className="text-sm text-ink-3">Nothing yet — changes appear here after each weekly plan and daily replan.</p>;
  const shown = all ? changes : changes.slice(0, CHANGES_SHOWN);
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-3">
        {shown.map((c) => (
          <li key={c.id} className="rounded-2xl border border-line p-3">
            <p className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
              <span className={`px-2 py-0.5 rounded-full font-semibold ${c.kind === "weekly" ? "bg-accent-soft text-accent-soft-fg" : "bg-panel-3 text-ink-2"}`}>
                {c.kind === "weekly" ? "Weekly plan" : "Daily update"}
              </span>
              {formatDay(c.date)} · {new Date(c.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
            </p>
            {c.summary && <p className="text-sm font-medium mt-1.5">{c.summary}</p>}
            <ul className="mt-1.5 flex flex-col gap-1">
              {c.lines.map((l, i) => (
                <li key={i} className="flex gap-2 text-sm text-ink-2 leading-5">
                  <Icon name={l.type === "none" ? "check" : l.type === "focus" ? "target" : "change_circle"} size={16} className="mt-0.5 shrink-0 text-ink-3" />
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {changes.length > CHANGES_SHOWN && (
        <button type="button" className="self-start text-sm text-ink-2 hover:text-ink flex items-center gap-1" onClick={() => setAll((v) => !v)}>
          <Icon name={all ? "expand_less" : "expand_more"} size={18} /> {all ? "Show fewer" : `Show all ${changes.length}`}
        </button>
      )}
    </div>
  );
}

/**
 * The agent's weekly plan for an exam: a 7-day strip (minutes per day, rest
 * day greyed out), the selected day's tasks (start / skip / mark done),
 * previous and next weeks, "Replan now" and what each (re)plan changed.
 */
export default function WeeklyPlan({ exam, onStartTask, onPlaySession, onOpenSchedule, onChanged }) {
  const [week, setWeek] = useState(null); // null = this week
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [changes, setChanges] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [busy, setBusy] = useState(null); // "make" | "replan"
  const [startingId, setStartingId] = useState(null);
  const [skipping, setSkipping] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const weekly = exam.planKind === "weekly";
  const view = data?.examId === exam.id ? data : null;

  const loadChanges = useCallback(() => api.planChanges(exam.id).then(setChanges, () => setChanges([])), [exam.id]);

  useEffect(() => {
    if (!weekly) return;
    let cancelled = false;
    api.weeklyPlan(exam.id, week).then(
      (w) => {
        if (cancelled) return;
        setData(w);
        setError(null);
      },
      (err) => !cancelled && setError(err.message)
    );
    loadChanges();
    return () => {
      cancelled = true;
    };
  }, [exam.id, week, weekly, loadChanges, reloadKey]);

  // While a background replan runs (first visit of the day), check back until it's done.
  useEffect(() => {
    if (!view?.replanning) return;
    const timer = setTimeout(() => {
      api.weeklyPlan(exam.id, week).then((w) => {
        setData(w);
        if (!w.replanning) loadChanges();
      }, () => {});
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [view, exam.id, week, loadChanges]);

  if (!weekly) {
    return (
      <div className="flex flex-col items-center text-center gap-3 py-10 px-6 rounded-3xl border border-dashed border-line">
        <Icon name="calendar_view_week" size={36} className="text-ink-3" />
        <p className="text-sm font-medium text-ink-2">This exam uses the day-by-day revision plan</p>
        <p className="text-xs text-ink-3 max-w-sm leading-5">
          Switch to a weekly plan: the agent fits each week to your study time, puts weak, high-weight topics and diagnosed mistakes first, and replans every day
          from your results.
        </p>
        <button type="button" className="btn-primary" onClick={() => onOpenSchedule("weekly")}>
          <Icon name="calendar_view_week" size={18} /> Set up a weekly plan
        </button>
      </div>
    );
  }

  if (error && !view) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-danger">{error}</p>
        <button type="button" className="btn-outline h-9 px-4 text-sm" onClick={() => setReloadKey((k) => k + 1)}>
          Try again
        </button>
      </div>
    );
  }
  if (!view) return <div className="skeleton h-56 rounded-3xl" />;

  const day = view.days.find((d) => d.date === selectedDay) ?? view.days.find((d) => d.date === view.today) ?? view.days.find((d) => d.items.length) ?? view.days[0];
  const updateItem = (item) => setData((w) => ({ ...w, days: w.days.map((d) => ({ ...d, items: d.items.map((i) => (i.id === item.id ? { ...i, ...item, nodeName: i.nodeName } : i)) })) }));
  // After a tick or skip: the week's totals and the exam header's counts.
  const refresh = () => {
    api.weeklyPlan(exam.id, week).then(setData, (err) => toast(err.message, "error"));
    onChanged?.();
  };

  const make = async () => {
    setBusy("make");
    try {
      setData(await api.generateWeeklyPlan(exam.id));
      setWeek(null);
      loadChanges();
      onChanged?.();
      toast("This week's plan is ready");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(null);
    }
  };

  const replan = async () => {
    setBusy("replan");
    try {
      const out = await api.replanWeek(exam.id);
      setData(out);
      setWeek(null);
      loadChanges();
      onChanged?.();
      const n = out.result?.lines?.filter((l) => l.type !== "none").length ?? 0;
      toast(out.result?.kind === "weekly" ? "New week planned" : n ? `Plan updated: ${n} change${n === 1 ? "" : "s"}` : "No changes needed today");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(null);
    }
  };

  const setDone = async (task, done) => {
    updateItem({ id: task.id, done, skipped: done ? false : task.skipped });
    try {
      updateItem(await api.setTaskDone(task.id, done));
      refresh();
    } catch (err) {
      toast(err.message, "error");
      updateItem(task);
    }
  };

  const skip = async (task, reason) => {
    try {
      updateItem(await api.skipTask(task.id, true, reason || undefined));
      setSkipping(null);
      refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const unskip = async (task) => {
    try {
      updateItem(await api.skipTask(task.id, false));
      refresh();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const start = async (task) => {
    if (!SESSION_TASKS.includes(task.type)) return onStartTask(task, exam);
    setStartingId(task.id);
    try {
      const { session } = await api.startTask(task.id);
      onPlaySession(session.id);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setStartingId(null);
    }
  };

  const { totals } = view;
  const ahead = dayDiff(view.today, view.weekStart);
  const weekLabel = view.isCurrentWeek
    ? "This week"
    : ahead > 0 && ahead <= 7
      ? "Next week"
      : ahead < 0 && dayDiff(view.today, view.weekEnd) >= -7
        ? "Last week"
        : `Week of ${formatDay(view.weekStart, { day: "numeric", month: "short" })}`;

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-3xl bg-panel border border-line p-4 sm:p-5 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 mr-auto">
            <button type="button" className="icon-btn" aria-label="Previous week" title="Previous week" onClick={() => setWeek(view.previousWeek)}>
              <Icon name="chevron_left" size={20} />
            </button>
            <div className="px-1 min-w-0">
              <p className="text-sm font-semibold">{weekLabel}</p>
              <p className="text-xs text-ink-3">
                {formatDay(view.weekStart, { day: "numeric", month: "short" })} – {formatDay(view.weekEnd, { day: "numeric", month: "short" })}
              </p>
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label="Next week"
              title="Next week"
              disabled={view.nextWeek > exam.examDate}
              onClick={() => setWeek(view.nextWeek)}
            >
              <Icon name="chevron_right" size={20} />
            </button>
          </div>
          {!view.isCurrentWeek && (
            <button type="button" className="btn-ghost h-9 px-3 text-sm" onClick={() => setWeek(null)}>
              Today
            </button>
          )}
          <button type="button" className="btn-ghost h-9 px-3 text-sm" onClick={() => onOpenSchedule()}>
            <Icon name="tune" size={18} /> Schedule
          </button>
          {view.planned && (
            <button type="button" className="btn-outline h-9 px-3 text-sm" disabled={Boolean(busy) || view.replanning} onClick={replan}>
              {busy === "replan" || view.replanning ? <Spinner /> : <Icon name="update" size={18} />} Replan now
            </button>
          )}
        </div>

        {view.replanning && (
          <p className="flex items-center gap-2 text-sm text-ink-2">
            <Spinner /> Updating today's plan from your latest results…
          </p>
        )}
        {view.isCurrentWeek && view.theme && <p className="text-sm text-ink-2 leading-6">{view.theme}</p>}

        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {view.days.map((d) => (
            <DayCell key={d.date} day={d} today={view.today} selected={d.date === day.date} onSelect={setSelectedDay} />
          ))}
        </div>

        {totals.tasks > 0 && (
          <p className="text-xs text-ink-3">
            {totals.done}/{totals.tasks} tasks done{totals.skipped ? ` · ${totals.skipped} skipped` : ""} · {formatMinutes(totals.doneMinutes)} of {formatMinutes(totals.plannedMinutes)} planned
            {totals.budgetMinutes ? ` (${formatMinutes(totals.budgetMinutes)} available)` : ""}
          </p>
        )}
      </section>

      {!view.planned ? (
        <div className="flex flex-col items-center text-center gap-3 py-8 px-6 rounded-3xl border border-dashed border-line">
          <Icon name="auto_awesome" size={32} className="text-ink-3" />
          <p className="text-sm font-medium text-ink-2">No weekly plan yet</p>
          <p className="text-xs text-ink-3 max-w-sm leading-5">The plan is made from the course's knowledge map, your mastery and diagnosed mistakes, within your study time.</p>
          <button type="button" className="btn-primary" disabled={Boolean(busy)} onClick={make}>
            {busy === "make" ? <Spinner /> : <Icon name="auto_awesome" size={18} />} Make this week's plan
          </button>
          {busy === "make" && <p className="text-xs text-ink-3">Planning your week… up to a minute</p>}
        </div>
      ) : (
        <section className="flex flex-col gap-3" aria-label="Tasks for the selected day">
          <h3 className="text-sm font-semibold">
            {dayDiff(view.today, day.date) === 0 ? "Today" : formatDay(day.date, { weekday: "long", day: "numeric", month: "long" })}
            {!day.rest && !day.afterExam && day.budgetMinutes > 0 && (
              <span className="font-normal text-ink-3">
                {" "}
                · {formatMinutes(day.plannedMinutes)} of {formatMinutes(day.budgetMinutes)}
              </span>
            )}
          </h3>
          {day.items.length === 0 ? (
            <p className="text-sm text-ink-3 py-4">
              {day.rest ? "Rest day — nothing planned." : day.afterExam ? "After the exam." : day.date < view.today ? "Nothing was planned for this day." : "Nothing planned for this day."}
            </p>
          ) : (
            day.items.map((t) => (
              <TaskCard key={t.id} task={t} starting={startingId === t.id} onStart={start} onDone={setDone} onSkip={setSkipping} onUnskip={unskip} />
            ))
          )}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">What changed</h3>
        <ChangeList changes={changes} />
      </section>

      {skipping && <SkipDialog task={skipping} onClose={() => setSkipping(null)} onSkip={skip} />}
    </div>
  );
}
