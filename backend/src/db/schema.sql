-- CourseMate AI schema. Idempotent: safe to run on every start
-- (`npm run db:migrate` runs it by hand). gen_random_uuid() is built into
-- PostgreSQL 13+.

-- Users. They sign in with Google (google_id) and/or with email + password
-- (password_hash, set after the email address is verified). One row per email.
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id       TEXT UNIQUE,
  email           TEXT NOT NULL,
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  name            TEXT,
  given_name      TEXT,
  family_name     TEXT,
  avatar_url      TEXT,
  locale          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrades for databases created before email/password sign-in existed.
ALTER TABLE users ALTER COLUMN google_id DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_updated_at TIMESTAMPTZ;
DROP INDEX IF EXISTS users_email_idx;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (LOWER(email));

-- One-time 6-digit codes emailed to prove someone owns an address, used to
-- create a password account ("signup") or reset a forgotten password ("reset").
-- Only a keyed hash of the code is stored.
CREATE TABLE IF NOT EXISTS email_verifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  purpose      TEXT NOT NULL,                 -- signup | reset
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  verified_at  TIMESTAMPTZ,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS email_verifications_email_idx ON email_verifications (LOWER(email), purpose, created_at DESC);

-- A notebook belongs to one user and groups sources and a chat.
CREATE TABLE IF NOT EXISTS notebooks (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                TEXT NOT NULL DEFAULT 'Untitled notebook',
  title_is_auto        BOOLEAN NOT NULL DEFAULT TRUE,
  emoji                TEXT NOT NULL DEFAULT '📓',
  summary              TEXT,
  suggested_questions  JSONB NOT NULL DEFAULT '[]',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notebooks_user_idx ON notebooks (user_id, updated_at DESC);

-- Uploaded files, links and pasted text. `content` holds the full extracted text.
CREATE TABLE IF NOT EXISTS sources (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id           UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  type                  TEXT NOT NULL,             -- file | url | text | note
  title                 TEXT NOT NULL,
  title_is_placeholder  BOOLEAN NOT NULL DEFAULT FALSE,
  url                   TEXT,
  file_name             TEXT,
  file_type             TEXT,
  status                TEXT NOT NULL DEFAULT 'processing',  -- processing | ready | error
  progress              INTEGER NOT NULL DEFAULT 0,
  selected              BOOLEAN NOT NULL DEFAULT TRUE,
  guide                 JSONB,
  chunk_count           INTEGER,
  char_count            INTEGER,
  word_count            INTEGER,
  error                 TEXT,
  content               TEXT,
  embedding_model       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sources_notebook_idx ON sources (notebook_id, created_at);

-- Units (chapters / modules) group a course's sources. A source without a
-- unit belongs to "General".
CREATE TABLE IF NOT EXISTS units (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id  UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS units_notebook_idx ON units (notebook_id, position);
ALTER TABLE sources ADD COLUMN IF NOT EXISTS unit_id UUID REFERENCES units(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sources_unit_idx ON sources (unit_id);

-- Chunks of each source with their embedding vectors, used for retrieval.
CREATE TABLE IF NOT EXISTS chunks (
  id            BIGSERIAL PRIMARY KEY,
  source_id     UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  content       TEXT NOT NULL,
  start_offset  INTEGER,
  end_offset    INTEGER,
  embedding     REAL[] NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_source_idx ON chunks (source_id, chunk_index);

-- Where each page / slide sits in sources.content: [{ "label": "p. 12", "start": 0, "end": 1834 }].
-- NULL for sources without pages (or added before locations existed; "Re-process" fills it).
ALTER TABLE sources ADD COLUMN IF NOT EXISTS locations JSONB;
-- The page(s) / slide(s) a chunk spans, e.g. "p. 12", "pp. 12–13", "Slide 4".
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS location TEXT;

-- Chat history, one thread per notebook.
CREATE TABLE IF NOT EXISTS messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id  UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,           -- user | assistant
  content      TEXT NOT NULL,
  citations    JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_notebook_idx ON messages (notebook_id, created_at);

-- Login sessions (express-session + connect-pg-simple).
CREATE TABLE IF NOT EXISTS user_sessions (
  sid     VARCHAR NOT NULL PRIMARY KEY,
  sess    JSON NOT NULL,
  expire  TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON user_sessions (expire);

-- ---- Study: flashcard decks with spaced repetition ---------------------------

-- A deck belongs to a course, optionally to one unit.
CREATE TABLE IF NOT EXISTS decks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id  UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  unit_id      UUID REFERENCES units(id) ON DELETE SET NULL,
  title        TEXT NOT NULL,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS decks_notebook_idx ON decks (notebook_id, created_at);

-- Cards cite the source passage they were made from (source + page/slide + quote).
CREATE TABLE IF NOT EXISTS cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id     UUID NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  front       TEXT NOT NULL,
  back        TEXT NOT NULL,
  topic       TEXT,
  source_id   UUID REFERENCES sources(id) ON DELETE SET NULL,
  location    TEXT,
  quote       TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cards_deck_idx ON cards (deck_id, position);

-- Each user's SM-2 state per card (a card with no row is "new" for that user).
CREATE TABLE IF NOT EXISTS card_reviews (
  card_id           UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ease              REAL NOT NULL DEFAULT 2.5,
  interval_days     REAL NOT NULL DEFAULT 0,
  repetitions       INTEGER NOT NULL DEFAULT 0,
  due_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_reviewed_at  TIMESTAMPTZ,
  lapses            INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (card_id, user_id)
);
CREATE INDEX IF NOT EXISTS card_reviews_user_due_idx ON card_reviews (user_id, due_at);

-- Every rating given, for the new-cards-per-day cap and daily activity.
CREATE TABLE IF NOT EXISTS review_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_id      UUID REFERENCES cards(id) ON DELETE SET NULL,
  notebook_id  UUID REFERENCES notebooks(id) ON DELETE CASCADE,
  rating       TEXT NOT NULL,           -- again | hard | good | easy
  was_new      BOOLEAN NOT NULL DEFAULT FALSE,
  reviewed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS review_log_user_idx ON review_log (user_id, reviewed_at);

-- ---- Practice: topics, quizzes, written answers, mastery -------------------

-- Topics of each unit (unit_id NULL = the course's "General" sources),
-- extracted by the model from that unit's sources.
CREATE TABLE IF NOT EXISTS topics (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id  UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  unit_id      UUID REFERENCES units(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS topics_notebook_idx ON topics (notebook_id, unit_id, position);
-- The course topic a flashcard is about (its free-text `topic` stays as written).
ALTER TABLE cards ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES topics(id) ON DELETE SET NULL;

-- When each unit's topics were last extracted, and from which sources
-- (signature), so they refresh when the unit's sources change.
CREATE TABLE IF NOT EXISTS topic_sets (
  notebook_id  UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  unit_key     TEXT NOT NULL,                  -- unit id, or 'general'
  signature    TEXT,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | ready | error
  error        TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notebook_id, unit_key)
);

-- Multiple-choice quizzes are personal (made by and for one user).
CREATE TABLE IF NOT EXISTS quizzes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id  UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  difficulty   TEXT NOT NULL,
  unit_ids     JSONB NOT NULL DEFAULT '[]',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS quizzes_user_idx ON quizzes (notebook_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id       UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  question      TEXT NOT NULL,
  options       JSONB NOT NULL,                -- exactly 4 strings
  answer_index  INTEGER NOT NULL,
  explanation   TEXT,
  topic_id      UUID REFERENCES topics(id) ON DELETE SET NULL,
  topic         TEXT,
  source_id     UUID REFERENCES sources(id) ON DELETE SET NULL,
  location      TEXT,
  quote         TEXT
);
CREATE INDEX IF NOT EXISTS quiz_questions_quiz_idx ON quiz_questions (quiz_id, position);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id      UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at  TIMESTAMPTZ,
  score        INTEGER,
  total        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS quiz_attempts_quiz_idx ON quiz_attempts (quiz_id, user_id, started_at DESC);

CREATE TABLE IF NOT EXISTS quiz_answers (
  attempt_id    UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
  question_id   UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  chosen_index  INTEGER NOT NULL,
  correct       BOOLEAN NOT NULL,
  time_ms       INTEGER,
  answered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (attempt_id, question_id)
);

-- Written answers graded by the model (personal).
CREATE TABLE IF NOT EXISTS answer_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id  UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question     TEXT NOT NULL,
  marks        INTEGER NOT NULL,
  answer       TEXT NOT NULL,
  score        REAL NOT NULL,
  feedback     JSONB NOT NULL,          -- { correctPoints, missingPoints, mistakes, modelAnswer }
  citations    JSONB NOT NULL DEFAULT '[]',
  topic_id     UUID REFERENCES topics(id) ON DELETE SET NULL,
  unit_ids     JSONB NOT NULL DEFAULT '[]',
  origin       TEXT NOT NULL DEFAULT 'typed', -- typed | generated | past_paper
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS answer_attempts_user_idx ON answer_attempts (notebook_id, user_id, created_at DESC);

-- Evidence of how well a user knows a topic (quiz answers, graded answers,
-- flashcard ratings…): score 0-1 with a weight. Mastery = weighted recent accuracy.
CREATE TABLE IF NOT EXISTS topic_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id    UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,          -- quiz | answer | flashcard
  score       REAL NOT NULL,
  weight      REAL NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS topic_events_user_idx ON topic_events (user_id, topic_id, created_at DESC);

-- ---- Past papers ------------------------------------------------------------------

-- A source is course material (default) or a past exam paper. Past papers
-- are left out of chat (unless asked for), quizzes, flashcards and topics;
-- their questions are extracted and mapped to the course's units and topics.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'material';  -- material | past_paper
ALTER TABLE sources ADD COLUMN IF NOT EXISTS exam_name TEXT;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS exam_year INTEGER;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS paper_status TEXT;   -- NULL | pending | ready | error
ALTER TABLE sources ADD COLUMN IF NOT EXISTS paper_error TEXT;

CREATE TABLE IF NOT EXISTS past_paper_questions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id  UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  source_id    UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL DEFAULT 0,
  number       TEXT,                     -- as printed: "3", "2(b)", "Q4"
  text         TEXT NOT NULL,
  marks        REAL,
  year         INTEGER,
  section      TEXT,
  unit_id      UUID REFERENCES units(id) ON DELETE SET NULL,
  topic_id     UUID REFERENCES topics(id) ON DELETE SET NULL,
  similarity   REAL,                     -- best match against the course material (0-1)
  citations    JSONB NOT NULL DEFAULT '[]',  -- where the answer is in the course material
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS past_paper_questions_notebook_idx ON past_paper_questions (notebook_id, source_id, position);
CREATE INDEX IF NOT EXISTS past_paper_questions_topic_idx ON past_paper_questions (topic_id);

-- ---- Exams, revision plans, daily goal and streaks ------------------------------

-- An exam a user is preparing for (personal): course, name, date and the
-- units it covers ([] = the whole course).
CREATE TABLE IF NOT EXISTS exams (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id        UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  exam_date          DATE NOT NULL,
  unit_ids           JSONB NOT NULL DEFAULT '[]',
  plan_generated_at  TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS exams_user_idx ON exams (user_id, exam_date);
CREATE INDEX IF NOT EXISTS exams_notebook_idx ON exams (notebook_id, user_id);

-- One task of a day-by-day revision plan.
CREATE TABLE IF NOT EXISTS exam_plan_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id       UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  plan_date     DATE NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  task_type     TEXT NOT NULL,           -- read | flashcards | quiz | answer | past_paper
  unit_id       UUID REFERENCES units(id) ON DELETE SET NULL,
  topic_id      UUID REFERENCES topics(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  details       TEXT,
  target_count  INTEGER,                 -- cards / questions / marks, when it has one
  done          BOOLEAN NOT NULL DEFAULT FALSE,
  done_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS exam_plan_items_exam_idx ON exam_plan_items (exam_id, plan_date, position);

-- Study actions per user per day (in their timezone): cards reviewed, quiz
-- answers, graded answers, chats… Feeds the daily goal and streaks.
CREATE TABLE IF NOT EXISTS user_activity (
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day      DATE NOT NULL,
  kind     TEXT NOT NULL,                -- card | quiz | answer | chat | explain
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, kind)
);

-- Study actions per day that count as meeting the goal.
ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_goal INTEGER NOT NULL DEFAULT 20;

-- ---- Explain-it-back and response language -------------------------------------------

-- A student's own explanation of a topic, compared with the sources by the
-- model (personal).
CREATE TABLE IF NOT EXISTS explanations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id   UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id      UUID REFERENCES topics(id) ON DELETE SET NULL,
  prompt        TEXT NOT NULL,                 -- the topic or question explained
  explanation   TEXT NOT NULL,
  clarity       INTEGER NOT NULL,              -- 0-10
  accuracy      INTEGER NOT NULL,              -- 0-10, how well it matches the sources
  feedback      JSONB NOT NULL,                -- { correctPoints, gaps, misconceptions, followUp, summary }
  citations     JSONB NOT NULL DEFAULT '[]',
  unit_ids      JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS explanations_user_idx ON explanations (notebook_id, user_id, created_at DESC);

-- Per-user settings, e.g. { "language": "hi", "bilingual": true }.
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}';

-- A user's settings for one course (e.g. its response language), overriding theirs.
CREATE TABLE IF NOT EXISTS course_preferences (
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notebook_id  UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  preferences  JSONB NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, notebook_id)
);

-- What a slow ingestion step is doing, shown under the progress bar
-- (e.g. "Transcribing part 2 of 5…"). Cleared when processing ends.
ALTER TABLE sources ADD COLUMN IF NOT EXISTS progress_note TEXT;

-- ---- Shared courses ---------------------------------------------------------
-- Who may open a course and what they may do: owner (members, delete),
-- editor (sources, units, decks), viewer (read, chat, personal practice).
-- notebooks.user_id stays the owner.
CREATE TABLE IF NOT EXISTS notebook_members (
  notebook_id  UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notebook_id, user_id)
);
CREATE INDEX IF NOT EXISTS notebook_members_user_idx ON notebook_members (user_id);
-- Existing courses: their creator becomes the owner (no-op once done).
INSERT INTO notebook_members (notebook_id, user_id, role)
  SELECT id, user_id, 'owner' FROM notebooks
  ON CONFLICT (notebook_id, user_id) DO NOTHING;

-- Invites for emails without an account yet; applied when that email signs up
-- or signs in (or opens the link). Only a hash of the token is stored.
CREATE TABLE IF NOT EXISTS notebook_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id  UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  token_hash   TEXT NOT NULL UNIQUE,
  invited_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  accepted_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS notebook_invites_open_idx ON notebook_invites (notebook_id, LOWER(email)) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS notebook_invites_email_idx ON notebook_invites (LOWER(email)) WHERE accepted_at IS NULL;

-- Chat history is personal: each message belongs to the member who chatted.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
UPDATE messages m SET user_id = n.user_id FROM notebooks n WHERE m.user_id IS NULL AND n.id = m.notebook_id;
CREATE INDEX IF NOT EXISTS messages_user_idx ON messages (notebook_id, user_id, created_at);

-- Which sources each member has switched off for chat (personal; default on).
CREATE TABLE IF NOT EXISTS source_deselections (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id  UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, source_id)
);
-- Sources switched off before selection became personal: keep them off for
-- the owner, then retire the shared flag (no-op once done).
INSERT INTO source_deselections (user_id, source_id)
  SELECT n.user_id, s.id FROM sources s JOIN notebooks n ON n.id = s.notebook_id WHERE s.selected = FALSE
  ON CONFLICT DO NOTHING;
UPDATE sources SET selected = TRUE WHERE selected = FALSE;

-- ---- Quiz battles -------------------------------------------------------------
-- Live games run in server memory; finished ones are saved here.
CREATE TABLE IF NOT EXISTS battles (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id        UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  host_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  code               TEXT NOT NULL,
  unit_ids           JSONB NOT NULL DEFAULT '[]',
  seconds_per_question INTEGER NOT NULL,
  questions          JSONB NOT NULL,            -- [{ question, options, answer, explanation, topic, citation }]
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS battles_notebook_idx ON battles (notebook_id, finished_at DESC);

CREATE TABLE IF NOT EXISTS battle_players (
  battle_id  UUID NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  score      INTEGER NOT NULL,
  correct    INTEGER NOT NULL,
  rank       INTEGER NOT NULL,
  PRIMARY KEY (battle_id, user_id)
);
CREATE INDEX IF NOT EXISTS battle_players_user_idx ON battle_players (user_id);

-- ---- AI calls -------------------------------------------------------------------
-- One row per model call (never the prompt): which tier (nano | super | ultra |
-- default | vision | transcribe) and model did which task, latency and outcome.
CREATE TABLE IF NOT EXISTS ai_calls (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  notebook_id  UUID REFERENCES notebooks(id) ON DELETE SET NULL,
  tier         TEXT NOT NULL,
  model        TEXT,
  task         TEXT NOT NULL,
  latency_ms   INTEGER NOT NULL,
  ok           BOOLEAN NOT NULL,
  error_code   TEXT,                       -- e.g. 429, timeout, invalid_json, missing_key
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_calls_user_idx ON ai_calls (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_calls_notebook_idx ON ai_calls (notebook_id, created_at DESC);
