import { useEffect, useState } from "react";
import { api } from "../../api";
import Markdown from "../Markdown";
import { ConfirmDialog, Icon, IconButton, Spinner, toast } from "../ui";
import CitationLink from "./CitationLink";
import { cardCitation } from "./citations";

function dueLabel(review) {
  if (!review) return "New";
  const ms = new Date(review.dueAt) - Date.now();
  if (ms <= 0) return "Due now";
  const days = Math.round(ms / 86_400_000);
  return days < 1 ? "Due today" : `Due in ${days}d`;
}

function CardForm({ initial = {}, submitLabel, onSubmit, onCancel }) {
  const [front, setFront] = useState(initial.front ?? "");
  const [back, setBack] = useState(initial.back ?? "");
  const [topic, setTopic] = useState(initial.topic ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSubmit({ front: front.trim(), back: back.trim(), topic: topic.trim() || null });
      if (!initial.front) {
        setFront("");
        setBack("");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 p-4 rounded-2xl border border-line bg-panel-2/50">
      <textarea className="input min-h-[60px] resize-y" placeholder="Front — question or prompt" value={front} maxLength={500} onChange={(e) => setFront(e.target.value)} autoFocus={!initial.front} />
      <textarea className="input min-h-[80px] resize-y" placeholder="Back — answer" value={back} maxLength={2000} onChange={(e) => setBack(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        <input className="input flex-1 min-w-[160px]" placeholder="Topic (optional)" value={topic} maxLength={80} onChange={(e) => setTopic(e.target.value)} />
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn-primary" disabled={busy || !front.trim() || !back.trim()}>
          {busy && <Spinner />} {submitLabel}
        </button>
      </div>
    </form>
  );
}

/** Lists a deck's cards for adding, editing and deleting; renames the deck. */
export default function DeckEditor({ deckId, units, onBack, onStudy, onDeleted, onChanged, onOpenCitation }) {
  const [deck, setDeck] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [deletingDeck, setDeletingDeck] = useState(false);
  const [title, setTitle] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.getDeck(deckId).then(
      (d) => {
        if (cancelled) return;
        setDeck(d);
        setTitle(d.title);
      },
      (err) => !cancelled && setError(err.message)
    );
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  const saveDeck = async (patch) => {
    try {
      const updated = await api.updateDeck(deckId, patch);
      setDeck((d) => ({ ...d, ...updated }));
      onChanged?.();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const addCard = async (fields) => {
    try {
      const card = await api.addCard(deckId, fields);
      setDeck((d) => ({ ...d, cards: [...d.cards, card] }));
      onChanged?.();
    } catch (err) {
      toast(err.message, "error");
      throw err;
    }
  };

  const updateCard = async (id, fields) => {
    try {
      const card = await api.updateCard(id, fields);
      setDeck((d) => ({ ...d, cards: d.cards.map((c) => (c.id === id ? card : c)) }));
      setEditing(null);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const removeCard = async (id) => {
    try {
      await api.deleteCard(id);
      setDeck((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }));
      onChanged?.();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const removeDeck = async () => {
    try {
      await api.deleteDeck(deckId);
      onDeleted();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  if (error || !deck) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center px-3 h-12 border-b border-line/60">
          <IconButton icon="arrow_back" label="Back to decks" onClick={onBack} />
        </div>
        <div className="flex-1 flex items-center justify-center text-ink-3">{error ? <p className="text-sm text-danger">{error}</p> : <Spinner className="w-6 h-6" />}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 h-12 border-b border-line/60 shrink-0">
        <IconButton icon="arrow_back" label="Back to decks" onClick={onBack} />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => (title.trim() && title.trim() !== deck.title ? saveDeck({ title: title.trim() }) : setTitle(deck.title))}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          maxLength={120}
          aria-label="Deck name"
          className="flex-1 min-w-0 bg-transparent text-sm font-medium rounded-lg px-2 py-1 hover:bg-panel-2 focus:bg-panel focus:outline-hidden focus:ring-2 focus:ring-accent/50"
        />
        <IconButton icon="delete" label="Delete deck" onClick={() => setDeletingDeck(true)} />
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary" onClick={() => onStudy(deck)} disabled={deck.cards.length === 0}>
              <Icon name="play_arrow" size={18} /> Study this deck
            </button>
            <button type="button" className="btn-outline" onClick={() => setAdding((a) => !a)}>
              <Icon name="add" size={18} /> Add card
            </button>
            {units.length > 0 && (
              <select
                value={deck.unitId ?? ""}
                onChange={(e) => saveDeck({ unitId: e.target.value || null })}
                className="input w-auto! py-1.5! ml-auto"
                aria-label="Unit of this deck"
              >
                <option value="">No unit</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          {adding && <CardForm submitLabel="Add card" onSubmit={addCard} onCancel={() => setAdding(false)} />}

          <p className="text-xs text-ink-3">
            {deck.cards.length} card{deck.cards.length === 1 ? "" : "s"}
          </p>
          {deck.cards.length === 0 && !adding && <p className="text-sm text-ink-3 py-6 text-center">This deck is empty. Add your first card.</p>}

          {deck.cards.map((card, i) =>
            editing === card.id ? (
              <CardForm key={card.id} initial={card} submitLabel="Save" onSubmit={(f) => updateCard(card.id, f)} onCancel={() => setEditing(null)} />
            ) : (
              <div key={card.id} className="group rounded-2xl border border-line bg-panel p-4">
                <div className="flex items-start gap-3">
                  <span className="text-xs text-ink-3 tabular-nums pt-1 w-6 shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0 grid sm:grid-cols-2 gap-3">
                    <Markdown text={card.front} className="text-sm! leading-6! font-medium" />
                    <Markdown text={card.back} className="text-sm! leading-6! text-ink-2" />
                  </div>
                  <div className="flex shrink-0 opacity-60 group-hover:opacity-100">
                    <IconButton icon="edit" label="Edit card" onClick={() => setEditing(card.id)} className="w-8! h-8!" size={18} />
                    <IconButton icon="delete" label="Delete card" onClick={() => removeCard(card.id)} className="w-8! h-8!" size={18} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-3 pl-9 text-xs text-ink-3">
                  {card.topic && <span className="px-2 py-0.5 rounded-md bg-panel-2">{card.topic}</span>}
                  <span>{dueLabel(card.review)}</span>
                  <CitationLink citation={cardCitation(card)} onOpen={onOpenCitation} />
                </div>
              </div>
            )
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deletingDeck}
        title="Delete deck?"
        message={`"${deck.title}" and its ${deck.cards.length} cards will be deleted, including everyone's review progress on them.`}
        onConfirm={removeDeck}
        onClose={() => setDeletingDeck(false)}
      />
    </div>
  );
}
