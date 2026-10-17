import { useState } from "react";
import { api } from "../../api";
import { Modal, Segmented, Spinner, toast } from "../ui";
import NodePicker from "./NodePicker";

/** Choose map nodes, how many questions, formats and difficulty; starts a generation job. */
export default function GenerateQuestionsDialog({ notebookId, nodes, profile, initialNodeIds = [], onClose, onStarted }) {
  const [picked, setPicked] = useState(initialNodeIds.slice(0, 5));
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState("mixed");
  const [formats, setFormats] = useState([]); // [] = the exam's mix
  const [busy, setBusy] = useState(false);
  const allFormats = profile?.formats ?? [];

  const start = async () => {
    setBusy(true);
    try {
      const job = await api.generateQuestions(notebookId, { nodeIds: picked, count, difficulty, ...(formats.length ? { formats } : {}) });
      onStarted(job);
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
      title="New practice questions"
      width="max-w-xl"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={start} disabled={busy || picked.length === 0}>
            {busy && <Spinner />} Generate {count}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm text-ink-2">
          Questions are written from your notes in the {profile?.name ?? "exam"} pattern, then <b>solved independently</b> by a second model before you see them — any whose answer doesn't match the key are rewritten or dropped.
        </p>
        <div>
          <p className="text-sm font-medium mb-2">Topics</p>
          <NodePicker nodes={nodes} value={picked} onChange={setPicked} />
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <div>
            <p className="text-sm font-medium mb-2">How many</p>
            <Segmented label="How many questions" value={count} onChange={setCount} options={[[5, "5"], [10, "10"], [15, "15"]]} />
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Difficulty</p>
            <Segmented label="Difficulty" value={difficulty} onChange={setDifficulty} options={[["mixed", "Mixed"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]]} />
          </div>
        </div>
        {allFormats.length > 1 && (
          <div>
            <p className="text-sm font-medium mb-2">Formats</p>
            <div className="flex flex-wrap gap-1.5">
              {allFormats.map((f) => {
                const on = formats.includes(f.id);
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFormats((list) => (on ? list.filter((x) => x !== f.id) : [...list, f.id]))}
                    className={`h-8 px-3 rounded-lg border text-sm ${on ? "border-accent bg-accent text-accent-fg" : "border-line hover:bg-panel-2"}`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-ink-3 mt-1.5">None picked = the exam's usual mix.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
