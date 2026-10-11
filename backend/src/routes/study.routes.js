import { Router } from "express";
import { asyncHandler, isUuid } from "../utils/asyncHandler.js";
import { config } from "../config/index.js";
import { cleanString, httpError, idList, resolveSources, resolveUnitId } from "./helpers.js";
import { getUnit } from "../db/store.js";
import {
  addCards,
  countCards,
  countDecks,
  createDeck,
  deleteCard,
  deleteDeck,
  getCard,
  getDeck,
  listCards,
  listDecks,
  newCardsStartedToday,
  reviewQueue,
  saveReview,
  updateCard,
  updateDeck,
} from "../db/study.js";
import { CARD_COUNTS, DIFFICULTIES, generateCards } from "../services/flashcards.js";
import { RATINGS, previewIntervals, schedule } from "../services/srs.js";
import { assertApiKey } from "../services/llm.js";

const MAX_DECK_TITLE = 120;
const MAX_DECKS_PER_COURSE = 100;
const MAX_CARDS_PER_DECK = 500;
const MAX_FRONT = 500;
const MAX_BACK = 2000;
const MAX_TOPIC = 80;

function cardFields(body, { partial = false } = {}) {
  const fields = {};
  for (const [key, max] of [["front", MAX_FRONT], ["back", MAX_BACK]]) {
    if (body?.[key] === undefined && partial) continue;
    const value = cleanString(body?.[key], max + 1);
    if (!value) throw httpError(400, `The card's ${key} can't be empty.`);
    if (value.length > max) throw httpError(400, `The card's ${key} is limited to ${max} characters.`);
    fields[key] = value;
  }
  if (body?.topic !== undefined) fields.topic = cleanString(body.topic, MAX_TOPIC) || null;
  return fields;
}

// Badge numbers for a course: cards due now + new cards still allowed today.
async function studyCounts(notebookId, userId, tz, decks) {
  const newLimit = config.limits.newCardsPerDay;
  const newToday = await newCardsStartedToday(notebookId, userId, tz);
  const due = decks.reduce((n, d) => n + d.dueCount, 0);
  const fresh = Math.min(decks.reduce((n, d) => n + d.newCount, 0), Math.max(0, newLimit - newToday));
  return { dueCount: due, newCount: fresh, newLimit, newToday };
}

/** Deck routes scoped to a course; added to the courses router (so :id is already checked). */
export function courseStudyRoutes(router) {
  // { decks: [...with cardCount, dueCount, newCount], dueCount, newCount, newLimit, newToday }
  router.get(
    "/:id/decks",
    asyncHandler(async (req, res) => {
      const decks = await listDecks(req.notebook.id, req.user.id);
      res.json({ decks, ...(await studyCounts(req.notebook.id, req.user.id, req.tz, decks)) });
    })
  );

  // body: { title, unitId? } — an empty deck to fill by hand
  router.post(
    "/:id/decks",
    asyncHandler(async (req, res) => {
      const title = cleanString(req.body?.title, MAX_DECK_TITLE);
      if (!title) throw httpError(400, "Give the deck a name.");
      if ((await countDecks(req.notebook.id)) >= MAX_DECKS_PER_COURSE) throw httpError(409, `A course can have up to ${MAX_DECKS_PER_COURSE} decks.`);
      const unitId = await resolveUnitId(req.notebook.id, req.body?.unitId);
      res.status(201).json(await createDeck({ notebookId: req.notebook.id, unitId, title, createdBy: req.user.id }));
    })
  );

  // body: { title?, unitIds?, sourceIds?, count: 10|20|30, difficulty: easy|medium|hard }
  router.post(
    "/:id/decks/generate",
    asyncHandler(async (req, res) => {
      const count = Number(req.body?.count ?? 10);
      if (!CARD_COUNTS.includes(count)) throw httpError(400, `count must be one of ${CARD_COUNTS.join(", ")}.`);
      const difficulty = req.body?.difficulty ?? "medium";
      if (!DIFFICULTIES.includes(difficulty)) throw httpError(400, `difficulty must be one of ${DIFFICULTIES.join(", ")}.`);
      const unitIds = idList(req.body?.unitIds, { allow: ["general"], name: "unitIds" });
      const sourceIds = idList(req.body?.sourceIds, { name: "sourceIds" });
      if ((await countDecks(req.notebook.id)) >= MAX_DECKS_PER_COURSE) throw httpError(409, `A course can have up to ${MAX_DECKS_PER_COURSE} decks.`);

      const sources = await resolveSources(req.notebook.id, { sourceIds, unitIds, selectedOnly: false });
      if (sources.length === 0) throw httpError(409, "There are no ready sources in what you picked.");
      assertApiKey();

      const singleUnit = unitIds?.length === 1 && unitIds[0] !== "general" ? await getUnit(unitIds[0], req.notebook.id) : null;
      const title = cleanString(req.body?.title, MAX_DECK_TITLE) || `${singleUnit?.title ?? req.notebook.title} — flashcards`;
      const cards = await generateCards({ sources, count, difficulty, focus: singleUnit?.title });

      const deck = await createDeck({ notebookId: req.notebook.id, unitId: singleUnit?.id ?? null, title, createdBy: req.user.id });
      await addCards(deck.id, cards);
      res.status(201).json({ ...deck, cards: await listCards(deck.id, req.user.id) });
    })
  );

  // ?deckId= — cards to review now (due first, then new ones up to today's cap),
  // each with the next interval every rating would give.
  router.get(
    "/:id/review",
    asyncHandler(async (req, res) => {
      const deckId = req.query.deckId;
      if (deckId !== undefined && (!isUuid(deckId) || (await getDeck(deckId, req.user.id))?.notebookId !== req.notebook.id)) {
        throw httpError(404, "Deck not found.");
      }
      const newLimit = config.limits.newCardsPerDay;
      const newToday = await newCardsStartedToday(req.notebook.id, req.user.id, req.tz);
      const { due, fresh } = await reviewQueue({
        notebookId: req.notebook.id,
        deckId: deckId ?? null,
        userId: req.user.id,
        newLimit: Math.max(0, newLimit - newToday),
      });
      const now = new Date();
      res.json({
        cards: [...due, ...fresh].map((card) => ({ ...card, isNew: !card.review, intervals: previewIntervals(card.review, now) })),
        dueCount: due.length,
        newCount: fresh.length,
        newLimit,
        newToday,
      });
    })
  );
}

// ---- Decks and cards by id ------------------------------------------------------

export const studyRouter = Router();

studyRouter.param("deckId", async (req, _res, next, id) => {
  try {
    req.deck = isUuid(id) ? await getDeck(id, req.user.id) : null;
    next(req.deck ? undefined : httpError(404, "Deck not found."));
  } catch (err) {
    next(err);
  }
});

studyRouter.param("cardId", async (req, _res, next, id) => {
  try {
    req.card = isUuid(id) ? await getCard(id, req.user.id) : null;
    next(req.card ? undefined : httpError(404, "Card not found."));
  } catch (err) {
    next(err);
  }
});

// The deck with all its cards (and this user's review state for each).
studyRouter.get(
  "/decks/:deckId",
  asyncHandler(async (req, res) => {
    res.json({ ...req.deck, cards: await listCards(req.deck.id, req.user.id) });
  })
);

// body: { title?, unitId? }
studyRouter.patch(
  "/decks/:deckId",
  asyncHandler(async (req, res) => {
    const patch = {};
    if (req.body?.title !== undefined) {
      patch.title = cleanString(req.body.title, MAX_DECK_TITLE);
      if (!patch.title) throw httpError(400, "Give the deck a name.");
    }
    const unitId = await resolveUnitId(req.deck.notebookId, req.body?.unitId);
    if (unitId !== undefined) patch.unitId = unitId;
    res.json(await updateDeck(req.deck.id, patch));
  })
);

studyRouter.delete(
  "/decks/:deckId",
  asyncHandler(async (req, res) => {
    await deleteDeck(req.deck.id);
    res.status(204).end();
  })
);

// body: { front, back, topic? }
studyRouter.post(
  "/decks/:deckId/cards",
  asyncHandler(async (req, res) => {
    const fields = cardFields(req.body);
    if ((await countCards(req.deck.id)) >= MAX_CARDS_PER_DECK) throw httpError(409, `A deck can hold up to ${MAX_CARDS_PER_DECK} cards.`);
    const [id] = await addCards(req.deck.id, [fields]);
    res.status(201).json(await getCard(id, req.user.id));
  })
);

// body: { front?, back?, topic? }
studyRouter.patch(
  "/cards/:cardId",
  asyncHandler(async (req, res) => {
    await updateCard(req.card.id, cardFields(req.body, { partial: true }));
    res.json(await getCard(req.card.id, req.user.id));
  })
);

studyRouter.delete(
  "/cards/:cardId",
  asyncHandler(async (req, res) => {
    await deleteCard(req.card.id);
    res.status(204).end();
  })
);

// body: { rating: again|hard|good|easy } — records the answer and schedules the
// card's next review for this user.
studyRouter.post(
  "/cards/:cardId/review",
  asyncHandler(async (req, res) => {
    const rating = req.body?.rating;
    if (!RATINGS.includes(rating)) throw httpError(400, `rating must be one of ${RATINGS.join(", ")}.`);
    const state = schedule(req.card.review, rating);
    await saveReview({ cardId: req.card.id, userId: req.user.id, notebookId: req.card.notebookId, rating, wasNew: !req.card.review, state });
    res.json({ cardId: req.card.id, rating, review: state, intervals: previewIntervals(state) });
  })
);
