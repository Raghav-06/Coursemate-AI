import { AsyncLocalStorage } from "node:async_hooks";

// Who an AI call is for (user, course), so llm.js can log it in ai_calls
// without every service passing ids through. Each /api request gets its own
// context; the :id course loader fills in the course. Background work started
// by a request (ingestion, analysis) inherits it; jobs outside a request use
// withAiContext().

const storage = new AsyncLocalStorage();

export function aiContextMiddleware(req, _res, next) {
  storage.run({ userId: req.user?.id ?? null, notebookId: null }, next);
}

/** Records the course the current request is about. */
export function setAiNotebook(notebookId) {
  const store = storage.getStore();
  if (store) store.notebookId = notebookId;
}

export const currentAiContext = () => storage.getStore() ?? {};

/** Runs `fn` with { userId?, notebookId? } as the AI-call context. */
export function withAiContext(context, fn) {
  return storage.run({ userId: null, notebookId: null, ...context }, fn);
}
