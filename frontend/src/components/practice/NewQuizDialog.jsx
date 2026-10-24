import { useState } from "react";
import { api } from "../../api";
import { Icon, Modal, Segmented, Spinner } from "../ui";
import UnitChecklist from "../study/UnitChecklist";
import { toast } from "../uiUtils";

/** Generates a multiple-choice quiz from chosen units (or the whole course). */
export default function NewQuizDialog({ open, notebookId, units, sources, onClose, onCreated }) {
  const [unitIds, setUnitIds] = useState([]);
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState("medium");
  const [busy, setBusy] = useState(false);
  const ready = sources.filter((s) => s.status === "ready").length;

  const generate = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      onCreated(await api.createQuiz(notebookId, { unitIds, count, difficulty }));
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title="New quiz" width="max-w-lg" bodyClassName="px-6 pb-6">
      {ready === 0 ? (
        <p className="text-sm text-ink-2 py-4">Add a source and wait for it to finish processing before making a quiz.</p>
      ) : (
        <form onSubmit={generate} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Questions from</span>
            <UnitChecklist units={units} sources={sources} value={unitIds} onChange={setUnitIds} />
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Questions</span>
              <Segmented label="Number of questions" value={count} onChange={setCount} options={[[5, "5"], [10, "10"], [15, "15"], [20, "20"]]} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Difficulty</span>
              <Segmented label="Difficulty" value={difficulty} onChange={setDifficulty} options={[["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]]} />
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 pt-1">
            {busy && <span className="text-xs text-ink-3">This can take up to a minute…</span>}
            <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? <Spinner /> : <Icon name="auto_awesome" size={18} />}
              Make quiz
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
