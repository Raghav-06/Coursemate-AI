# CourseMate AI

A study and exam-prep app for college courses: sign in with Google (or with email + password), create a
**course**, split it into **units**, add your material (PDF, DOCX, PPTX, TXT/MD/CSV, websites, arXiv
papers, pasted text), and ask questions that are answered **only from your sources, with clickable
citations**. Each source gets a guide (summary + key topics) and each course an overview with
suggested questions.

## Features

- **Courses with units** — group sources into units (chapters / modules) with collapsible headers;
  add, rename, reorder and delete units, move sources between them, and pick the unit when adding
  sources. Sources without a unit live under *General*. A scope selector above the chat input limits
  answers to the whole course or to chosen units.
- **Page and slide citations** — PDFs (uploaded or linked) record their pages and PPTX decks their
  slides, so citations read *p. 12*, *pp. 12–13* or *Slide 4* in the chips, popovers and source
  viewer (which shows page/slide markers). Original uploads are kept so any source can be
  **re-processed**; sources added before this feature gain page numbers that way (links are
  re-fetched; older slide decks recover their slides from the stored text).
- **Flashcards with spaced repetition** — generate decks of 10/20/30 cards (easy/medium/hard)
  from chosen units or the whole course; every card cites the page it came from. Add, edit and
  delete cards by hand. The *Study* area shows an "N due" badge and reviews cards with **SM-2**
  (Again / Hard / Good / Easy, each button showing the next interval; keys 1–4 and Space). Review
  progress is personal, and new cards are capped per day (`NEW_CARDS_PER_DAY`, default 20).
- **Quizzes, answer writing and weak topics** — the model extracts 5–15 **topics** per unit from
  its sources (refreshed automatically when the unit's sources change). *Practice* makes
  multiple-choice quizzes (5/10/15/20 questions, easy/medium/hard, chosen units) with explanations
  and the page each answer comes from, and **answer-writing** practice: generate (or type) a 2-, 5-
  or 10-mark question, write your answer, and get it **graded against your sources** — marks,
  correct points, missing points, mistakes and a cited model answer. *Progress* shows your
  **mastery** of every topic (weighted recent accuracy from quizzes, graded answers and flashcard
  ratings), weakest first, with "Revise these today" and one-click *Quiz me*, *Flashcards* and
  *Ask in chat*.
- **Past-paper analysis** — mark sources as *past exam papers* (with exam name and year) when
  adding them or later. CourseMate extracts every question (number, text, marks, section, year),
  finds where its answer is in your course material, and maps it to a unit and topic (embedding
  similarity, confirmed by the model). **Exam insights** ranks topics and units by how often they're
  examined, total marks and years, and lists the questions (filter by unit, topic or year) with
  citations to the answer and *Practise this question*, which opens Answer writing. Past papers
  are left out of chat answers (switch on *Include past papers* in the scope menu), quizzes,
  flashcards and topics.

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
                      # backend on another port? BACKEND_URL=http://localhost:3100 npm run dev
```

> Internally (database tables, API paths) a course is still called a *notebook*.

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
   `MAIL_FROM="CourseMate AI <you@gmail.com>"`.

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
  overlapping chunks, embedded, and stored in `chunks.embedding` (`REAL[]`). Pages and slides are
  recorded as character ranges in `sources.locations`, and each chunk stores the page(s) it spans
  in `chunks.location`. Uploaded files are kept in `ORIGINALS_DIR` (default `uploads/originals`)
  until their source is deleted.
- **Chat:** MMR retrieval over the selected sources → the model answers with `[n]` citations,
  streamed to the browser via Server-Sent Events. History is stored in `messages`.
- **AI through LangChain:** chat uses LangChain's `ChatOpenAI` class pointed at `CHAT_BASE_URL`,
  which works with any OpenAI-compatible API (OpenAI, Anthropic, Gemini, Groq, OpenRouter, Mistral,
  Together, DeepSeek, xAI, Hugging Face, Ollama, LM Studio…). Embeddings use `OpenAIEmbeddings`
  (any OpenAI-compatible embeddings API) or `HuggingFaceInferenceEmbeddings`, picked by
  `EMBEDDING_PROVIDER`. Chat and embeddings can use different providers and keys.
- **Spaced repetition:** decks and cards belong to the course; each user's SM-2 state lives in
  `card_reviews` (ease 2.5, interval, repetitions, due date, lapses) and every rating in
  `review_log`. The browser sends its timezone (`X-Timezone`) so "today" is the user's day.
- **Topics and mastery:** each unit's topics (`topics`, with a source fingerprint in `topic_sets`)
  are extracted from a sample of its passages and re-extracted when its sources change; topics that
  keep their name keep their id, so history survives. Quiz questions, graded answers and cards are
  tagged with a topic, and every answer adds a `topic_events` row (score 0–1, weight: quiz 1,
  flashcard 0.5, 2/5/10-mark answer 1/2/3). Mastery = weighted average of a topic's last 25 events,
  each older event counting 15% less. Quizzes, attempts, graded answers and mastery are personal.
- **Past papers:** `sources.kind` is `material` or `past_paper` (+ `exam_name`, `exam_year`,
  `paper_status`). After a paper is ingested, the model extracts its questions (long papers in
  ~14k-character windows); each question is embedded and compared with the course material's
  chunks — the best 3 become its citations and vote for a unit — then up to 5 candidate topics
  (by similarity, favouring that unit) go to the model to pick one (or none). Results live in
  `past_paper_questions`; a wrong topic can be fixed by hand.
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
| GET/POST | `/api/notebooks` | List / create courses |
| GET/PATCH/DELETE | `/api/notebooks/:id` | Read / rename / delete a course |
| GET/POST | `/api/notebooks/:id/units` | List / create units `{ title }` |
| PATCH/DELETE | `/api/notebooks/:id/units/:unitId` | Rename / delete a unit (its sources move to General) |
| PUT | `/api/notebooks/:id/units/order` | Reorder units `{ unitIds: [] }` |
| GET | `/api/notebooks/:id/sources` | List sources |
| POST | `/api/notebooks/:id/sources/files` | Upload files (multipart `files`, optional `unitId`, `kind`, `examName`, `examYear`) |
| POST | `/api/notebooks/:id/sources/url` | Add links `{ urls: [], unitId?, kind?, examName?, examYear? }` |
| POST | `/api/notebooks/:id/sources/text` | Add pasted text `{ title?, text, unitId?, kind?, examName?, examYear? }` |
| GET/PATCH/DELETE | `/api/sources/:id` | Source details / rename, select, move `{ unitId }`, `{ kind: material\|past_paper, examName, examYear }` / delete |
| GET | `/api/sources/:id/content` | Full source text + page/slide `locations` `[{ label, start, end }]` |
| POST | `/api/sources/:id/reprocess` | Extract, chunk and embed a source again (202; 409 while processing) |
| GET/DELETE | `/api/notebooks/:id/messages` | Chat history / clear |
| POST | `/api/notebooks/:id/chat` | Ask a question (SSE stream) `{ content, sourceIds?, unitIds?, includePastPapers? }` |
| GET | `/api/arxiv?query=` | Discover arXiv papers |
| GET/POST | `/api/notebooks/:id/decks` | List decks with due/new counts / create an empty deck `{ title, unitId? }` |
| POST | `/api/notebooks/:id/decks/generate` | Generate a deck `{ count: 10\|20\|30, difficulty, unitIds?, sourceIds?, topicIds?, title? }` |
| GET | `/api/notebooks/:id/review?deckId=` | Cards to review now (due first, then today's new cards), with next-interval previews |
| GET/PATCH/DELETE | `/api/decks/:deckId` | Deck with its cards / rename, set unit / delete |
| POST | `/api/decks/:deckId/cards` | Add a card `{ front, back, topic? }` |
| PATCH/DELETE | `/api/cards/:cardId` | Edit / delete a card |
| POST | `/api/cards/:cardId/review` | Rate a card `{ rating: again\|hard\|good\|easy }` → new SM-2 state |
| GET | `/api/notebooks/:id/topics` | Topics per unit with status (ready / pending / error / empty) |
| POST | `/api/notebooks/:id/topics/refresh` | Re-extract topics `{ unitId? }` (202) |
| GET | `/api/notebooks/:id/progress` | Your mastery per unit and topic, weakest first, plus "revise these today" |
| GET/POST | `/api/notebooks/:id/quizzes` | Your quizzes / make one `{ count: 5\|10\|15\|20, difficulty, unitIds?, topicIds?, title? }` |
| GET/DELETE | `/api/quizzes/:quizId` | Quiz with its questions (no answers) / delete |
| POST | `/api/quizzes/:quizId/attempts` | Start an attempt |
| POST | `/api/quiz-attempts/:attemptId/answers` | Answer `{ questionId, chosenIndex, timeMs }` → correct, explanation, citation |
| POST | `/api/quiz-attempts/:attemptId/finish` | Finish → score, per-topic results, every answer |
| GET | `/api/quiz-attempts/:attemptId` | Review of a finished attempt |
| POST | `/api/notebooks/:id/written-questions` | Exam-style questions `{ marks: 2\|5\|10, count: 1-5, unitIds?, topicIds? }` |
| GET/POST | `/api/notebooks/:id/answers` | Your graded answers / grade one `{ question, marks, answer, unitIds?, topicId? }` |
| GET/DELETE | `/api/answers/:answerId` | A graded answer / delete it |
| GET | `/api/notebooks/:id/exam-insights` | Past papers, and topics / units ranked by frequency, marks and years |
| GET | `/api/notebooks/:id/past-paper-questions?unitId=&topicId=&year=&sourceId=` | Past-paper questions with citations to the answer |
| PATCH | `/api/notebooks/:id/past-paper-questions/:questionId` | Fix a question's topic or unit `{ topicId?, unitId? }` |
| POST | `/api/sources/:id/analyse` | Extract and map a past paper's questions again (202) |

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
