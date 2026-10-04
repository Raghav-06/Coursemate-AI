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
