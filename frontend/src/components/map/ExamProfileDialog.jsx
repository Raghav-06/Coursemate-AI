import { useEffect, useState } from "react";
import { api } from "../../api";
import { Icon, Modal, Spinner } from "../ui";
import { toast } from "../uiUtils";

const MAX_SUBJECTS = 12;

const marking = (f) => {
  const neg = f.negative ? `−${Number.isInteger(f.negative) ? f.negative : `${Math.round(f.negative * 3)}/3`}` : "no negative";
  return f.type === "descriptive" ? `${f.marks} marks` : `+${f.marks} / ${neg}`;
};

/** Picks the course's exam (JEE Main, NEET, GATE…) and which of its subjects the course covers. */
export default function ExamProfileDialog({ notebookId, open, current, onClose, onSaved }) {
  const [profiles, setProfiles] = useState(null);
  const [error, setError] = useState(null);
  const [type, setType] = useState(current?.examType ?? "");
  const [subjects, setSubjects] = useState(current?.settings?.subjects ?? []);
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState(false);

  // The form starts from the saved profile each time the dialog opens (or that profile changes).
  const [formFor, setFormFor] = useState(open ? current ?? null : undefined);
  const target = open ? current ?? null : undefined;
  if (formFor !== target) {
    setFormFor(target);
    if (open) {
      setType(current?.examType ?? "");
      setSubjects(current?.settings?.subjects ?? []);
    }
  }
  useEffect(() => {
    if (open && !profiles) api.examProfiles().then(setProfiles, (err) => setError(err.message));
  }, [open, profiles]);

  const profile = profiles?.find((p) => p.type === type);
  const toggle = (s) => setSubjects((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]));
  const addCustom = () => {
    const name = custom.trim();
    if (name && !subjects.some((s) => s.toLowerCase() === name.toLowerCase()) && subjects.length < MAX_SUBJECTS) setSubjects([...subjects, name]);
    setCustom("");
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = type ? { examType: type, subjects: profile?.custom ? subjects : subjects.filter((s) => profile.subjects.includes(s)) } : { examType: null };
      onSaved(await api.setExamProfile(notebookId, body));
      toast(type ? `This course now prepares for ${profile.name}` : "Exam cleared");
      onClose();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Exam for this course"
      width="max-w-xl"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={save} disabled={saving || !profiles || (profile?.custom && subjects.length === 0)}>
            {saving && <Spinner />} Save
          </button>
        </>
      }
    >
      {error && <p className="text-sm text-danger">{error}</p>}
      {!profiles && !error && <Spinner className="w-5 h-5 text-ink-3" />}
      {profiles && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Exam">
            {profiles.map((p) => (
              <button
                key={p.type}
                type="button"
                role="radio"
                aria-checked={type === p.type}
                onClick={() => {
                  setType(p.type);
                  setSubjects(p.type === current?.examType ? current?.settings?.subjects ?? [] : []);
                }}
                className={`h-12 px-3 rounded-xl border text-sm font-medium text-left transition-colors ${type === p.type ? "border-accent bg-accent-soft text-accent-soft-fg" : "border-line hover:bg-panel-2"}`}
              >
                {p.name}
              </button>
            ))}
          </div>
          {profile && (
            <>
              <div>
                <p className="text-sm font-medium mb-2">{profile.custom ? "Subjects or papers in this course" : "Subjects this course covers"}</p>
                {profile.custom ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      {subjects.map((s) => (
                        <span key={s} className="inline-flex items-center gap-1 h-8 pl-3 pr-1 rounded-lg bg-panel-2 text-sm">
                          {s}
                          <button type="button" className="icon-btn w-6! h-6!" aria-label={`Remove ${s}`} onClick={() => toggle(s)}>
                            <Icon name="close" size={16} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        addCustom();
                      }}
                    >
                      <input className="input flex-1" maxLength={60} placeholder="e.g. Thermodynamics" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Subject name" />
                      <button type="submit" className="btn-outline" disabled={!custom.trim()}>
                        Add
                      </button>
                    </form>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.subjects.map((s) => (
                        <button
                          key={s}
                          type="button"
                          aria-pressed={subjects.includes(s)}
                          onClick={() => toggle(s)}
                          className={`h-8 px-3 rounded-lg border text-sm ${subjects.includes(s) ? "border-accent bg-accent text-accent-fg" : "border-line hover:bg-panel-2"}`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-ink-3 mt-1.5">None picked = all of them.</p>
                  </>
                )}
              </div>
              <div>
                <p className="text-sm font-medium mb-2">Question formats and marking</p>
                <ul className="text-sm text-ink-2 flex flex-col gap-1">
                  {profile.formats.map((f) => (
                    <li key={f.id} className="flex justify-between gap-3">
                      <span>{f.label}</span>
                      <span className="tabular-nums text-ink-3">{marking(f)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
          {current?.examType && (
            <button type="button" className="self-start text-xs text-ink-3 hover:underline" onClick={() => setType("")}>
              {type ? "Not preparing for a specific exam" : "No exam selected — save to clear it"}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
