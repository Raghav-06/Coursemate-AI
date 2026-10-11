import { useState } from "react";
import { api } from "../../api";
import { Icon, Modal, Segmented, Spinner, toast } from "../ui";
import UnitChecklist from "./UnitChecklist";

/** Generates a flashcard deck from chosen units (or the whole course). */
export default function GenerateDeckDialog({ open, notebookId, units, sources, initialUnitIds = [], onClose, onCreated }) {
  const [title, setTitle] = useState("");
  const [unitIds, setUnitIds] = useState(initialUnitIds);
  const [count, setCount] = useState(20);
  const [difficulty, setDifficulty] = useState("medium");
  const [busy, setBusy] = useState(false);
  const ready = sources.filter((s) => s.status === "ready").length;

  const generate = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const deck = await api.generateDeck(notebookId, { title: title.trim() || undefined, unitIds, count, difficulty });
      toast(`Created "${deck.title}" with ${deck.cards.length} cards`);
      onCreated(deck);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} title="Generate flashcards" width="max-w-lg" bodyClassName="px-6 pb-6">
      {ready === 0 ? (
        <p className="text-sm text-ink-2 py-4">Add a source and wait for it to finish processing before generating flashcards.</p>
      ) : (
        <form onSubmit={generate} className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink-2">
            Deck name <span className="font-normal text-ink-3">(optional)</span>
            <input className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Named after the unit if left empty" />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">Make cards from</span>
            <UnitChecklist units={units} sources={sources} value={unitIds} onChange={setUnitIds} />
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink-2">Cards</span>
              <Segmented label="Number of cards" value={count} onChange={setCount} options={[[10, "10"], [20, "20"], [30, "30"]]} />
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
              Generate
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
