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
