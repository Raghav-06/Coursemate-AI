import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { ConfirmDialog, Icon, Menu, Modal, Spinner, toast } from "../ui";
import UnitChecklist from "../study/UnitChecklist";
import TaskRow from "./TaskRow";
import { countdown, dayDiff, formatDay } from "./planUtils";

function ExamDialog({ open, exam, units, sources, today, onClose, onSave }) {
  const [name, setName] = useState(exam?.name ?? "");
  const [date, setDate] = useState(exam?.examDate ?? "");
  const [unitIds, setUnitIds] = useState(exam?.unitIds ?? []);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave({ name: name.trim(), examDate: date, unitIds });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title={exam ? "Edit exam" : "Add an exam"} width="max-w-lg" bodyClassName="px-6 pb-6">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
          Exam name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. End-semester exam" autoFocus required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
          Date
          <input className="input" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-2">Units in this exam</span>
          <UnitChecklist units={units} sources={sources} value={unitIds} onChange={setUnitIds} />
        </div>
        <div className="flex items-center justify-end gap-3 pt-1">
          {busy && !exam && <span className="text-xs text-ink-3">Planning your revision… up to a minute</span>}
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim() || !date}>
            {busy ? <Spinner /> : <Icon name={exam ? "check" : "event_available"} size={18} />}
            {exam ? "Save" : "Add & make my plan"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DayGroup({ date, today, items, onToggle, onStart, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);
  const done = items.filter((i) => i.done).length;
  const diff = dayDiff(today, date);
  const label = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : formatDay(date);
  return (
    <section className={`rounded-2xl border ${diff === 0 ? "border-accent bg-accent-soft/40" : "border-line"} overflow-hidden`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center gap-2 px-4 h-12 text-left">
        <Icon name={open ? "expand_more" : "chevron_right"} size={20} className="text-ink-3" />
        <span className="text-sm font-semibold">{label}</span>
        {diff !== 0 && Math.abs(diff) > 1 && <span className="text-xs text-ink-3">{diff > 0 ? `in ${diff} days` : ""}</span>}
        {diff === 0 || Math.abs(diff) <= 1 ? <span className="text-xs text-ink-3">{formatDay(date)}</span> : null}
        <span className={`ml-auto text-xs tabular-nums ${done === items.length ? "text-success font-semibold" : "text-ink-3"}`}>
          {done}/{items.length}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {items.map((item) => (
            <TaskRow key={item.id} task={item} onToggle={onToggle} onStart={onStart} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Exam plan for a course: the user's exams with a day-by-day revision plan
 * (tick tasks off, start them, re-plan missed days, regenerate).
 */
export default function ExamPlanPanel({ notebook, units, sources, onStartTask }) {
  const [exams, setExams] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setExam] = useState(null); // the selected exam with its plan items
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // "new" | "edit"
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const exam = detail?.id === selected ? detail : null;

  const loadList = useCallback(
    () =>
      api.listExams(notebook.id).then(
        (list) => {
          setExams(list);
          setError(null);
          setSelected((id) => (list.some((e) => e.id === id) ? id : list[0]?.id ?? null));
        },
        (err) => setError(err.message)
      ),
    [notebook.id]
  );

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    api.getExam(selected).then(
      (e) => !cancelled && setExam(e),
      (err) => !cancelled && toast(err.message, "error")
    );
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const run = async (fn, message) => {
    setBusy(true);
    try {
      const updated = await fn();
      setExam(updated);
      if (message) toast(message);
      loadList();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const create = async (body) => {
    try {
      const created = await api.createExam(notebook.id, body);
      setDialog(null);
      setSelected(created.id);
      await run(() => api.generatePlan(created.id), "Your revision plan is ready");
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const save = async (body) => {
    try {
      setExam(await api.updateExam(exam.id, body));
      setDialog(null);
      loadList();
      toast("Saved — regenerate the plan to apply the changes");
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const remove = async () => {
    try {
      await api.deleteExam(exam.id);
      setSelected(null);
      loadList();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const toggle = async (task, done) => {
    setExam((e) => ({ ...e, items: e.items.map((i) => (i.id === task.id ? { ...i, done } : i)) }));
    try {
      await api.setTaskDone(task.id, done);
    } catch (err) {
      toast(err.message, "error");
      setExam((e) => ({ ...e, items: e.items.map((i) => (i.id === task.id ? { ...i, done: !done } : i)) }));
    }
  };

  const today = exam?.today;
  const items = exam?.items ?? [];
  const byDay = new Map();
  for (const item of items) byDay.set(item.date, [...(byDay.get(item.date) ?? []), item]);
  const dates = [...byDay.keys()].sort();
  const past = dates.filter((d) => d < today);
  const upcoming = dates.filter((d) => d >= today);
  const doneCount = items.filter((i) => i.done).length;
  const daysLeft = exam ? dayDiff(today, exam.examDate) : 0;

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-xl font-semibold mr-auto">Revision plan</h2>
          <button type="button" className="btn-outline h-9 px-4 text-sm" onClick={() => setDialog("new")}>
            <Icon name="add" size={18} /> Add exam
          </button>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        {!exams && !error && <div className="skeleton h-32 rounded-3xl" />}

        {exams?.length === 0 && (
          <div className="flex flex-col items-center text-center gap-3 py-10 px-6 rounded-3xl border border-dashed border-line">
            <Icon name="event_upcoming" size={36} className="text-ink-3" />
            <p className="text-sm font-medium text-ink-2">No exam yet</p>
            <p className="text-xs text-ink-3 max-w-sm leading-5">
              Add your exam date and the units it covers. CourseMate plans every day until then from your weak topics, what past papers ask most, and the flashcards
              you have due.
            </p>
            <button type="button" className="btn-primary" onClick={() => setDialog("new")}>
              <Icon name="event_available" size={18} /> Add your exam
            </button>
          </div>
        )}

        {exams?.length > 1 && (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Exams">
            {exams.map((e) => (
              <button
                key={e.id}
                type="button"
                role="tab"
                aria-selected={e.id === selected}
                onClick={() => setSelected(e.id)}
                className={`h-9 px-4 rounded-full text-sm font-medium border ${e.id === selected ? "border-accent bg-accent-soft text-accent-soft-fg" : "border-line text-ink-2 hover:bg-panel-2"}`}
              >
                {e.name} · {formatDay(e.examDate, { day: "numeric", month: "short" })}
              </button>
            ))}
          </div>
        )}

        {selected && !exam && <div className="skeleton h-40 rounded-3xl" />}

        {exam && (
          <>
            <section className="rounded-3xl bg-panel border border-line p-5 flex flex-wrap items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-accent text-accent-fg flex flex-col items-center justify-center leading-none">
                <span className="text-2xl font-semibold tabular-nums">{Math.max(0, daysLeft)}</span>
                <span className="text-[10px] uppercase tracking-wide mt-1">{daysLeft === 1 ? "day" : "days"}</span>
              </div>
              <div className="flex-1 min-w-[180px]">
                <p className="font-display text-lg font-semibold">{exam.name}</p>
                <p className="text-sm text-ink-2">
                  {countdown(daysLeft)} · {formatDay(exam.examDate, { weekday: "long", day: "numeric", month: "long" })}
                </p>
                <p className="text-xs text-ink-3 mt-0.5">
                  {exam.unitIds.length ? exam.unitIds.map((id) => (id === "general" ? "General" : units.find((u) => u.id === id)?.title ?? "Removed unit")).join(", ") : "Whole course"}
                  {items.length ? ` · ${doneCount}/${items.length} tasks done` : ""}
                </p>
              </div>
              <Menu
                items={[
                  { label: items.length ? "Regenerate plan" : "Make my plan", icon: "auto_awesome", onClick: () => run(() => api.generatePlan(exam.id), "Plan updated") },
                  { label: "Edit exam", icon: "edit", onClick: () => setDialog("edit") },
                  { label: "Delete exam", icon: "delete", danger: true, onClick: () => setDeleting(true) },
                ]}
              />
              {items.length > 0 && (
                <div className="basis-full h-2 rounded-full bg-panel-3 overflow-hidden">
                  <div className="h-full bg-success rounded-full" style={{ width: `${(doneCount / items.length) * 100}%` }} />
                </div>
              )}
            </section>

            {busy && (
              <p className="flex items-center gap-2 text-sm text-ink-2">
                <Spinner /> Planning your revision…
              </p>
            )}

            {!busy && items.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-sm text-ink-2">No plan yet for this exam.</p>
                <button type="button" className="btn-primary" onClick={() => run(() => api.generatePlan(exam.id), "Your revision plan is ready")}>
                  <Icon name="auto_awesome" size={18} /> Make my plan
                </button>
              </div>
            )}

            {exam.missedCount > 0 && (
              <div className="flex flex-wrap items-center gap-3 p-4 rounded-2xl bg-amber-400/15 border border-amber-400/40">
                <Icon name="event_busy" size={22} className="text-amber-600 dark:text-amber-300" />
                <p className="flex-1 min-w-[180px] text-sm">
                  {exam.missedCount} task{exam.missedCount === 1 ? "" : "s"} from earlier days {exam.missedCount === 1 ? "isn't" : "aren't"} done yet.
                </p>
                <button type="button" className="btn-primary h-9 px-4 text-sm" disabled={busy} onClick={() => run(() => api.replanExam(exam.id), "Missed tasks moved to the coming days")}>
                  <Icon name="update" size={18} /> Re-plan missed days
                </button>
              </div>
            )}

            {upcoming.length > 0 && upcoming[0] > today && (
              <p className="text-sm text-ink-3">Your plan starts on {formatDay(upcoming[0], { weekday: "long", day: "numeric", month: "long" })} — study ahead any time.</p>
            )}

            {past.length > 0 && (
              <button type="button" className="self-start text-sm text-ink-2 hover:text-ink flex items-center gap-1" onClick={() => setShowPast((v) => !v)}>
                <Icon name={showPast ? "expand_less" : "expand_more"} size={18} /> {showPast ? "Hide" : "Show"} earlier days ({past.length})
              </button>
            )}
            <div className="flex flex-col gap-3">
              {showPast &&
                past.map((d) => <DayGroup key={d} date={d} today={today} items={byDay.get(d)} onToggle={toggle} onStart={(task) => onStartTask(task, exam)} defaultOpen={false} />)}
              {upcoming.map((d, i) => (
                <DayGroup key={d} date={d} today={today} items={byDay.get(d)} onToggle={toggle} onStart={(task) => onStartTask(task, exam)} defaultOpen={i < 2} />
              ))}
            </div>
          </>
        )}
      </div>

      {dialog && (
        <ExamDialog
          open
          exam={dialog === "edit" ? exam : null}
          units={units}
          sources={sources}
          today={today ?? new Date().toISOString().slice(0, 10)}
          onClose={() => setDialog(null)}
          onSave={dialog === "edit" ? save : create}
        />
      )}
      <ConfirmDialog open={deleting} title="Delete exam?" message={`"${exam?.name}" and its revision plan will be deleted.`} onConfirm={remove} onClose={() => setDeleting(false)} />
    </div>
  );
}
