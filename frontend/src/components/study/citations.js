/** Citation shape (as CitationLink and the source viewer expect) for a flashcard. */
export const cardCitation = (card) =>
  card.sourceId ? { sourceId: card.sourceId, sourceTitle: card.sourceTitle, location: card.location, text: card.quote ?? "" } : null;
