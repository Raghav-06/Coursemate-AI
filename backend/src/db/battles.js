import { query, withTransaction } from "./pool.js";

// Finished quiz battles (live games are in memory, see services/battles.js).

/** Saves a finished battle and its final leaderboard; returns its id. */
export async function saveBattle({ notebookId, hostId, code, unitIds, seconds, questions, startedAt, players }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO battles (notebook_id, host_id, code, unit_ids, seconds_per_question, questions, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [notebookId, hostId, code, JSON.stringify(unitIds ?? []), seconds, JSON.stringify(questions), startedAt]
    );
    const id = rows[0].id;
    for (const p of players) {
      await client.query(
        "INSERT INTO battle_players (battle_id, user_id, name, score, correct, rank) VALUES ($1, $2, $3, $4, $5, $6)",
        [id, p.userId, p.name, p.score, p.correct, p.rank]
      );
    }
    return id;
  });
}

/** Battles in a course the user played, newest first, with everyone's final scores. */
export async function listBattles(notebookId, userId, limit = 20) {
  const { rows } = await query(
    `SELECT b.id, b.code, b.host_id, b.seconds_per_question, jsonb_array_length(b.questions) AS question_count,
            b.started_at, b.finished_at,
            (SELECT json_agg(json_build_object('userId', p.user_id, 'name', p.name, 'score', p.score, 'correct', p.correct, 'rank', p.rank)
                             ORDER BY p.rank, p.name)
               FROM battle_players p WHERE p.battle_id = b.id) AS players
       FROM battles b
      WHERE b.notebook_id = $1 AND EXISTS (SELECT 1 FROM battle_players me WHERE me.battle_id = b.id AND me.user_id = $2)
      ORDER BY b.finished_at DESC
      LIMIT $3`,
    [notebookId, userId, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    hostId: r.host_id,
    seconds: r.seconds_per_question,
    questionCount: r.question_count,
    startedAt: r.started_at?.toISOString?.() ?? r.started_at,
    finishedAt: r.finished_at?.toISOString?.() ?? r.finished_at,
    players: r.players ?? [],
  }));
}
