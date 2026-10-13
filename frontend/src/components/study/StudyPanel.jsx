import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { NameDialog } from "../sources/SourcesPanel";
import { ConfirmDialog, Icon, Menu, Spinner, toast } from "../ui";
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
export default function StudyPanel({ notebook, units, sources, onOpenCitation, onCounts, intent, onIntentUsed }) {
  const [data, setData] = useState(null); // { decks, dueCount, newCount, newLimit, newToday }
  const [error, setError] = useState(null);
  // Decks are shared course content: viewers of a shared course study them but can't change them.
  const canEdit = notebook.role !== "viewer";
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

  // { kind: "generate", topicIds }: make a short deck on those topics and study it.
  const [making, setMaking] = useState(false);
  const handledIntent = useRef(null); // StrictMode runs effects twice
  useEffect(() => {
    if (intent?.kind !== "generate" || handledIntent.current === intent) return;
    handledIntent.current = intent;
    onIntentUsed?.();
    setMaking(true);
    api
      .generateDeck(notebook.id, { topicIds: intent.topicIds, count: 10, difficulty: "medium" })
      .then(
        (deck) => {
          toast(`Created "${deck.title}" with ${deck.cards.length} cards`);
          load();
          setMode({ name: "review", deck });
        },
        (err) => toast(err.message, "error")
      )
      .finally(() => setMaking(false));
  }, [intent, onIntentUsed, notebook.id, load]);

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
          {canEdit && (
            <>
              <button type="button" className="btn-outline" onClick={() => setCreating(true)}>
                <Icon name="add" size={18} /> Empty deck
              </button>
              <button type="button" className="btn-primary" onClick={() => setGenerating(true)}>
                <Icon name="auto_awesome" size={18} /> Generate flashcards
              </button>
            </>
          )}
        </div>

        {making && (
          <p className="flex items-center gap-2 text-sm text-ink-2">
            <Spinner /> Making flashcards on your weak topics…
          </p>
        )}
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
            <p className="text-xs text-ink-3 max-w-sm leading-5">
              {canEdit
                ? "Generate flashcards from a unit or the whole course. Every card links back to the page it came from."
                : "The course's owner and editors haven't made any decks yet."}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {decks.map((deck) => (
            <div
              key={deck.id}
              role="button"
              tabIndex={0}
              onClick={() => setMode(canEdit ? { name: "edit", deckId: deck.id } : { name: "review", deck })}
              onKeyDown={(e) => e.key === "Enter" && setMode(canEdit ? { name: "edit", deckId: deck.id } : { name: "review", deck })}
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
                  canEdit && { label: "Edit cards", icon: "edit", onClick: () => setMode({ name: "edit", deckId: deck.id }) },
                  canEdit && { label: "Delete deck", icon: "delete", danger: true, onClick: () => setDeleting(deck) },
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
