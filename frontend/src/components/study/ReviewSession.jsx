import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import Markdown from "../Markdown";
import { Icon, IconButton, Spinner, toast } from "../ui";
import CitationLink from "./CitationLink";
import { cardCitation } from "./citations";

const BUTTONS = [
  ["again", "Again", "1", "bg-danger/10 text-danger hover:bg-danger/20"],
  ["hard", "Hard", "2", "bg-panel-2 text-ink hover:bg-panel-3"],
  ["good", "Good", "3", "bg-accent text-accent-fg hover:bg-accent/90"],
  ["easy", "Easy", "4", "bg-success/15 text-success hover:bg-success/25"],
];

/**
 * Reviews the due (and today's new) cards of a course or one deck. Space
 * flips the card; 1-4 rate it. "Again" brings the card back later in the
 * session.
 */
export default function ReviewSession({ notebookId, deck, onExit, onOpenCitation, onReviewed }) {
  const [queue, setQueue] = useState(null);
  const [total, setTotal] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tally, setTally] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.reviewQueue(notebookId, deck?.id).then(
      (r) => {
        if (cancelled) return;
        setQueue(r.cards);
        setTotal(r.cards.length);
      },
      (err) => !cancelled && setError(err.message)
    );
    return () => {
      cancelled = true;
    };
  }, [notebookId, deck?.id]);

  const card = queue?.[0];

  const rate = useCallback(
    async (rating) => {
      if (!card || busy) return;
      setBusy(true);
      try {
        const result = await api.reviewCard(card.id, rating);
        setTally((t) => ({ ...t, [rating]: t[rating] + 1 }));
        setQueue((q) => {
          const rest = q.slice(1);
          // Forgotten cards come back at the end of this session.
          return rating === "again" ? [...rest, { ...card, isNew: false, review: result.review, intervals: result.intervals }] : rest;
        });
        setFlipped(false);
        onReviewed?.();
      } catch (err) {
        toast(err.message, "error");
      } finally {
        setBusy(false);
      }
    },
    [card, busy, onReviewed]
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.closest?.("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === " " || e.key === "Enter") {
        if (!card) return;
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        rate(BUTTONS[Number(e.key) - 1][0]);
      } else if (e.key === "Escape") {
        onExit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card, flipped, rate, onExit]);

  const reviewed = Object.values(tally).reduce((a, b) => a + b, 0);
  const remaining = queue?.length ?? 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 sm:px-5 h-12 border-b border-line/60 shrink-0">
        <IconButton icon="arrow_back" label="Back to decks" onClick={onExit} />
        <h3 className="flex-1 min-w-0 truncate text-sm font-medium">{deck ? deck.title : "All due cards"}</h3>
        {queue && remaining > 0 && <span className="text-xs text-ink-3 tabular-nums">{remaining} left</span>}
      </div>
      {queue && total > 0 && (
        <div className="h-1 bg-panel-3 shrink-0">
          <div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, (reviewed / Math.max(total, reviewed + remaining)) * 100)}%` }} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
          {error && <p className="text-sm text-danger text-center">{error}</p>}
          {!queue && !error && (
            <div className="flex justify-center py-16 text-ink-3">
              <Spinner className="w-6 h-6" />
            </div>
          )}

          {queue && !card && (
            <div className="flex flex-col items-center text-center gap-3 py-12 animate-fade-in">
              <span className="w-14 h-14 rounded-full bg-success/15 text-success flex items-center justify-center">
                <Icon name="task_alt" size={30} />
              </span>
              <h3 className="font-display text-xl font-semibold">{reviewed ? "Session complete" : "All caught up"}</h3>
              <p className="text-sm text-ink-2 max-w-sm">
                {reviewed
                  ? `You reviewed ${reviewed} card${reviewed === 1 ? "" : "s"}: ${tally.again} again, ${tally.hard} hard, ${tally.good} good, ${tally.easy} easy.`
                  : "No cards are due right now. New cards unlock each day, and reviews come back on their own schedule."}
              </p>
              <button type="button" className="btn-primary mt-2" onClick={onExit}>
                Back to decks
              </button>
            </div>
          )}

          {card && (
            <div key={`${card.id}-${reviewed}`} className="animate-fade-in">
              <div className="flex items-center gap-2 mb-3 text-xs text-ink-3">
                {card.isNew ? (
                  <span className="px-2 py-0.5 rounded-md bg-accent-soft text-accent-soft-fg font-semibold">New</span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md bg-panel-3 font-semibold">Review</span>
                )}
                {card.topic && <span className="truncate">{card.topic}</span>}
              </div>
              <button
                type="button"
                onClick={() => setFlipped((f) => !f)}
                className="w-full text-left rounded-3xl border border-line bg-panel shadow-sm hover:shadow-pop transition-shadow p-6 sm:p-8 min-h-[220px] flex flex-col"
                aria-label={flipped ? "Hide answer" : "Show answer"}
              >
                <Markdown text={card.front} className="text-lg! leading-8! font-medium" />
                {flipped ? (
                  <div className="mt-6 pt-6 border-t border-line/70 animate-fade-in">
                    <Markdown text={card.back} />
                  </div>
                ) : (
                  <span className="mt-auto pt-8 text-xs text-ink-3 flex items-center gap-1.5">
                    <Icon name="flip" size={16} /> Tap or press Space to show the answer
                  </span>
                )}
              </button>
              {flipped && (
                <div className="mt-3 flex justify-start">
                  <CitationLink citation={cardCitation(card)} onOpen={onOpenCitation} />
                </div>
              )}

              {flipped && (
                <div className="mt-6 grid grid-cols-4 gap-2 animate-fade-in">
                  {BUTTONS.map(([rating, label, key, tone]) => (
                    <button
                      key={rating}
                      type="button"
                      disabled={busy}
                      onClick={() => rate(rating)}
                      className={`flex flex-col items-center justify-center gap-0.5 h-16 rounded-2xl text-sm font-semibold transition-colors disabled:opacity-50 ${tone}`}
                    >
                      {label}
                      <span className="text-[11px] font-normal opacity-80">
                        {card.intervals?.[rating]} <span className="max-sm:hidden">· {key}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {!flipped && (
                <button type="button" className="btn-primary w-full h-12 mt-6" onClick={() => setFlipped(true)}>
                  Show answer <span className="text-xs opacity-80 max-sm:hidden">(Space)</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
