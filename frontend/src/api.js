// Thin client for the Ask AI backend. In dev, Vite proxies /api to :3000;
// set VITE_API_URL to call a backend on another origin.
const BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

// Fired when the session has expired so the app can show the sign-in page.
export const UNAUTHORIZED_EVENT = "cm:unauthorized";

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
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new Error("Can't reach the Ask AI server. Is the backend running on port 3000?");
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw failure(response, data);
  return data;
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

  listSources: (id) => request(`/api/notebooks/${id}/sources`),
  uploadFiles: (id, files) => {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    return request(`/api/notebooks/${id}/sources/files`, { method: "POST", form });
  },
  addUrls: (id, urls) => request(`/api/notebooks/${id}/sources/url`, { method: "POST", body: { urls } }),
  addUrl: (id, url, title) => request(`/api/notebooks/${id}/sources/url`, { method: "POST", body: { url, title } }),
  addText: (id, title, text) => request(`/api/notebooks/${id}/sources/text`, { method: "POST", body: { title, text } }),
  getSourceContent: (sourceId) => request(`/api/sources/${sourceId}/content`),
  updateSource: (sourceId, patch) => request(`/api/sources/${sourceId}`, { method: "PATCH", body: patch }),
  deleteSource: (sourceId) => request(`/api/sources/${sourceId}`, { method: "DELETE" }),
  searchArxiv: (query) => request(`/api/arxiv?query=${encodeURIComponent(query)}&maxDocs=10`),

  listMessages: (id) => request(`/api/notebooks/${id}/messages`),
  clearMessages: (id) => request(`/api/notebooks/${id}/messages`, { method: "DELETE" }),

  /**
   * Streams a chat answer. `onEvent` receives the server's SSE events:
   * user | citations | delta | done | error.
   */
  async chat(id, content, sourceIds, onEvent, signal) {
    let response;
    try {
      response = await fetch(`${BASE}/api/notebooks/${id}/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, sourceIds }),
        signal,
      });
    } catch (err) {
      if (err.name === "AbortError") return;
      throw new Error("Can't reach the Ask AI server. Is the backend running on port 3000?");
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
