import { query, withTransaction } from "./pool.js";

// The course knowledge map (km_nodes + km_edges + km_maps status). The map
// belongs to the course; mastery per node is computed from each user's
// topic_events (see services/knowledgeMap.js).

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const LEVELS = ["subject", "chapter", "topic", "subtopic"];

function toNode(r) {
  return {
    id: r.id,
    notebookId: r.notebook_id,
    parentId: r.parent_id ?? null,
    level: r.level,
    name: r.name,
    description: r.description ?? null,
    weight: r.weight === null || r.weight === undefined ? null : Number(r.weight),
    weightSource: r.weight_source ?? null,
    syllabusRef: r.syllabus_ref ?? null,
    topicId: r.topic_id ?? null,
    unitId: r.unit_id ?? null,
    position: r.position,
  };
}

export async function getMapStatus(notebookId) {
  const { rows } = await query("SELECT * FROM km_maps WHERE notebook_id = $1", [notebookId]);
  const r = rows[0];
  return r ? { status: r.status, signature: r.signature, error: r.error ?? null, builtAt: iso(r.built_at), updatedAt: iso(r.updated_at) } : null;
}

export async function setMapStatus(notebookId, { status, signature, error = null, built = false }) {
  await query(
    `INSERT INTO km_maps (notebook_id, status, signature, error, built_at, updated_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN NOW() END, NOW())
     ON CONFLICT (notebook_id) DO UPDATE SET
       status = EXCLUDED.status, signature = COALESCE(EXCLUDED.signature, km_maps.signature), error = EXCLUDED.error,
       built_at = COALESCE(EXCLUDED.built_at, km_maps.built_at), updated_at = NOW()`,
    [notebookId, status, signature ?? null, error, built]
  );
}

export async function listNodes(notebookId) {
  const { rows } = await query("SELECT * FROM km_nodes WHERE notebook_id = $1 ORDER BY position", [notebookId]);
  return rows.map(toNode);
}

export async function getNode(id, notebookId) {
  const { rows } = await query("SELECT * FROM km_nodes WHERE id = $1 AND notebook_id = $2", [id, notebookId]);
  return rows[0] ? toNode(rows[0]) : null;
}

export async function getNodesByIds(notebookId, ids) {
  if (!ids.length) return [];
  const { rows } = await query("SELECT * FROM km_nodes WHERE notebook_id = $1 AND id = ANY($2::uuid[])", [notebookId, ids]);
  return rows.map(toNode);
}

export async function listEdges(notebookId) {
  const { rows } = await query("SELECT from_node, to_node FROM km_edges WHERE notebook_id = $1", [notebookId]);
  return rows.map((r) => ({ from: r.from_node, to: r.to_node }));
}

/**
 * Replaces the map. `nodes` = [{ key, parentKey, level, name, description,
 * syllabusRef, topicId, unitId }] parents before children; `edges` =
 * [{ fromKey, toKey }]. A node matching an existing one by level + name
 * (preferring the same parent name) keeps its id. Returns Map key → id.
 */
export async function replaceMap(notebookId, nodes, edges) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT n.id, n.level, n.name, p.name AS parent_name FROM km_nodes n LEFT JOIN km_nodes p ON p.id = n.parent_id WHERE n.notebook_id = $1`,
      [notebookId]
    );
    const byName = new Map();
    for (const r of rows) {
      const k = `${r.level}|${norm(r.name)}`;
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(r);
    }
    const used = new Set();
    const ids = new Map();
    const nameOfKey = new Map(nodes.map((n) => [n.key, n.name]));
    for (const [position, n] of nodes.entries()) {
      const parentId = n.parentKey ? ids.get(n.parentKey) ?? null : null;
      const candidates = (byName.get(`${n.level}|${norm(n.name)}`) ?? []).filter((r) => !used.has(r.id));
      const parentName = norm(nameOfKey.get(n.parentKey));
      const match = candidates.find((r) => norm(r.parent_name) === parentName) ?? candidates[0];
      const values = [n.name, n.description ?? null, n.syllabusRef ?? null, n.topicId ?? null, n.unitId ?? null, position, parentId, n.level];
      if (match) {
        used.add(match.id);
        await client.query(
          `UPDATE km_nodes SET name = $2, description = $3, syllabus_ref = $4, topic_id = $5, unit_id = $6, position = $7,
                  parent_id = $8, level = $9, updated_at = NOW() WHERE id = $1`,
          [match.id, ...values]
        );
        ids.set(n.key, match.id);
      } else {
        const { rows: inserted } = await client.query(
          `INSERT INTO km_nodes (notebook_id, name, description, syllabus_ref, topic_id, unit_id, position, parent_id, level)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [notebookId, ...values]
        );
        ids.set(n.key, inserted[0].id);
      }
    }
    const stale = rows.filter((r) => !used.has(r.id)).map((r) => r.id);
    if (stale.length) await client.query("DELETE FROM km_nodes WHERE id = ANY($1::uuid[])", [stale]);
    await client.query("DELETE FROM km_edges WHERE notebook_id = $1", [notebookId]);
    for (const e of edges) {
      const from = ids.get(e.fromKey);
      const to = ids.get(e.toKey);
      if (from && to && from !== to) {
        await client.query("INSERT INTO km_edges (notebook_id, from_node, to_node) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [notebookId, from, to]);
      }
    }
    return ids;
  });
}

/** Sets exam weights: [{ id, weight, source }]. */
export async function setNodeWeights(updates) {
  await withTransaction(async (client) => {
    for (const u of updates) {
      await client.query("UPDATE km_nodes SET weight = $2, weight_source = $3 WHERE id = $1", [u.id, u.weight, u.source]);
    }
  });
}

/** Places past-paper questions on nodes: [{ id, nodeId }]. */
export async function setPaperQuestionNodes(updates) {
  await withTransaction(async (client) => {
    for (const u of updates) await client.query("UPDATE past_paper_questions SET node_id = $2 WHERE id = $1", [u.id, u.nodeId]);
  });
}

/**
 * A user's evidence per node, newest first (up to `perNode` each): events on
 * the node itself, plus events on the course topic the node is linked to.
 */
export async function nodeEvents(notebookId, userId, { nodeIds, perNode = 50 } = {}) {
  const { rows } = await query(
    `SELECT node_id, score, weight, kind, created_at FROM (
       SELECT n.id AS node_id, e.score, e.weight, e.kind, e.created_at,
              ROW_NUMBER() OVER (PARTITION BY n.id ORDER BY e.created_at DESC, e.id DESC) AS rn
         FROM km_nodes n
         JOIN topic_events e ON e.user_id = $2
              AND (e.node_id = n.id OR (e.node_id IS NULL AND n.topic_id IS NOT NULL AND e.topic_id = n.topic_id))
        WHERE n.notebook_id = $1 ${nodeIds ? "AND n.id = ANY($4::uuid[])" : ""}
     ) ranked WHERE rn <= $3 ORDER BY node_id, created_at DESC`,
    nodeIds ? [notebookId, userId, perNode, nodeIds] : [notebookId, userId, perNode]
  );
  return rows.map((r) => ({ nodeId: r.node_id, score: Number(r.score), weight: Number(r.weight), kind: r.kind, createdAt: iso(r.created_at) }));
}
