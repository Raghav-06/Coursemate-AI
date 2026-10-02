# Ask AI Backend (Node / Express / PostgreSQL)

Setup, environment variables, Google OAuth and the API reference are in the
[project README](../README.md).

```bash
npm install
# fill in .env (DATABASE_URL, GOOGLE_CLIENT_ID/SECRET, SESSION_SECRET, SMTP_*, CHAT_API_KEY / CHAT_BASE_URL / CHAT_MODEL, EMBEDDING_*)
npm run dev
```

Layout:

- `src/auth/passport.js` — Google OAuth strategy (users upserted into Postgres)
- `src/routes/auth.routes.js` — `/auth/google`, `/auth/google/callback`, `/auth/me`, `/auth/logout`
- `src/middleware/requireAuth.js` — protects every `/api` route
- `src/db/schema.sql`, `src/db/pool.js`, `src/db/store.js` — schema, `pg` pool, queries
- `src/services/llm.js`, `embeddings.js` — LangChain clients for the chat model (any OpenAI-compatible provider) and embedding model (OpenAI-compatible or Hugging Face)
- `src/services/*` — ingestion, URL loading, vector search (MMR), RAG chat, source guides and notebook overviews
