import { listNodes } from "../db/knowledgeMap.js";
import { listDiagnoses } from "../db/diagnoses.js";
import { addDays } from "./examPlan.js";

// The Mistakes dashboard: why marks are being lost, over time and where.

const WEEKS = 8;
export const ADVICE = {
  concept_gap: {
    title: "Concept gap",
    text: "Learn it again from your notes, then practise — start with the prerequisite the diagnosis points to, and only move on when you get the follow-ups right.",
  },
  careless_error: {
    title: "Careless error",
    text: "Slow down and check: re-read the question, write units and signs at every step, estimate the answer before choosing, and re-check the option you mark. Drill untimed until accuracy is consistent.",
  },
  time_pressure: {
    title: "Time pressure",
    text: "Practise timed speed drills on this topic, set a time budget per question, skip and return to long ones, and do a mock under real timing every week.",
  },
};

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Monday (UTC) of the week a timestamp falls in, as YYYY-MM-DD. */
export function weekOf(isoTime) {
  const d = new Date(isoTime);
  const day = (d.getUTCDay() + 6) % 7;
  return addDays(d.toISOString().slice(0, 10), -day);
}

export async function mistakesDashboard(notebookId, userId, today) {
  const [all, nodes] = await Promise.all([listDiagnoses(notebookId, userId), listNodes(notebookId)]);
  const nodeName = new Map(nodes.map((n) => [n.id, n.name]));
  const diags = all.filter((d) => d.status === "ready" && d.category && d.feedback !== "not_right");

  const thisWeek = weekOf(`${today}T12:00:00Z`);
  const byWeek = Array.from({ length: WEEKS }, (_, i) => ({ week: addDays(thisWeek, -7 * (WEEKS - 1 - i)), concept_gap: 0, careless_error: 0, time_pressure: 0 }));
  for (const d of diags) {
    const w = byWeek.find((x) => x.week === weekOf(d.createdAt));
    if (w) w[d.category] += 1;
  }
  const totals = { concept_gap: 0, careless_error: 0, time_pressure: 0 };
  for (const d of diags) totals[d.category] += 1;

  const groups = new Map();
  for (const d of diags) {
    if (!d.misconception) continue;
    const key = norm(d.misconception);
    const g = groups.get(key) ?? { misconception: d.misconception, count: 0, categories: {}, nodes: new Set(), latest: d, lastSeen: d.createdAt };
    g.count += 1;
    g.categories[d.category] = (g.categories[d.category] ?? 0) + 1;
    for (const id of d.nodeIds) if (nodeName.has(id)) g.nodes.add(nodeName.get(id));
    groups.set(key, g);
  }
  const topMisconceptions = [...groups.values()]
    .sort((a, b) => b.count - a.count || (a.lastSeen < b.lastSeen ? 1 : -1))
    .slice(0, 8)
    .map((g) => ({
      misconception: g.misconception,
      count: g.count,
      category: Object.entries(g.categories).sort((a, b) => b[1] - a[1])[0][0],
      nodes: [...g.nodes].slice(0, 3),
      lastSeen: g.lastSeen,
      diagnosisId: g.latest.id,
    }));

  const costly = new Map();
  for (const d of diags) {
    const id = d.nodeIds.find((n) => nodeName.has(n));
    if (!id) continue;
    const c = costly.get(id) ?? { nodeId: id, name: nodeName.get(id), lostMarks: 0, mistakes: 0, categories: { concept_gap: 0, careless_error: 0, time_pressure: 0 }, diagnosisId: d.id };
    c.lostMarks += d.marksLost;
    c.mistakes += 1;
    c.categories[d.category] += 1;
    costly.set(id, c);
  }
  const costlyNodes = [...costly.values()].sort((a, b) => b.lostMarks - a.lostMarks).slice(0, 8).map((c) => ({ ...c, lostMarks: Math.round(c.lostMarks * 100) / 100 }));

  return {
    total: diags.length,
    totals,
    byWeek,
    topMisconceptions,
    costlyNodes,
    recent: all.slice(0, 12),
    flagged: all.filter((d) => d.feedback === "not_right").length,
    advice: ADVICE,
  };
}
