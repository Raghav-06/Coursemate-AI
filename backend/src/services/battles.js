import crypto from "node:crypto";
import { config } from "../config/index.js";
import { saveBattle } from "../db/battles.js";
import { recordActivity } from "../db/exams.js";
import { addTopicEvents } from "../db/practice.js";

// Live quiz battles. Games live in this process's memory (one server; a
// restart ends running games — finished games are saved to Postgres).
// Flow: lobby → host starts → each question is open for `seconds` (or until
// everyone answered) → reveal for a few seconds → next … → finished.
// Players follow along over Server-Sent Events.

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
const CODE_LENGTH = 6;
const REVEAL_MS = 5000;
const LOBBY_TTL_MS = 30 * 60_000; // an unstarted lobby closes after 30 minutes
const FINISHED_TTL_MS = 15 * 60_000; // results stay viewable for 15 minutes
const MAX_BATTLES = 500;
const MAX_LIVE_PER_HOST = 2;
export const BATTLE_SECONDS = [10, 20, 30];
export const BATTLE_COUNTS = [5, 10, 15];
const BASE_POINTS = 500; // for a correct answer, plus up to 500 for speed

const battles = new Map(); // code → battle

const httpError = (status, message) => Object.assign(new Error(message), { status });

function newCode() {
  for (;;) {
    const bytes = crypto.randomBytes(CODE_LENGTH);
    const code = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    if (!battles.has(code)) return code;
  }
}

export const normaliseCode = (value) => (typeof value === "string" ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") : "");

export function getBattle(code) {
  return battles.get(normaliseCode(code)) ?? null;
}

const live = (b) => b.phase !== "finished" && b.phase !== "cancelled";

/**
 * Opens a lobby. `questions` come from generateQuizQuestions; the host joins
 * as the first player.
 */
export function createBattle({ notebookId, notebookTitle, host, tz, unitIds, seconds, questions }) {
  if ([...battles.values()].filter((b) => b.hostId === host.id && live(b)).length >= MAX_LIVE_PER_HOST) {
    throw httpError(409, "You already have battles running. Finish or close them first.");
  }
  if (battles.size >= MAX_BATTLES) throw httpError(503, "Too many battles are running right now. Try again in a few minutes.");
  const battle = {
    id: crypto.randomUUID(),
    code: newCode(),
    notebookId,
    notebookTitle,
    hostId: host.id,
    unitIds,
    seconds,
    questions,
    phase: "lobby",
    index: -1,
    questionStartedAt: null,
    deadline: null,
    players: new Map(),
    listeners: new Set(),
    timer: null,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    savedId: null,
  };
  battles.set(battle.code, battle);
  addPlayer(battle, host, tz);
  return battle;
}

function addPlayer(battle, user, tz) {
  battle.players.set(user.id, {
    userId: user.id,
    name: (user.name || user.email?.split("@")[0] || "Player").slice(0, 60),
    tz,
    score: 0,
    correct: 0,
    answers: new Map(), // question index → { choice, correct, points, ms }
  });
}

/** Joins the lobby (re-joining is fine; after the start only existing players get in). */
export function joinBattle(battle, user, tz) {
  if (battle.players.has(user.id)) return;
  if (battle.phase !== "lobby") throw httpError(409, battle.phase === "finished" ? "This battle has finished." : "This battle has already started.");
  if (battle.players.size >= config.limits.battlePlayers) throw httpError(409, "This battle is full.");
  addPlayer(battle, user, tz);
  broadcast(battle);
}

/** Leaves the lobby; the host leaving closes it. */
export function leaveBattle(battle, userId) {
  if (battle.phase !== "lobby") return;
  if (userId === battle.hostId) {
    battle.phase = "cancelled";
    battle.finishedAt = Date.now();
    scheduleRemoval(battle, 60_000);
  } else {
    battle.players.delete(userId);
  }
  broadcast(battle);
}

export function startBattle(battle, userId) {
  if (userId !== battle.hostId) throw httpError(403, "Only the host can start the battle.");
  if (battle.phase !== "lobby") throw httpError(409, "This battle has already started.");
  battle.startedAt = Date.now();
  openQuestion(battle, 0);
}

function openQuestion(battle, index) {
  clearTimeout(battle.timer);
  battle.phase = "question";
  battle.index = index;
  battle.questionStartedAt = Date.now();
  battle.deadline = battle.questionStartedAt + battle.seconds * 1000;
  battle.timer = setTimeout(() => reveal(battle), battle.seconds * 1000 + 250);
  broadcast(battle);
}

function reveal(battle) {
  if (battle.phase !== "question") return;
  clearTimeout(battle.timer);
  battle.phase = "reveal";
  battle.deadline = Date.now() + REVEAL_MS;
  const last = battle.index >= battle.questions.length - 1;
  battle.timer = setTimeout(() => (last ? finish(battle) : openQuestion(battle, battle.index + 1)), REVEAL_MS);
  broadcast(battle);
}

/**
 * Records a player's answer to the open question: correct answers earn 500
 * points plus up to 500 more the faster they come. One answer per question.
 */
export function answerQuestion(battle, userId, { index, choice }) {
  const player = battle.players.get(userId);
  if (!player) throw httpError(403, "Join the battle first.");
  if (battle.phase !== "question" || index !== battle.index) throw httpError(409, "That question is closed.");
  if (player.answers.has(index)) throw httpError(409, "You've already answered this question.");
  const now = Date.now();
  const ms = now - battle.questionStartedAt;
  const total = battle.seconds * 1000;
  const correct = choice === battle.questions[index].answerIndex;
  const points = correct ? BASE_POINTS + Math.round(BASE_POINTS * Math.max(0, 1 - ms / total)) : 0;
  player.answers.set(index, { choice, correct, points, ms: Math.min(ms, total) });
  player.score += points;
  if (correct) player.correct += 1;
  if ([...battle.players.values()].every((p) => p.answers.has(index))) reveal(battle);
  else broadcast(battle);
  return { correct, points };
}

async function finish(battle) {
  clearTimeout(battle.timer);
  battle.phase = "finished";
  battle.finishedAt = Date.now();
  battle.deadline = null;
  const ranked = leaderboard(battle);
  try {
    battle.savedId = await saveBattle({
      notebookId: battle.notebookId,
      hostId: battle.hostId,
      code: battle.code,
      unitIds: battle.unitIds,
      seconds: battle.seconds,
      questions: battle.questions,
      startedAt: new Date(battle.startedAt),
      players: ranked.map((p) => ({ userId: p.userId, name: p.name, score: p.score, correct: p.correct, rank: p.rank })),
    });
  } catch (err) {
    console.error(`Saving battle ${battle.code} failed: ${err.message}`);
  }
  // Every answer counts toward the daily goal and topic mastery, like a quiz.
  for (const player of battle.players.values()) {
    const answers = [...player.answers.entries()];
    if (answers.length === 0) continue;
    try {
      await recordActivity(player.userId, player.tz, "quiz", answers.length);
      await addTopicEvents(
        player.userId,
        answers.map(([i, a]) => ({ topicId: battle.questions[i].topicId, kind: "quiz", score: a.correct ? 1 : 0, weight: 1 }))
      );
    } catch (err) {
      console.warn(`Battle progress for ${player.userId} failed: ${err.message}`);
    }
  }
  broadcast(battle);
  scheduleRemoval(battle, FINISHED_TTL_MS);
}

function scheduleRemoval(battle, ms) {
  setTimeout(() => {
    if (battles.get(battle.code) === battle) {
      for (const l of battle.listeners) l.res.end();
      battles.delete(battle.code);
    }
  }, ms).unref();
}

// Unstarted lobbies don't live forever.
setInterval(() => {
  const now = Date.now();
  for (const b of battles.values()) {
    if (b.phase === "lobby" && now - b.createdAt > LOBBY_TTL_MS) leaveBattle(b, b.hostId);
  }
}, 60_000).unref();

// Standings. While a question is open its points stay hidden (they'd give
// away who was right), so scores show as they were when it opened.
function leaderboard(battle) {
  const open = battle.phase === "question";
  const players = [...battle.players.values()].map((p) => {
    const current = open ? p.answers.get(battle.index) : null;
    return {
      userId: p.userId,
      name: p.name,
      score: p.score - (current?.points ?? 0),
      correct: p.correct - (current?.correct ? 1 : 0),
      answered: p.answers.has(battle.index),
    };
  });
  players.sort((a, b) => b.score - a.score || b.correct - a.correct || a.name.localeCompare(b.name));
  let rank = 0;
  let prev = null;
  return players.map((p, i) => {
    if (!prev || p.score !== prev.score) rank = i + 1;
    prev = p;
    return { ...p, rank };
  });
}

/** What one player sees: answers stay hidden until the question closes. */
export function snapshot(battle, userId) {
  const q = battle.questions[battle.index];
  const me = battle.players.get(userId);
  const mine = me?.answers.get(battle.index);
  const state = {
    code: battle.code,
    notebookId: battle.notebookId,
    notebookTitle: battle.notebookTitle,
    phase: battle.phase,
    hostId: battle.hostId,
    isHost: userId === battle.hostId,
    joined: Boolean(me),
    seconds: battle.seconds,
    questionCount: battle.questions.length,
    index: battle.index,
    serverNow: Date.now(),
    deadline: battle.deadline,
    players: leaderboard(battle),
    savedId: battle.savedId,
  };
  if ((battle.phase === "question" || battle.phase === "reveal") && q) {
    state.question = { text: q.question, options: q.options, topic: q.topic ?? null };
    state.yourAnswer = mine ? { choice: mine.choice, ...(battle.phase === "reveal" && { correct: mine.correct, points: mine.points }) } : null;
  }
  if (battle.phase === "reveal" && q) {
    Object.assign(state.question, {
      answerIndex: q.answerIndex,
      explanation: q.explanation ?? null,
      citation: q.sourceId ? { sourceId: q.sourceId, location: q.location ?? null, text: q.quote ?? "" } : null,
    });
  }
  if (battle.phase === "finished" && me) {
    state.results = battle.questions.map((question, i) => {
      const a = me.answers.get(i);
      return { question: question.question, options: question.options, answerIndex: question.answerIndex, explanation: question.explanation ?? null, choice: a?.choice ?? null, correct: a?.correct ?? false, points: a?.points ?? 0 };
    });
  }
  return state;
}

function broadcast(battle) {
  for (const listener of battle.listeners) send(listener, snapshot(battle, listener.userId));
}

function send(listener, state) {
  listener.res.write(`data: ${JSON.stringify(state)}\n\n`);
}

/** Streams the battle to one player until they disconnect. */
export function subscribe(battle, userId, res) {
  const listener = { userId, res };
  battle.listeners.add(listener);
  send(listener, snapshot(battle, userId));
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  res.on("close", () => {
    clearInterval(ping);
    battle.listeners.delete(listener);
  });
}

/** Live battles of a course the user can join or rejoin (for the Practice tab). */
export function liveBattles(notebookId, userId) {
  return [...battles.values()]
    .filter((b) => b.notebookId === notebookId && live(b) && (b.phase === "lobby" || b.players.has(userId)))
    .map((b) => ({ code: b.code, phase: b.phase, hostName: b.players.get(b.hostId)?.name ?? null, players: b.players.size, questionCount: b.questions.length }));
}
