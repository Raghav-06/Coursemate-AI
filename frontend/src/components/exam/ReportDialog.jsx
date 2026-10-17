import { useState } from "react";
import { api } from "../../api";
import { Modal, Spinner, toast } from "../ui";

const REASONS = [
  ["wrong_key", "The answer key is wrong"],
  ["unclear", "The question is unclear or ambiguous"],
  ["out_of_syllabus", "It's outside the syllabus"],
  ["other", "Something else"],
];

/** "Report a problem" on a question: hides it for everyone in the course and logs the report. */
export default function ReportDialog({ question, onClose, onReported }) {
  const [reason, setReason] = useState("wrong_key");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api.reportQuestion(question.id, { reason, note: note.trim() || undefined });
      toast("Thanks — the question is hidden and logged for review");
      onReported?.(question);
      onClose();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Report a problem"
      width="max-w-md"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
            {busy && <Spinner />} Report
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="What's wrong">
        {REASONS.map(([id, label]) => (
          <label key={id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer ${reason === id ? "border-accent bg-accent-soft" : "border-line"}`}>
            <input type="radio" name="reason" value={id} checked={reason === id} onChange={() => setReason(id)} className="accent-[rgb(var(--accent))]" />
            <span className="text-sm">{label}</span>
          </label>
        ))}
        <textarea className="input mt-2 min-h-20" maxLength={1000} placeholder="Details (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Details" />
      </div>
    </Modal>
  );
}
