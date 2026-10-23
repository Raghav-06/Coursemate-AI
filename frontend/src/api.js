// Thin client for the CourseMate AI backend. In dev, Vite proxies /api to :3000;
// set VITE_API_URL to call a backend on another origin.
const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

// Fired when the session has expired so the app can show the sign-in page.
export const UNAUTHORIZED_EVENT = "cm:unauthorized";

// The server uses the browser's timezone for "today" (new-card caps, goals, streaks).
const TIMEZONE = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

function failure(response, data) {
  if (response.status === 401 && !new URL(response.url).pathname.startsWith("/auth/")) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  return Object.assign(new Error(data?.message || `Request failed (${response.status}).`), { status: response.status });
}

async function request(path, { method = "GET", body, form } = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      // Sends the session cookie (also when the API is on another origin).
      credentials: "include",
      headers: { "X-Timezone": TIMEZONE, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new Error("Can't reach the CourseMate AI server. Is the backend running on port 3000?");
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw failure(response, data);
  return data;
}

// Multipart upload with progress (fetch can't report upload progress).
// `onProgress(fraction)` is called as the body is sent.
function upload(path, form, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-Timezone", TIMEZONE);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new Error("Can't reach the CourseMate AI server. Is the backend running on port 3000?"));
    xhr.onload = () => {
      const data = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      if (xhr.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      const message = xhr.status === 413 ? "That file is larger than the server allows." : data?.message || `Upload failed (${xhr.status}).`;
      reject(Object.assign(new Error(message), { status: xhr.status }));
    };
    xhr.send(form);
  });
}

export const api = {
  base: BASE,
  health: () => request("/health"),
  me: () => request("/auth/me"),
  logout: () => request("/auth/logout", { method: "POST" }),
  // Email + password accounts
  login: (email, password) => request("/auth/login", { method: "POST", body: { email, password } }),
  emailStart: (email, purpose) => request("/auth/email/start", { method: "POST", body: { email, purpose } }),
  emailVerify: (email, purpose, code) => request("/auth/email/verify", { method: "POST", body: { email, purpose, code } }),
  emailComplete: (password, name) => request("/auth/email/complete", { method: "POST", body: { password, name } }),

  listNotebooks: () => request("/api/notebooks"),
  createNotebook: (title) => request("/api/notebooks", { method: "POST", body: { title } }),
  getNotebook: (id) => request(`/api/notebooks/${id}`),
  updateNotebook: (id, patch) => request(`/api/notebooks/${id}`, { method: "PATCH", body: patch }),
  deleteNotebook: (id) => request(`/api/notebooks/${id}`, { method: "DELETE" }),
  refreshOverview: (id) => request(`/api/notebooks/${id}/overview`, { method: "POST" }),

  listUnits: (id) => request(`/api/notebooks/${id}/units`),
  createUnit: (id, title) => request(`/api/notebooks/${id}/units`, { method: "POST", body: { title } }),
  renameUnit: (id, unitId, title) => request(`/api/notebooks/${id}/units/${unitId}`, { method: "PATCH", body: { title } }),
  reorderUnits: (id, unitIds) => request(`/api/notebooks/${id}/units/order`, { method: "PUT", body: { unitIds } }),
  deleteUnit: (id, unitId) => request(`/api/notebooks/${id}/units/${unitId}`, { method: "DELETE" }),

  // `unitId` (optional) files new sources under a unit; null = General.
  // `kind` ({ kind: "material" | "past_paper", examName?, examYear? }) marks past exam papers.
  listSources: (id) => request(`/api/notebooks/${id}/sources`),
  uploadFiles: (id, files, unitId, kind = {}, onProgress) => {
    const form = new FormData();
    if (unitId) form.append("unitId", unitId);
    for (const [key, value] of Object.entries(kind)) if (value !== undefined && value !== null && value !== "") form.append(key, String(value));
    for (const file of files) form.append("files", file);
    return upload(`/api/notebooks/${id}/sources/files`, form, onProgress);
  },
  // The uploaded image or recording of a source (for <img>, <audio>, <video>).
  sourceOriginalUrl: (sourceId) => `${BASE}/api/sources/${sourceId}/original`,
  addUrls: (id, urls, unitId, kind = {}) => request(`/api/notebooks/${id}/sources/url`, { method: "POST", body: { urls, unitId, ...kind } }),
  addUrl: (id, url, title, unitId) => request(`/api/notebooks/${id}/sources/url`, { method: "POST", body: { url, title, unitId } }),
  addText: (id, title, text, unitId, kind = {}) => request(`/api/notebooks/${id}/sources/text`, { method: "POST", body: { title, text, unitId, ...kind } }),
  analysePaper: (sourceId) => request(`/api/sources/${sourceId}/analyse`, { method: "POST" }),
  getSourceContent: (sourceId) => request(`/api/sources/${sourceId}/content`),
  updateSource: (sourceId, patch) => request(`/api/sources/${sourceId}`, { method: "PATCH", body: patch }),
  deleteSource: (sourceId) => request(`/api/sources/${sourceId}`, { method: "DELETE" }),
  reprocessSource: (sourceId) => request(`/api/sources/${sourceId}/reprocess`, { method: "POST" }),
  searchArxiv: (query) => request(`/api/arxiv?query=${encodeURIComponent(query)}&maxDocs=10`),

  // Sharing: members (owner / editor / viewer) and email invites
  listMembers: (id) => request(`/api/notebooks/${id}/members`),
  inviteMember: (id, email, role) => request(`/api/notebooks/${id}/invites`, { method: "POST", body: { email, role } }),
  revokeInvite: (id, inviteId) => request(`/api/notebooks/${id}/invites/${inviteId}`, { method: "DELETE" }),
  setMemberRole: (id, userId, role) => request(`/api/notebooks/${id}/members/${userId}`, { method: "PATCH", body: { role } }),
  removeMember: (id, userId) => request(`/api/notebooks/${id}/members/${userId}`, { method: "DELETE" }),
  leaveCourse: (id) => request(`/api/notebooks/${id}/members/me`, { method: "DELETE" }),
  getInvite: (token) => request(`/api/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token) => request(`/api/invites/${encodeURIComponent(token)}/accept`, { method: "POST" }),

  // Quiz battles (live games by join code; state streams over Server-Sent Events)
  listBattles: (id) => request(`/api/notebooks/${id}/battles`),
  createBattle: (id, body) => request(`/api/notebooks/${id}/battles`, { method: "POST", body }),
  joinBattle: (code) => request("/api/battles/join", { method: "POST", body: { code } }),
  getBattle: (code) => request(`/api/battles/${encodeURIComponent(code)}`),
  battleEventsUrl: (code) => `${BASE}/api/battles/${encodeURIComponent(code)}/events`,
  startBattle: (code) => request(`/api/battles/${encodeURIComponent(code)}/start`, { method: "POST" }),
  answerBattle: (code, index, choice) => request(`/api/battles/${encodeURIComponent(code)}/answer`, { method: "POST", body: { index, choice } }),
  leaveBattle: (code) => request(`/api/battles/${encodeURIComponent(code)}/leave`, { method: "POST" }),

  // Flashcards (decks are per course; review state is per user)
  listDecks: (id) => request(`/api/notebooks/${id}/decks`),
  createDeck: (id, body) => request(`/api/notebooks/${id}/decks`, { method: "POST", body }),
  generateDeck: (id, body) => request(`/api/notebooks/${id}/decks/generate`, { method: "POST", body }),
  getDeck: (deckId) => request(`/api/decks/${deckId}`),
  updateDeck: (deckId, patch) => request(`/api/decks/${deckId}`, { method: "PATCH", body: patch }),
  deleteDeck: (deckId) => request(`/api/decks/${deckId}`, { method: "DELETE" }),
  addCard: (deckId, card) => request(`/api/decks/${deckId}/cards`, { method: "POST", body: card }),
  updateCard: (cardId, patch) => request(`/api/cards/${cardId}`, { method: "PATCH", body: patch }),
  deleteCard: (cardId) => request(`/api/cards/${cardId}`, { method: "DELETE" }),
  reviewQueue: (id, deckId) => request(`/api/notebooks/${id}/review${deckId ? `?deckId=${deckId}` : ""}`),
  reviewCard: (cardId, rating) => request(`/api/cards/${cardId}/review`, { method: "POST", body: { rating } }),

  // Practice: topics, quizzes, written answers, progress (personal)
  getTopics: (id) => request(`/api/notebooks/${id}/topics`),
  refreshTopics: (id, unitId) => request(`/api/notebooks/${id}/topics/refresh`, { method: "POST", body: unitId === undefined ? {} : { unitId } }),
  getProgress: (id) => request(`/api/notebooks/${id}/progress`),
  listQuizzes: (id) => request(`/api/notebooks/${id}/quizzes`),
  createQuiz: (id, body) => request(`/api/notebooks/${id}/quizzes`, { method: "POST", body }),
  getQuiz: (quizId) => request(`/api/quizzes/${quizId}`),
  deleteQuiz: (quizId) => request(`/api/quizzes/${quizId}`, { method: "DELETE" }),
  startQuizAttempt: (quizId) => request(`/api/quizzes/${quizId}/attempts`, { method: "POST" }),
  answerQuizQuestion: (attemptId, body) => request(`/api/quiz-attempts/${attemptId}/answers`, { method: "POST", body }),
  finishQuizAttempt: (attemptId) => request(`/api/quiz-attempts/${attemptId}/finish`, { method: "POST" }),
  writtenQuestions: (id, body) => request(`/api/notebooks/${id}/written-questions`, { method: "POST", body }),
  gradeAnswer: (id, body) => request(`/api/notebooks/${id}/answers`, { method: "POST", body }),
  listAnswers: (id) => request(`/api/notebooks/${id}/answers`),
  deleteAnswer: (answerId) => request(`/api/answers/${answerId}`, { method: "DELETE" }),
  listExplanations: (id) => request(`/api/notebooks/${id}/explanations`),
  explainBack: (id, body) => request(`/api/notebooks/${id}/explanations`, { method: "POST", body }),
  deleteExplanation: (explanationId) => request(`/api/explanations/${explanationId}`, { method: "DELETE" }),

  // Exams and revision plans (personal), daily goal, streaks
  today: () => request("/api/today"),
  getSettings: () => request("/api/settings"),
  updateSettings: (patch) => request("/api/settings", { method: "PATCH", body: patch }),
  getCoursePreferences: (id) => request(`/api/notebooks/${id}/preferences`),
  updateCoursePreferences: (id, patch) => request(`/api/notebooks/${id}/preferences`, { method: "PATCH", body: patch }),
  listExams: (id) => request(`/api/notebooks/${id}/exams`),
  createExam: (id, body) => request(`/api/notebooks/${id}/exams`, { method: "POST", body }),
  getExam: (examId) => request(`/api/exams/${examId}`),
  updateExam: (examId, patch) => request(`/api/exams/${examId}`, { method: "PATCH", body: patch }),
  deleteExam: (examId) => request(`/api/exams/${examId}`, { method: "DELETE" }),
  generatePlan: (examId) => request(`/api/exams/${examId}/plan`, { method: "POST" }),
  replanExam: (examId) => request(`/api/exams/${examId}/replan`, { method: "POST" }),
  setTaskDone: (itemId, done) => request(`/api/plan-items/${itemId}`, { method: "PATCH", body: { done } }),
  // Weekly plan (agent): schedule, the week's tasks, replanning and what changed
  updateSchedule: (examId, body) => request(`/api/exams/${examId}/schedule`, { method: "PATCH", body }),
  generateWeeklyPlan: (examId) => request(`/api/exams/${examId}/weekly-plan`, { method: "POST" }),
  weeklyPlan: (examId, week) => request(`/api/exams/${examId}/weekly-plan${week ? `?week=${week}` : ""}`),
  replanWeek: (examId) => request(`/api/exams/${examId}/weekly-plan/replan`, { method: "POST" }),
  planChanges: (examId) => request(`/api/exams/${examId}/plan-changes`),
  skipTask: (itemId, skipped, reason) => request(`/api/plan-items/${itemId}`, { method: "PATCH", body: { skipped, reason } }),
  startTask: (itemId) => request(`/api/plan-items/${itemId}/start`, { method: "POST" }),

  // Past papers (exam insights)
  examInsights: (id) => request(`/api/notebooks/${id}/exam-insights`),
  pastPaperQuestions: (id, filters = {}) => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();
    return request(`/api/notebooks/${id}/past-paper-questions${qs ? `?${qs}` : ""}`);
  },
  updatePastPaperQuestion: (id, questionId, patch) => request(`/api/notebooks/${id}/past-paper-questions/${questionId}`, { method: "PATCH", body: patch }),

  // Exam-prep agent: exam profile (course setting) and knowledge map
  examProfiles: () => request("/api/exam-profiles"),
  getExamProfile: (id) => request(`/api/notebooks/${id}/exam-profile`),
  setExamProfile: (id, body) => request(`/api/notebooks/${id}/exam-profile`, { method: "PUT", body }),
  knowledgeMap: (id) => request(`/api/notebooks/${id}/knowledge-map`),
  rebuildKnowledgeMap: (id) => request(`/api/notebooks/${id}/knowledge-map/rebuild`, { method: "POST" }),
  mapNode: (id, nodeId) => request(`/api/notebooks/${id}/knowledge-map/nodes/${nodeId}`),
  generateQuestions: (id, body) => request(`/api/notebooks/${id}/questions/generate`, { method: "POST", body }),
  questionJob: (id, jobId) => request(`/api/notebooks/${id}/questions/jobs/${jobId}`),
  listBankQuestions: (id, nodeId) => request(`/api/notebooks/${id}/questions${nodeId ? `?nodeId=${nodeId}` : ""}`),
  getQuestion: (questionId, reveal = false) => request(`/api/questions/${questionId}${reveal ? "?reveal=1" : ""}`),
  reportQuestion: (questionId, body) => request(`/api/questions/${questionId}/report`, { method: "POST", body }),
  createSession: (id, body) => request(`/api/notebooks/${id}/sessions`, { method: "POST", body }),
  listSessions: (id) => request(`/api/notebooks/${id}/sessions`),
  getSession: (sessionId) => request(`/api/sessions/${sessionId}`),
  startSession: (sessionId) => request(`/api/sessions/${sessionId}/start`, { method: "POST" }),
  saveSessionAnswer: (sessionId, position, body) => request(`/api/sessions/${sessionId}/answers/${position}`, { method: "PUT", body }),
  uploadWorking: (sessionId, position, file) => {
    const form = new FormData();
    form.append("image", file);
    return request(`/api/sessions/${sessionId}/answers/${position}/working`, { method: "POST", form });
  },
  finishSession: (sessionId) => request(`/api/sessions/${sessionId}/finish`, { method: "POST" }),
  sessionResults: (sessionId) => request(`/api/sessions/${sessionId}/results`),
  sessionDiagnoses: (sessionId) => request(`/api/sessions/${sessionId}/diagnoses`),
  getDiagnosis: (diagnosisId) => request(`/api/diagnoses/${diagnosisId}`),
  diagnosisFeedback: (diagnosisId, feedback, note) => request(`/api/diagnoses/${diagnosisId}`, { method: "PATCH", body: { feedback, note } }),
  retryDiagnosis: (diagnosisId) => request(`/api/diagnoses/${diagnosisId}/retry`, { method: "POST" }),
  practiseDiagnosis: (diagnosisId) => request(`/api/diagnoses/${diagnosisId}/practice`, { method: "POST" }),
  mistakes: (id) => request(`/api/notebooks/${id}/mistakes`),
  aiUsage: (days = 30) => request(`/api/me/ai-usage?days=${days}`),

  listMessages: (id) => request(`/api/notebooks/${id}/messages`),
  clearMessages: (id) => request(`/api/notebooks/${id}/messages`, { method: "DELETE" }),

  /**
   * Streams a chat answer. `body`: { content, sourceIds?, unitIds? }.
   * `onEvent` receives the server's SSE events: user | citations | delta | done | error.
   */
  async chat(id, body, onEvent, signal) {
    let response;
    try {
      response = await fetch(`${BASE}/api/notebooks/${id}/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-Timezone": TIMEZONE },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err.name === "AbortError") return;
      throw new Error("Can't reach the CourseMate AI server. Is the backend running on port 3000?");
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw failure(response, data);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop();
        for (const event of events) {
          const line = event.split("\n").find((l) => l.startsWith("data: "));
          if (line) onEvent(JSON.parse(line.slice(6)));
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") throw err;
    }
  },
};
