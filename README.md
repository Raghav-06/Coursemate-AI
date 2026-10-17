# CourseMate AI

**Study and exam prep for college courses, built on your own material.** Create a **course**, split
it into **units**, and add what your lecturer gave you — PDFs, slides, Word docs, photos of
handwritten notes, scanned PDFs, lecture recordings, links, past exam papers. CourseMate turns them
into spaced-repetition **flashcards**, **quizzes**, **graded answer-writing practice**,
**explain-it-back** checks, **past-paper insights**, a **revision plan** to exam day and live **quiz
battles** with classmates — and every answer cites the exact page, slide or minute it came from.
It runs on any AI provider, or entirely on local models, and answers in English or 11 Indian
languages.

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
- **Exam mode, revision plans, daily goal and streaks** — add your exam (date + units) in a
  course's *Exams* tab and get a **day-by-day revision plan** to the exam: read, quiz, answer-writing
  and past-paper tasks per topic plus daily flashcards, prioritised by your weak topics, how often
  past papers ask about them and the cards you have due. Tick tasks off, start them in one click,
  **re-plan missed days** or regenerate the plan. Every study action (flashcard review, quiz answer,
  graded answer, chat question) counts toward a **daily goal** (default 20, changeable); meeting it
  on consecutive days builds a **streak**. The home page opens on **Today**: goal ring, streak, the
  last 7 days, the next exam's countdown with today's tasks, and flashcards due across courses.
- **Explain it back** — pick a topic (or type a question) and explain it in your own words; the
  model compares it with your sources and lists what's right, the gaps and any misconceptions
  (each cited), scores clarity and accuracy out of 10, and asks one follow-up question you can
  explain next. It counts toward topic mastery and your daily goal.
- **Answers in Indian languages** — *Settings* (account menu) sets the response language:
  English, Hindi, Bengali, Marathi, Tamil, Telugu, Gujarati, Kannada, Malayalam, Punjabi, Odia or
  Urdu, optionally **bilingual** (explanations in your language, technical terms in English). A
  course can override it (the 文A button in its header). It applies to every AI feature — chat,
  source guides, course overview, flashcards, quizzes, written questions, grading,
  explain-it-back and revision-plan tips — keeping formulas, symbols and `[n]` citations intact.
- **Handwritten notes and lecture recordings** — upload photos (PNG, JPG, WebP) of handwritten
  notes or whiteboards, or scanned PDFs without a text layer: a **vision model** reads the text
  (formulas and diagrams described, unreadable words marked), and the viewer shows the image next
  to the extracted text. Upload **lecture recordings** — audio (MP3, M4A, WAV, WebM, OGG) or video
  (MP4, MOV, MKV): the audio is extracted, compressed and split with ffmpeg and transcribed with
  timestamps, so citations point to the moment in the lecture (*12:34*) and the viewer plays the
  recording from any timestamp. Progress ("Transcribing part 2 of 5…") shows under the source.
- **Shared courses with roles** — the course owner invites classmates by email as **editors**
  (add and change sources, units and decks) or **viewers** (read, chat, study and practise). People
  who already have an account are added at once; anyone else gets an invite link (emailed, or
  copyable when SMTP isn't set) that applies when they sign up or sign in with that address. Chat
  history, flashcard progress, quizzes, graded answers, mastery, exams and plans — and which sources
  are ticked for chat — stay **personal**. Shared courses show who owns them; members can leave.
- **Quiz battles** — start a battle from chosen units (5/10/15 questions, 10/20/30 s each): you get
  a 6-character **join code** for people in the course → lobby → the host starts → timed questions
  one at a time, **500 points for a correct answer plus up to 500 for speed** → live leaderboard
  (Server-Sent Events) → results saved, and every answer counts toward your daily goal and topic
  mastery like a quiz.
- **Made for studying** — a calm paper-and-ink look (light and dark) with serif headings; each
  course has a left sidebar with its tools (Chat, Study, Practice, Exam plan, Exam insights,
  Progress) and its units and sources, the selected tool in the main area, and sources opening in a
  slide-over viewer. Home opens on **Today**. Works on phones (drawer + bottom bar).

| Layer     | Tech |
|-----------|------|
| Frontend  | React 19 + Vite + Tailwind (`frontend/`) |
| Backend   | Node.js + Express (`backend/`) |
| Auth      | Google OAuth 2.0 (Passport) **or** email + verified code + password (scrypt hash); sessions in Postgres |
| Database  | PostgreSQL via `pg` — users, email verification codes, notebooks, sources, chunks + embeddings, chat, sessions |
| AI        | **LangChain** with any model provider — chat and vision via any OpenAI-compatible API, embeddings via an OpenAI-compatible API or Hugging Face; transcription via any OpenAI-compatible `/audio/transcriptions` API (audio prepared with ffmpeg) |

---

## Any AI provider — or fully local

CourseMate talks to models through LangChain and plain OpenAI-compatible APIs, so you choose where
your notes go. Set one provider for everything — `AI_PROVIDER` (`openai`, `anthropic`, `gemini`,
`groq`, `openrouter`, `mistral`, `together`, `deepseek`, `xai`, `huggingface`, `ollama`, `lmstudio`,
or `custom` with `AI_BASE_URL`), `AI_API_KEY` and `LLM_MODEL` — and the base URL is filled in for
you. Any job can use a different provider with its own `<JOB>_PROVIDER`, `<JOB>_API_KEY` and
`<JOB>_BASE_URL`. *Settings → AI & privacy* in the app shows which models the server uses (never
the keys):

| Job | Settings (empty = the shared `AI_*` ones) | Hosted examples | Local examples |
|-----|----------|-----------------|----------------|
| LLM: chat, guides, flashcards, quizzes, grading, plans | `LLM_MODEL`, `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_BASE_URL` | OpenAI, Anthropic, Gemini, Groq, OpenRouter, Mistral… | Ollama (`llama3.1`, `qwen2.5`), LM Studio |
| Search (embeddings) | `EMBEDDING_MODEL`, `EMBEDDING_PROVIDER`, `EMBEDDING_API_KEY`, `EMBEDDING_BASE_URL` | OpenAI `text-embedding-3-small`, Gemini, Mistral, Hugging Face | Ollama `nomic-embed-text`, LM Studio |
| Reading photos / scans | `VISION_MODEL` (default: `LLM_MODEL`), `VISION_PROVIDER`, `VISION_API_KEY`, `VISION_BASE_URL` | `gpt-4o-mini`, Gemini, Claude | Ollama `qwen2.5vl`, `llava`, `llama3.2-vision` |
| Transcribing lectures | `TRANSCRIBE_MODEL`, `TRANSCRIBE_PROVIDER`, `TRANSCRIBE_API_KEY`, `TRANSCRIBE_BASE_URL` | OpenAI `whisper-1`, Groq `whisper-large-v3-turbo` | any local server with an OpenAI-compatible `/audio/transcriptions` (e.g. faster-whisper-server, LocalAI) |

The older `CHAT_API_KEY`, `CHAT_BASE_URL` and `CHAT_MODEL` names are still read.

**Keeping notes on your machine:** point every job at a local server (Ollama, LM Studio,
LocalAI…) — no API keys are needed for `localhost` — and nothing you upload leaves the computer
running the backend; the AI & privacy panel then says "on this computer" for each model. Small local
models write weaker flashcards and grades than large hosted ones, and `npm run check-api` tests the
chat and embedding settings before you start.

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
| `AI_PROVIDER`, `AI_API_KEY`, `LLM_MODEL` | Your provider's name (`.env.example` lists them, with their URLs and example models), its API key, and a chat model. `AI_BASE_URL` overrides the URL (required for `custom`). |
| `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL` | Any provider above, or `huggingface` (feature extraction), plus the model. Empty provider / key / URL = the `AI_*` ones; set `EMBEDDING_PROVIDER` and `EMBEDDING_API_KEY` when the main provider has no embeddings API (Anthropic, Groq, DeepSeek, xAI). |
| `VISION_*` (optional) | A model that accepts images, for photos of notes and scanned PDFs. Empty = the `AI_*` settings and `LLM_MODEL` (fine for gpt-4o-mini, Gemini, Claude). |
| `TRANSCRIBE_*` (optional) | Speech-to-text for lecture recordings: `TRANSCRIBE_PROVIDER=openai` + `whisper-1`, or `groq` + `whisper-large-v3-turbo`. Empty = the `AI_*` settings. |

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
- **Authorization:** every `/api/*` route requires a session. A course is visible only to its
  members (`notebook_members`: owner / editor / viewer — every course lookup, and every deck, card,
  quiz, exam… reached through one, checks membership), so other users' ids return 404. Changing
  sources, units, decks, the course title or past-paper mappings needs editor (403 for viewers);
  members, invites and deleting the course need the owner. Personal data is additionally filtered
  by user id. `npm run check-access` (in `backend/`) proves it against your database: throwaway
  owner/editor/viewer/outsider accounts, ~45 checks, cleaned up afterwards.
- **Sharing:** `notebook_invites` holds open invites (email, role, a SHA-256 hash of the token,
  expiry — `INVITE_TTL_DAYS`, default 14). They are applied when a verified account with that email
  signs up or signs in, or opens the link (`#/invite/<token>`; only the invited email can accept).
  On upgrade, each existing course's creator becomes its owner, existing chat messages are assigned
  to that owner, and sources that were unticked stay unticked for the owner only
  (`source_deselections`).
- **Quiz battles:** live games are held **in the server's memory** (fine for one backend process;
  a restart ends running games, and several processes behind a load balancer would need a shared
  store such as Redis). Questions come from the quiz generator; players follow along over
  Server-Sent Events (`/api/battles/:code/events`), answers are hidden until a question closes, and
  a question closes early when everyone has answered. Finished games are saved to `battles` and
  `battle_players`. Only members of the battle's course can join (`MAX_BATTLE_PLAYERS`, default 30).
- **Sources:** text is extracted (files, URLs, pasted text), saved to `sources.content`, split into
  overlapping chunks, embedded, and stored in `chunks.embedding` (`REAL[]`). Pages and slides are
  recorded as character ranges in `sources.locations`, and each chunk stores the page(s) it spans
  in `chunks.location`. Uploaded files are kept in `ORIGINALS_DIR` (default `uploads/originals`)
  until their source is deleted.
- **Images and recordings:** photos and scanned PDF pages (pages whose text layer is empty; the
  page image is decoded with pdf.js, at most `VISION_MAX_PAGES` per PDF) are sent to the vision
  model as data URLs (large photos are scaled to ≤ 2048 px JPEG first) through LangChain
  (`completeVision` in `llm.js`, settings `VISION_*`). Recordings go through ffmpeg
  (`ffmpeg-static`, or `FFMPEG_PATH`): audio only, mono 16 kHz MP3 at 32 kbit/s, split into pieces
  of at most 10 minutes and below `TRANSCRIBE_MAX_MB` (default 24, under OpenAI's and Groq's 25 MB
  limit). Each piece is posted to `TRANSCRIBE_BASE_URL/audio/transcriptions` with
  `response_format=verbose_json`; segment times are shifted by the piece's start and grouped into
  ~45-second paragraphs whose start time ("12:34") becomes the location used by citations. Uploads
  are capped by `UPLOAD_MAX_MB`. *Note:* `ffmpeg-static` downloads an ffmpeg binary for the OS
  that ran `npm install`; if you move `node_modules` between Windows and WSL/Linux, run
  `npm rebuild ffmpeg-static`.
- **Chat:** MMR retrieval over the selected sources → the model answers with `[n]` citations,
  streamed to the browser via Server-Sent Events. History is stored in `messages`.
- **AI through LangChain:** chat uses LangChain's `ChatOpenAI` class pointed at the provider's URL,
  which works with any OpenAI-compatible API (OpenAI, Anthropic, Gemini, Groq, OpenRouter, Mistral,
  Together, DeepSeek, xAI, Hugging Face, Ollama, LM Studio…). Embeddings use `OpenAIEmbeddings`
  (any OpenAI-compatible embeddings API) or `HuggingFaceInferenceEmbeddings` (when
  `EMBEDDING_PROVIDER` is `huggingface`). Every job can use a different provider and key.
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
- **Revision plans:** `exams` and `exam_plan_items` are personal. The days (today → the day
  before the exam, at most the last 90), phases and counts are computed in code: each topic gets a
  priority of 0.6 × weakness (1 − mastery; 0.7 if unpractised) + 0.4 × past-paper weight; the first
  ~65% of days cover every topic (read → quiz the next day → a 5/10-mark answer for weak or examined
  topics), the rest review the weakest topics and practise past-paper questions, ending with a mixed
  quiz; flashcards are scheduled daily from the due/new cards; at most 8 other tasks a day (with ≤ 2
  days left it's quizzes only). The model only orders the topics (prerequisites first) and writes a
  one-line tip for each. Re-planning moves missed tasks to the least busy remaining days.
- **Daily goal and streaks:** each study action increments `user_activity` (user, day in the
  user's timezone, kind). The streak counts consecutive days meeting the current goal
  (`users.daily_goal`) — today only once it's met, so an unfinished today doesn't break it.
- **Response language:** `users.preferences` (`{ language, bilingual }`) and per-user,
  per-course overrides in `course_preferences`. Every AI call passes the resolved language to
  `llm.js`, which appends one instruction (`withLanguage`) to the system prompt. Shared,
  course-level output (source guides, the course overview) uses the language of whoever added or
  refreshed it. Topic names and extracted past-paper questions stay in the language of the
  sources — they are matched against the material and copied verbatim.
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
| POST | `/api/notebooks/:id/sources/files` | Upload files — documents, images, audio, video (multipart `files`, optional `unitId`, `kind`, `examName`, `examYear`) |
| POST | `/api/notebooks/:id/sources/url` | Add links `{ urls: [], unitId?, kind?, examName?, examYear? }` |
| POST | `/api/notebooks/:id/sources/text` | Add pasted text `{ title?, text, unitId?, kind?, examName?, examYear? }` |
| GET/PATCH/DELETE | `/api/sources/:id` | Source details / rename, select, move `{ unitId }`, `{ kind: material\|past_paper, examName, examYear }` / delete |
| GET | `/api/notebooks/:id/members` | Members (with roles) and, for the owner, open invites |
| POST | `/api/notebooks/:id/invites` | Owner: invite `{ email, role: editor\|viewer }` → `{ member }` (existing account) or `{ invite, link, emailed }` |
| DELETE | `/api/notebooks/:id/invites/:inviteId` | Owner: cancel an invite |
| PATCH/DELETE | `/api/notebooks/:id/members/:userId` | Owner: change a role `{ role }` / remove; `DELETE …/members/me` leaves the course |
| GET | `/api/invites/:token` | What an invite link is for (course, inviter, role, whether your email matches) |
| POST | `/api/invites/:token/accept` | Join the course (only with the invited email) |
| GET/POST | `/api/notebooks/:id/battles` | Live + past battles / start one `{ unitIds?, count: 5\|10\|15, seconds: 10\|20\|30, difficulty? }` → `{ code }` |
| POST | `/api/battles/join` | Join a lobby `{ code }` |
| GET | `/api/battles/:code` | The battle as you see it (answers hidden while a question is open) |
| GET | `/api/battles/:code/events` | Server-Sent Events: that state after every change |
| POST | `/api/battles/:code/start` | Host: start |
| POST | `/api/battles/:code/answer` | `{ index, choice: 0-3 }` |
| POST | `/api/battles/:code/leave` | Leave the lobby (the host closes it) |
| GET | `/api/sources/:id/content` | Full source text + page/slide/timestamp `locations` `[{ label, start, end }]` |
| GET | `/api/sources/:id/original` | The uploaded image or recording (images, audio, video only; supports Range) |
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
| GET/POST | `/api/notebooks/:id/exams` | Your exams in a course / add one `{ name, examDate: "YYYY-MM-DD", unitIds? }` |
| GET/PATCH/DELETE | `/api/exams/:examId` | Exam with its plan (`items`, `today`, `missedCount`) / edit / delete |
| POST | `/api/exams/:examId/plan` | Generate or regenerate the plan (tasks already done are kept) |
| POST | `/api/exams/:examId/replan` | Move missed tasks onto the remaining days |
| PATCH | `/api/plan-items/:itemId` | Tick a task `{ done }` |
| GET | `/api/today` | Goal, today's count, streak, last 7 days, next exam with today's tasks, cards due across courses |
| GET/PATCH | `/api/settings` | Your settings `{ dailyGoal: 1-500, language: en\|hi\|bn\|mr\|ta\|te\|gu\|kn\|ml\|pa\|or\|ur, bilingual }` (GET also lists the languages) |
| GET/PATCH | `/api/notebooks/:id/preferences` | Your settings for a course `{ language: code \| null (= your default), bilingual }` + the effective language |
| GET/POST | `/api/notebooks/:id/explanations` | Your explanations / check one `{ topicId?, prompt?, explanation, unitIds? }` |
| GET/DELETE | `/api/explanations/:explanationId` | An explanation with its feedback / delete it |

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
npm run check-access                                 # prove shared-course access control (throwaway users)
npm run create-database -- you@gmail.com file.pdf    # ingest files into a new notebook for a user
npm run cli-chat -- <notebookId>                     # chat in the terminal
```

## License

[MIT](LICENSE) © 2026 Raghav Biyani
