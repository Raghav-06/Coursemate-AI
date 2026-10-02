# Ask AI

A NotebookLM-style research notebook: sign in with Google (or with email + password), create notebooks, add sources
(PDF, DOCX, PPTX, TXT/MD/CSV, websites, arXiv papers, pasted text), and ask questions that are
answered **only from your sources, with clickable citations**. Each source gets a guide (summary +
key topics) and each notebook an overview with suggested questions.

| Layer     | Tech |
|-----------|------|
| Frontend  | React 19 + Vite + Tailwind (`frontend/`) |
| Backend   | Node.js + Express (`backend/`) |
| Auth      | Google OAuth 2.0 (Passport) **or** email + verified code + password (scrypt hash); sessions in Postgres |
| Database  | PostgreSQL via `pg` — users, email verification codes, notebooks, sources, chunks + embeddings, chat, sessions |
| AI        | **LangChain** with any model provider — chat via any OpenAI-compatible API, embeddings via an OpenAI-compatible API or Hugging Face |

---

## 1. Prerequisites

- Node.js 20+
- PostgreSQL 13+ (local, or hosted: Neon, Supabase, Render, RDS…)
- A Google Cloud project (for Google sign-in)
- An SMTP account for sending verification emails (Gmail app password, SendGrid, Brevo, SES…). Optional in development.
- An API key from your AI provider (OpenAI, Anthropic, Gemini, Groq, OpenRouter, Mistral, Hugging Face…), or a local server such as Ollama

## 2. Create the database

```bash
createdb askai            # or: psql -U postgres -c "CREATE DATABASE askai;"
```

Tables are created automatically when the server starts (or run `npm run db:migrate` in `backend/`).
See `backend/src/db/schema.sql`.

## 3. Create Google OAuth credentials

1. Go to **Google Cloud Console → APIs & Services → OAuth consent screen**, choose *External*,
   fill in the app name/support email, and add yourself as a test user.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. **Authorized JavaScript origins:** `http://localhost:5173`
4. **Authorized redirect URIs:** `http://localhost:5173/auth/google/callback`
5. Copy the **Client ID** and **Client secret** into `backend/.env`.

> In development the callback goes through the Vite dev server (which proxies `/auth` and `/api`
> to Express on :3000), so the session cookie is set on the same origin as the app.

## 4. Fill in `backend/.env`

`backend/.env` already lists every variable. The ones you must fill in:

| Variable | What to put |
|----------|-------------|
| `DATABASE_URL` | `postgresql://USER:PASSWORD@localhost:5432/askai` (or use the `PG*` vars) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From step 3 (skip if you only want email sign-in) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Your email provider's SMTP settings. Leave `SMTP_HOST` empty in development and the codes are printed in the backend console instead. |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `CHAT_API_KEY`, `CHAT_BASE_URL`, `CHAT_MODEL` | Your provider's API key, its OpenAI-compatible base URL, and a chat model. `.env.example` lists the URLs for common providers. |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL` | `openai` (any OpenAI-compatible embeddings API) or `huggingface`, plus the model. `EMBEDDING_API_KEY` / `EMBEDDING_BASE_URL` default to the chat ones; set them when embeddings come from a different provider (Anthropic, Groq, DeepSeek and xAI have no embeddings API). |

## 5. Run it

```bash
# terminal 1
cd backend
npm install
npm run check-api     # optional: verifies your API key(s) + both models
npm run dev           # http://localhost:3000

# terminal 2
cd frontend
npm install
npm run dev           # open http://localhost:5173
```

Click **Sign in with Google**, or use email:

- **Create an account:** enter your email → type the 6-digit code from the email → choose your name and a password → you're signed in.
- **Sign in:** email + password.
- **Forgot password?:** same code flow, then set a new password. A Google user can also use this to add a password.

Each user only ever sees their own data.

### Sending real emails with Gmail

1. Turn on 2-Step Verification on the Google account that will send the emails.
2. Create an App Password at https://myaccount.google.com/apppasswords.
3. In `backend/.env`: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`,
   `SMTP_USER=you@gmail.com`, `SMTP_PASS=<the 16-character app password>`,
   `MAIL_FROM="Ask AI <you@gmail.com>"`.

---

## How it works

```
React (5173) ──/auth, /api──▶ Express (3000) ──▶ PostgreSQL
                                   │
                                   └──▶ LangChain ──▶ your AI provider(s) (chat + embeddings)
```

- **Google sign-in:** `/auth/google` → Google consent → `/auth/google/callback`. The user is upserted
  into `users` (Google id, email, name, avatar, last login) and a session is stored in
  `user_sessions`. The browser holds only an httpOnly cookie.
- **Email sign-up:** `/auth/email/start` emails a random 6-digit code. Only an HMAC of the code is
  stored (`email_verifications`), and each code expires after 10 minutes, allows 5 attempts and
  works once. A new one can be requested after 60 seconds. `/auth/email/verify` marks the email
  verified in the session, then `/auth/email/complete` saves the password as an **scrypt hash**
  (`users.password_hash`, never plain text) and signs the user in. Sign-in attempts are rate-limited.
- **One account per email:** if someone signs up with email and later uses Google with the same
  address (or the reverse), both sign-in methods open the same account and notebooks.
- **Authorization:** every `/api/*` route requires a session, and every notebook and source
  lookup is filtered by the signed-in user's id, so other users' ids return 404.
- **Sources:** text is extracted (files, URLs, pasted text), saved to `sources.content`, split into
  overlapping chunks, embedded, and stored in `chunks.embedding` (`REAL[]`).
- **Chat:** MMR retrieval over the selected sources → the model answers with `[n]` citations,
  streamed to the browser via Server-Sent Events. History is stored in `messages`.
- **AI through LangChain:** chat uses LangChain's `ChatOpenAI` class pointed at `CHAT_BASE_URL`,
  which works with any OpenAI-compatible API (OpenAI, Anthropic, Gemini, Groq, OpenRouter, Mistral,
  Together, DeepSeek, xAI, Hugging Face, Ollama, LM Studio…). Embeddings use `OpenAIEmbeddings`
  (any OpenAI-compatible embeddings API) or `HuggingFaceInferenceEmbeddings`, picked by
  `EMBEDDING_PROVIDER`. Chat and embeddings can use different providers and keys.
- **Changing models:** each source records which embedding model it used; if you change
  `EMBEDDING_MODEL` (or its provider), existing sources are re-embedded automatically the next time you chat.

### API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/auth/google` | Start Google sign-in |
| GET | `/auth/google/callback` | OAuth callback |
| GET | `/auth/me` | Current user (401 if signed out) |
| POST | `/auth/logout` | Sign out |
| POST | `/auth/email/start` | Email a 6-digit code `{ email, purpose: "signup" \| "reset" }` |
| POST | `/auth/email/verify` | Check the code `{ email, purpose, code }` |
| POST | `/auth/email/complete` | Set the password (and name on sign-up) → signed in |
| POST | `/auth/login` | Email + password sign-in |
| GET/POST | `/api/notebooks` | List / create notebooks |
| GET/PATCH/DELETE | `/api/notebooks/:id` | Read / rename / delete |
| GET | `/api/notebooks/:id/sources` | List sources |
| POST | `/api/notebooks/:id/sources/files` | Upload files (multipart `files`) |
| POST | `/api/notebooks/:id/sources/url` | Add links `{ urls: [] }` |
| POST | `/api/notebooks/:id/sources/text` | Add pasted text |
| GET/PATCH/DELETE | `/api/sources/:id` | Source details / rename, select / delete |
| GET | `/api/sources/:id/content` | Full source text |
| GET/DELETE | `/api/notebooks/:id/messages` | Chat history / clear |
| POST | `/api/notebooks/:id/chat` | Ask a question (SSE stream) |
| GET | `/api/arxiv?query=` | Discover arXiv papers |

## Deploying to production

1. `cd frontend && npm run build`
2. In `backend/.env`, set `NODE_ENV=production`, `CLIENT_URL=https://your-domain`,
   `GOOGLE_CALLBACK_URL=https://your-domain/auth/google/callback`, and `PGSSL=true` if your
   database requires SSL.
3. `cd backend && npm start`. Express serves the built frontend and the API from one origin
   (secure cookies are on automatically in production).
4. Add the production origin and callback URL to your Google OAuth client.

If you host the frontend on a different domain from the API, set `VITE_API_URL` in
`frontend/.env` before building, and set `COOKIE_SAME_SITE=none` + `COOKIE_SECURE=true` in the backend.

## CLI helpers (`backend/`)

```bash
npm run db:migrate                                   # create/update tables
npm run check-api                                    # test API key(s) + models
npm run create-database -- you@gmail.com file.pdf    # ingest files into a new notebook for a user
npm run cli-chat -- <notebookId>                     # chat in the terminal
```
