import { Icon } from "../ui";
import { TASK_META } from "./planUtils";

/** One task of a revision plan: tick it off, or start it (when `onStart` is given). */
export default function TaskRow({ task, onToggle, onStart, compact = false }) {
  const meta = TASK_META[task.type] ?? TASK_META.read;
  return (
    <div className={`group flex items-start gap-3 ${compact ? "py-2" : "p-3 rounded-2xl border border-line bg-panel"} ${task.done ? "opacity-60" : ""}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
        onClick={() => onToggle(task, !task.done)}
        className={`mt-0.5 w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
          task.done ? "bg-success border-success text-white" : "border-line hover:border-accent"
        }`}
      >
        {task.done && <Icon name="check" size={16} />}
      </button>
      <Icon name={meta.icon} size={20} className="mt-0.5 shrink-0 text-accent" />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium leading-6 ${task.done ? "line-through" : ""}`}>{task.title}</p>
        {task.details && !compact && <p className="text-xs text-ink-3 leading-5">{task.details}</p>}
      </div>
      {onStart && !task.done && (
        <button type="button" className="btn-outline h-8 px-3 text-xs shrink-0" onClick={() => onStart(task)}>
          {meta.start}
        </button>
      )}
    </div>
  );
}
