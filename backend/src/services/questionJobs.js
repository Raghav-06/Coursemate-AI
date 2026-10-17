import crypto from "node:crypto";
import { generateQuestions } from "./questionGen.js";
import { listSources } from "../db/store.js";
import { listNodes } from "../db/knowledgeMap.js";
import { insertBankQuestions, listBankQuestions, toBankQuestion } from "../db/questionBank.js";

// Question generation runs in the background (a few model calls per
// question); the client polls the job. Jobs live in memory for an hour.

const JOB_TTL_MS = 60 * 60 * 1000;
const MAX_RUNNING_PER_USER = 2;
const jobs = new Map();

const prune = () => {
  for (const [id, job] of jobs) if (Date.now() - job.createdAt > JOB_TTL_MS) jobs.delete(id);
};

/** Nodes with their path ("Physics › Laws of Motion › Friction"). */
export async function nodesWithPaths(notebookId, ids) {
  const nodes = await listNodes(notebookId);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((n) => {
      const names = [];
      for (let x = n; x; x = byId.get(x.parentId)) names.unshift(x.name);
      return { ...n, path: names.join(" › ") };
    });
}

/** Ready notes and syllabus of a course (what questions are written from). */
export async function questionSources(notebookId) {
  return (await listSources(notebookId)).filter((s) => s.status === "ready" && (s.kind === "material" || s.kind === "syllabus"));
}

export function runningJobs(userId) {
  prune();
  return [...jobs.values()].filter((j) => j.userId === userId && j.status === "running").length;
}

/** Starts a generation job; returns it. Throws 429 when the user already runs too many. */
export function startQuestionJob({ notebook, userId, nodes, sources, count, formatIds, difficulty, language }) {
  if (runningJobs(userId) >= MAX_RUNNING_PER_USER) throw Object.assign(new Error("You're already generating questions — wait for that to finish."), { status: 429 });
  const job = { id: crypto.randomUUID(), notebookId: notebook.id, userId, status: "running", total: count, done: 0, verified: 0, rejected: 0, questionIds: [], error: null, createdAt: Date.now() };
  jobs.set(job.id, job);
  (async () => {
    try {
      const nodeIds = nodes.map((n) => n.id);
      const avoid = (await listBankQuestions(notebook.id, { nodeIds, limit: 30 })).map((q) => q.stem);
      const result = await generateQuestions({ notebook, nodes, sources, count, formatIds, difficulty, avoid, language, onProgress: (p) => (job.done = p.done) });
      const rows = await insertBankQuestions(notebook.id, userId, result.questions);
      job.questionIds = rows.filter((r) => r.verified).map((r) => r.id);
      Object.assign(job, { status: "done", done: count, verified: result.verified, rejected: result.rejected });
    } catch (err) {
      console.warn(`Question generation failed: ${err.message}`);
      Object.assign(job, { status: "error", error: err.message });
    }
  })();
  return job;
}

export function getJob(id, userId, notebookId) {
  prune();
  const job = jobs.get(id);
  return job && job.userId === userId && job.notebookId === notebookId ? job : null;
}

export { toBankQuestion };
