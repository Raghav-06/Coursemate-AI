import { useMemo, useState } from "react";
import { Icon, Modal, Segmented, Spinner } from "../ui";
import { WEEKDAYS } from "./planUtils";

const DEFAULT_MINUTES = { mon: 120, tue: 120, wed: 120, thu: 120, fri: 120, sat: 180, sun: 180 };
const SESSION_LENGTHS = [25, 30, 45, 60, 90, 120];

const browserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const timezoneList = () => {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
};

/**
 * Weekly-plan settings of an exam: plan type, study minutes per weekday,
 * session length, rest day, timezone (default: the browser's) and the day the
 * study week starts. `onSave(body)` gets the PATCH …/schedule body.
 */
export default function ScheduleDialog({ open, exam, initialKind, onClose, onSave }) {
  const [planKind, setPlanKind] = useState(initialKind ?? exam.planKind ?? "weekly");
  const [minutes, setMinutes] = useState(() => ({ ...DEFAULT_MINUTES, ...(exam.studyMinutes ?? {}) }));
  const [sessionMinutes, setSessionMinutes] = useState(exam.sessionMinutes ?? 45);
  const [restDay, setRestDay] = useState(exam.restDay ?? "");
  const [timezone, setTimezone] = useState(exam.timezone || browserTimezone());
  const [weekStartsOn, setWeekStartsOn] = useState(exam.weekStartsOn ?? "mon");
  const [busy, setBusy] = useState(false);
  const zones = useMemo(() => timezoneList(), []);

  const invalid = WEEKDAYS.some(([d]) => d !== restDay && !(minutes[d] >= 15 && minutes[d] <= 600));
  const total = WEEKDAYS.reduce((s, [d]) => s + (d === restDay ? 0 : Number(minutes[d]) || 0), 0);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      // The rest day keeps its last minutes (the planner skips it anyway), within the allowed range.
      const studyMinutes = Object.fromEntries(WEEKDAYS.map(([d]) => [d, Math.min(600, Math.max(15, Math.round(Number(minutes[d]) || 15)))]));
      await onSave({ planKind, studyMinutes, sessionMinutes: Number(sessionMinutes), restDay: restDay || null, timezone, weekStartsOn });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title="Study schedule" width="max-w-xl" bodyClassName="px-6 pb-6">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-2">Plan type</span>
          <Segmented
            label="Plan type"
            value={planKind}
            onChange={setPlanKind}
            options={[
              ["weekly", "Weekly plan"],
              ["revision", "Day-by-day revision"],
            ]}
          />
          <p className="text-xs text-ink-3 leading-5">
            {planKind === "weekly"
              ? "The agent plans each week from your knowledge map, mastery and diagnosed mistakes, and adjusts it every day from your results."
              : "A fixed day-by-day plan to the exam: read, quiz, answer writing and past papers per topic."}
          </p>
        </div>

        {planKind === "weekly" && (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-ink-2 mb-1.5">Daily study time (minutes)</legend>
              <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
                {WEEKDAYS.map(([d, name]) => (
                  <label key={d} className={`flex flex-col gap-1 text-xs font-medium ${d === restDay ? "text-ink-3" : "text-ink-2"}`}>
                    {name.slice(0, 3)}
                    <input
                      className="input h-9 px-2 text-sm tabular-nums disabled:opacity-50"
                      type="number"
                      min={15}
                      max={600}
                      step={5}
                      value={d === restDay ? "" : minutes[d]}
                      placeholder={d === restDay ? "Rest" : undefined}
                      disabled={d === restDay}
                      aria-label={`${name} study minutes`}
                      onChange={(e) => setMinutes((m) => ({ ...m, [d]: e.target.value === "" ? "" : Number(e.target.value) }))}
                    />
                  </label>
                ))}
              </div>
              <p className={`text-xs ${invalid ? "text-danger" : "text-ink-3"}`}>
                {invalid ? "Each study day needs 15 to 600 minutes." : `About ${Math.round(total / 6) / 10} hours a week.`}
              </p>
            </fieldset>

            <div className="grid sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
                Session length
                <select className="input" value={sessionMinutes} onChange={(e) => setSessionMinutes(Number(e.target.value))}>
                  {[...new Set([...SESSION_LENGTHS, Number(sessionMinutes)])].sort((a, b) => a - b).map((m) => (
                    <option key={m} value={m}>
                      {m} minutes
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
                Rest day
                <select className="input" value={restDay} onChange={(e) => setRestDay(e.target.value)}>
                  <option value="">No rest day</option>
                  {WEEKDAYS.map(([d, name]) => (
                    <option key={d} value={d}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
                Week starts on
                <select className="input" value={weekStartsOn} onChange={(e) => setWeekStartsOn(e.target.value)}>
                  {WEEKDAYS.map(([d, name]) => (
                    <option key={d} value={d}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
                Timezone
                <input className="input" list="schedule-timezones" value={timezone} onChange={(e) => setTimezone(e.target.value)} maxLength={64} required />
                <datalist id="schedule-timezones">
                  {zones.map((z) => (
                    <option key={z} value={z} />
                  ))}
                </datalist>
              </label>
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-3 pt-1">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || (planKind === "weekly" && (invalid || !timezone.trim()))}>
            {busy ? <Spinner /> : <Icon name="check" size={18} />}
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
