import { query, withTransaction } from "./pool.js";
import { canAccessNotebook, dayStartSql } from "./access.js";

// Flashcard decks, cards and each user's spaced-repetition state. Decks and
// cards are shared by everyone who can open the course; review state and the
// review log are personal (keyed by user).

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);

function toDeck(r) {
  if (!r) return null;
  const deck = {
    id: r.id,
    notebookId: r.notebook_id,
    unitId: r.unit_id ?? null,
    title: r.title,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
  if (r.card_count !== undefined) {
    Object.assign(deck, { cardCount: Number(r.card_count), dueCount: Number(r.due_count), newCount: Number(r.new_count) });
  }
  return deck;
}

function toReview(r) {
  if (r.ease === null || r.ease === undefined) return null;
  return {
    ease: Number(r.ease),
    intervalDays: Number(r.interval_days),
    repetitions: r.repetitions,
    dueAt: iso(r.due_at),
    lastReviewedAt: iso(r.last_reviewed_at),
    lapses: r.lapses,
  };
}

function toCard(r) {
  if (!r) return null;
  return {
    id: r.id,
    deckId: r.deck_id,
    front: r.front,
    back: r.back,
    topic: r.topic ?? null,
    topicId: r.topic_id ?? null,
    sourceId: r.source_id ?? null,
    sourceTitle: r.source_title ?? null,
    location: r.location ?? null,
    quote: r.quote ?? null,
    position: r.position,
    ...(r.notebook_id ? { notebookId: r.notebook_id, deckUnitId: r.deck_unit_id ?? null } : {}),
    review: toReview(r),
    createdAt: iso(r.created_at),
  };
}

// ---- Decks ---------------------------------------------------------------------

/** Decks of a course with card counts and, for this user, due and new counts. */
export async function listDecks(notebookId, userId) {
  const { rows } = await query(
    `SELECT d.*,
            COUNT(c.id) AS card_count,
            COUNT(c.id) FILTER (WHERE r.card_id IS NOT NULL AND r.due_at <= NOW()) AS due_count,
            COUNT(c.id) FILTER (WHERE r.card_id IS NULL) AS new_count
       FROM decks d
       LEFT JOIN cards c ON c.deck_id = d.id
       LEFT JOIN card_reviews r ON r.card_id = c.id AND r.user_id = $2
      WHERE d.notebook_id = $1
      GROUP BY d.id
      ORDER BY d.created_at`,
    [notebookId, userId]
  );
  return rows.map(toDeck);
}

/** A deck the user may open (via its course), or null. */
export async function getDeck(id, userId) {
  const { rows } = await query(
    `SELECT d.* FROM decks d JOIN notebooks n ON n.id = d.notebook_id
      WHERE d.id = $1 AND ${canAccessNotebook("n", "$2")}`,
    [id, userId]
  );
  return toDeck(rows[0]);
}

export async function createDeck({ notebookId, unitId = null, title, createdBy = null }) {
  const { rows } = await query(
    "INSERT INTO decks (notebook_id, unit_id, title, created_by) VALUES ($1, $2, $3, $4) RETURNING *",
    [notebookId, unitId, title, createdBy]
  );
  return toDeck(rows[0]);
}

export async function updateDeck(id, { title, unitId }) {
  const { rows } = await query(
    `UPDATE decks SET title = COALESCE($2, title),
                      unit_id = CASE WHEN $3 THEN $4::uuid ELSE unit_id END,
                      updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, title ?? null, unitId !== undefined, unitId ?? null]
  );
  return toDeck(rows[0]);
}

export async function deleteDeck(id) {
  await query("DELETE FROM decks WHERE id = $1", [id]);
}

export async function countDecks(notebookId) {
  const { rows } = await query("SELECT COUNT(*)::int AS count FROM decks WHERE notebook_id = $1", [notebookId]);
  return rows[0].count;
}

// ---- Cards ---------------------------------------------------------------------

const CARD_SELECT = `SELECT c.*, s.title AS source_title, d.notebook_id, d.unit_id AS deck_unit_id,
         r.ease, r.interval_days, r.repetitions, r.due_at, r.last_reviewed_at, r.lapses
    FROM cards c
    JOIN decks d ON d.id = c.deck_id
    LEFT JOIN sources s ON s.id = c.source_id
    LEFT JOIN card_reviews r ON r.card_id = c.id AND r.user_id = $2`;

export async function listCards(deckId, userId) {
  const { rows } = await query(`${CARD_SELECT} WHERE c.deck_id = $1 ORDER BY c.position, c.created_at`, [deckId, userId]);
  return rows.map(toCard);
}

/** A card the user may open (via its deck's course), with their review state. */
export async function getCard(id, userId) {
  const { rows } = await query(
    `${CARD_SELECT} JOIN notebooks n ON n.id = d.notebook_id WHERE c.id = $1 AND ${canAccessNotebook("n", "$2")}`,
    [id, userId]
  );
  return toCard(rows[0]);
}

export async function countCards(deckId) {
  const { rows } = await query("SELECT COUNT(*)::int AS count FROM cards WHERE deck_id = $1", [deckId]);
  return rows[0].count;
}

/** Appends cards ({ front, back, topic?, topicId?, sourceId?, location?, quote? }) to a deck. */
export async function addCards(deckId, cards) {
  if (cards.length === 0) return [];
  return withTransaction(async (client) => {
    const { rows: max } = await client.query("SELECT COALESCE(MAX(position), -1) AS max FROM cards WHERE deck_id = $1", [deckId]);
    const ids = [];
    let position = Number(max[0].max);
    for (const card of cards) {
      position += 1;
      const { rows } = await client.query(
        `INSERT INTO cards (deck_id, front, back, topic, topic_id, source_id, location, quote, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [deckId, card.front, card.back, card.topic ?? null, card.topicId ?? null, card.sourceId ?? null, card.location ?? null, card.quote ?? null, position]
      );
      ids.push(rows[0].id);
    }
    await client.query("UPDATE decks SET updated_at = NOW() WHERE id = $1", [deckId]);
    return ids;
  });
}

export async function updateCard(id, { front, back, topic }) {
  await query(
    `UPDATE cards SET front = COALESCE($2, front), back = COALESCE($3, back),
                      topic = CASE WHEN $4 THEN $5 ELSE topic END,
                      topic_id = CASE WHEN $4 AND $5 IS DISTINCT FROM topic THEN NULL ELSE topic_id END, updated_at = NOW()
      WHERE id = $1`,
    [id, front ?? null, back ?? null, topic !== undefined, topic ?? null]
  );
}

export async function deleteCard(id) {
  await query("DELETE FROM cards WHERE id = $1", [id]);
}

// ---- Reviews -------------------------------------------------------------------

/** New cards this user has started in this course today (their timezone). */
export async function newCardsStartedToday(notebookId, userId, tz) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count FROM review_log
      WHERE user_id = $1 AND notebook_id = $2 AND was_new AND reviewed_at >= ${dayStartSql("$3")}`,
    [userId, notebookId, tz]
  );
  return rows[0].count;
}

/**
 * Cards to review now in a course (optionally one deck): every card whose due
 * time has passed, then new cards up to `newLimit`. Due cards come first,
 * oldest due first; new cards in deck order.
 */
export async function reviewQueue({ notebookId, deckId = null, userId, newLimit, limit = 200 }) {
  const scope = deckId ? "c.deck_id = $3" : "d.notebook_id = $3";
  const due = await query(
    `${CARD_SELECT} WHERE ${scope} AND r.card_id IS NOT NULL AND r.due_at <= NOW()
      ORDER BY r.due_at LIMIT $1`,
    [limit, userId, deckId ?? notebookId]
  );
  const fresh =
    newLimit > 0
      ? await query(
          `${CARD_SELECT} WHERE ${scope} AND r.card_id IS NULL
            ORDER BY d.created_at, c.position LIMIT $1`,
          [newLimit, userId, deckId ?? notebookId]
        )
      : { rows: [] };
  return { due: due.rows.map(toCard), fresh: fresh.rows.map(toCard) };
}

/** Saves a user's new SM-2 state for a card and logs the rating. */
export async function saveReview({ cardId, userId, notebookId, rating, wasNew, state }) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO card_reviews (card_id, user_id, ease, interval_days, repetitions, due_at, last_reviewed_at, lapses)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
       ON CONFLICT (card_id, user_id) DO UPDATE SET
         ease = EXCLUDED.ease, interval_days = EXCLUDED.interval_days, repetitions = EXCLUDED.repetitions,
         due_at = EXCLUDED.due_at, last_reviewed_at = NOW(), lapses = EXCLUDED.lapses`,
      [cardId, userId, state.ease, state.intervalDays, state.repetitions, state.dueAt, state.lapses]
    );
    await client.query(
      "INSERT INTO review_log (user_id, card_id, notebook_id, rating, was_new) VALUES ($1, $2, $3, $4, $5)",
      [userId, cardId, notebookId, rating, wasNew]
    );
  });
}
