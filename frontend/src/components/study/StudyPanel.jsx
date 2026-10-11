import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { NameDialog } from "../sources/SourcesPanel";
import { ConfirmDialog, Icon, Menu, toast } from "../ui";
import DeckEditor from "./DeckEditor";
import GenerateDeckDialog from "./GenerateDeckDialog";
import ReviewSession from "./ReviewSession";

function DueBadge({ due, fresh }) {
  if (!due && !fresh) return <span className="text-xs text-ink-3">Nothing due</span>;
  return (
    <span className="flex items-center gap-1.5 text-xs">
      {due > 0 && <span className="px-2 py-0.5 rounded-full bg-accent text-accent-fg font-semibold tabular-nums">{due} due</span>}
      {fresh > 0 && <span className="px-2 py-0.5 rounded-full bg-accent-soft text-accent-soft-fg font-semibold tabular-nums">{fresh} new</span>}
    </span>
  );
}

/**
 * The course's flashcards: decks with due counts, generating and editing
 * decks, and spaced-repetition review. `onCounts({ due, new })` keeps the
 * "N due" badge outside in sync.
 */
export default function StudyPanel({ notebook, units, sources, onOpenCitation, onCounts }) {
  const [data, setData] = useState(null); // { decks, dueCount, newCount, newLimit, newToday }
  const [error, setError] = useState(null);
  const [mode, setMode] = useState({ name: "list" }); // list | review { deck? } | edit { deckId }
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const apply = useCallback(
    (result) => {
      setData(result);
      setError(null);
      onCounts?.({ due: result.dueCount, new: result.newCount });
    },
    [onCounts]
  );

  const load = useCallback(() => api.listDecks(notebook.id).then(apply, (err) => setError(err.message)), [notebook.id, apply]);

  useEffect(() => {
    let cancelled = false;
    api.listDecks(notebook.id).then(
      (result) => !cancelled && apply(result),
      (err) => !cancelled && setError(err.message)
    );
    return () => {
      cancelled = true;
    };
  }, [notebook.id, apply]);

  const unitTitle = (id) => units.find((u) => u.id === id)?.title;

  const createEmpty = async (title) => {
    try {
      const deck = await api.createDeck(notebook.id, { title });
      await load();
      setMode({ name: "edit", deckId: deck.id });
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const removeDeck = async (deck) => {
    try {
      await api.deleteDeck(deck.id);
      await load();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  if (mode.name === "review") {
    return (
      <ReviewSession
        notebookId={notebook.id}
        deck={mode.deck}
        onOpenCitation={onOpenCitation}
        onExit={() => {
          setMode({ name: "list" });
          load();
        }}
      />
    );
  }

  if (mode.name === "edit") {
    return (
      <DeckEditor
        deckId={mode.deckId}
        units={units}
        onOpenCitation={onOpenCitation}
        onBack={() => {
          setMode({ name: "list" });
          load();
        }}
        onStudy={(deck) => setMode({ name: "review", deck })}
        onDeleted={() => {
          setMode({ name: "list" });
          load();
        }}
        onChanged={load}
      />
    );
  }

  const decks = data?.decks ?? [];
  const totalDue = (data?.dueCount ?? 0) + (data?.newCount ?? 0);

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
        <div className="rounded-3xl bg-accent-soft text-accent-soft-fg p-5 sm:p-6 flex flex-wrap items-center gap-4">
          <span className="w-12 h-12 rounded-2xl bg-panel/60 flex items-center justify-center">
            <Icon name="style" size={26} />
          </span>
          <div className="flex-1 min-w-[180px]">
            <p className="font-display text-xl font-semibold">{data ? (totalDue ? `${totalDue} card${totalDue === 1 ? "" : "s"} to study today` : "You're all caught up") : "Flashcards"}</p>
            <p className="text-sm opacity-80">
              {data ? `${data.dueCount} due for review · ${data.newCount} new (up to ${data.newLimit} new per day)` : "Spaced repetition keeps what you learn."}
            </p>
          </div>
          <button type="button" className="btn-primary h-10 px-5" disabled={!totalDue} onClick={() => setMode({ name: "review" })}>
            <Icon name="play_arrow" size={20} /> Review all
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-base font-semibold mr-auto">Decks</h3>
          <button type="button" className="btn-outline" onClick={() => setCreating(true)}>
            <Icon name="add" size={18} /> Empty deck
          </button>
          <button type="button" className="btn-primary" onClick={() => setGenerating(true)}>
            <Icon name="auto_awesome" size={18} /> Generate flashcards
          </button>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        {!data && !error && (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-16 rounded-2xl" />
            ))}
          </div>
        )}
        {data && decks.length === 0 && (
          <div className="flex flex-col items-center text-center gap-3 py-10 px-6 rounded-3xl border border-dashed border-line">
            <Icon name="style" size={36} className="text-ink-3" />
            <p className="text-sm font-medium text-ink-2">No decks yet</p>
            <p className="text-xs text-ink-3 max-w-sm leading-5">Generate flashcards from a unit or the whole course. Every card links back to the page it came from.</p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {decks.map((deck) => (
            <div
              key={deck.id}
              role="button"
              tabIndex={0}
              onClick={() => setMode({ name: "edit", deckId: deck.id })}
              onKeyDown={(e) => e.key === "Enter" && setMode({ name: "edit", deckId: deck.id })}
              className="group flex items-center gap-3 p-3 pl-4 rounded-2xl border border-line bg-panel hover:bg-panel-2 cursor-pointer"
            >
              <Icon name="style" size={22} className="text-accent shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{deck.title}</p>
                <p className="text-xs text-ink-3 truncate">
                  {deck.cardCount} card{deck.cardCount === 1 ? "" : "s"}
                  {deck.unitId && unitTitle(deck.unitId) ? ` · ${unitTitle(deck.unitId)}` : ""}
                </p>
              </div>
              <DueBadge due={deck.dueCount} fresh={Math.min(deck.newCount, data.newCount)} />
              <button
                type="button"
                className="btn-outline h-8 px-3 max-sm:hidden"
                disabled={!deck.dueCount && !Math.min(deck.newCount, data.newCount)}
                onClick={(e) => {
                  e.stopPropagation();
                  setMode({ name: "review", deck });
                }}
              >
                Study
              </button>
              <Menu
                items={[
                  { label: "Study", icon: "play_arrow", onClick: () => setMode({ name: "review", deck }) },
                  { label: "Edit cards", icon: "edit", onClick: () => setMode({ name: "edit", deckId: deck.id }) },
                  { label: "Delete deck", icon: "delete", danger: true, onClick: () => setDeleting(deck) },
                ]}
              />
            </div>
          ))}
        </div>
      </div>

      {generating && (
        <GenerateDeckDialog
          open
          notebookId={notebook.id}
          units={units}
          sources={sources}
          onClose={() => setGenerating(false)}
          onCreated={(deck) => {
            setGenerating(false);
            load();
            setMode({ name: "edit", deckId: deck.id });
          }}
        />
      )}
      {creating && <NameDialog open title="New deck" saveLabel="Create" maxLength={120} placeholder="e.g. Key definitions" onClose={() => setCreating(false)} onSave={createEmpty} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete deck?"
        message={`"${deleting?.title}" and its cards will be deleted, including everyone's review progress on them.`}
        onConfirm={() => removeDeck(deleting)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
