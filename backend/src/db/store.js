import { query, withTransaction } from "./pool.js";

// Data access for CourseMate AI, backed by PostgreSQL via `pg`. Rows are mapped
// to the camelCase objects the API has always returned, so routes and the
// frontend don't care where data lives.
//
// Ownership: every notebook belongs to a user. Lookups that take an optional
// `userId` only return rows inside that user's notebooks; background jobs
// (ingestion, overviews) call them without one.

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);

// ---- Row mappers -------------------------------------------------------------

function toUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    googleId: r.google_id,
    email: r.email,
    emailVerified: r.email_verified,
    name: r.name,
    givenName: r.given_name,
    familyName: r.family_name,
    avatarUrl: r.avatar_url,
    locale: r.locale,
    hasPassword: Boolean(r.password_hash),
    hasGoogle: Boolean(r.google_id),
    createdAt: iso(r.created_at),
    lastLoginAt: iso(r.last_login_at),
  };
}

function toNotebook(r) {
  if (!r) return null;
  const nb = {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    titleIsAuto: r.title_is_auto,
    emoji: r.emoji,
    summary: r.summary,
    suggestedQuestions: r.suggested_questions ?? [],
    examType: r.exam_type ?? null,
    examSettings: r.exam_settings ?? {},
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
  if (r.source_count !== undefined) nb.sourceCount = Number(r.source_count);
  if (r.role !== undefined) {
    nb.role = r.role;
    nb.memberCount = Number(r.member_count ?? 1);
    if (r.owner_email !== undefined) nb.owner = { id: r.user_id, name: r.owner_name ?? null, email: r.owner_email ?? null };
  }
  return nb;
}

function toSource(r) {
  if (!r) return null;
  return {
    id: r.id,
    notebookId: r.notebook_id,
    unitId: r.unit_id ?? null,
    type: r.type,
    title: r.title,
    titleIsPlaceholder: r.title_is_placeholder,
    url: r.url ?? undefined,
    fileName: r.file_name ?? undefined,
    fileType: r.file_type ?? undefined,
    status: r.status,
    progress: r.progress,
    progressNote: r.progress_note ?? null,
    selected: r.selected,
    guide: r.guide,
    chunkCount: r.chunk_count,
    charCount: r.char_count ?? undefined,
    wordCount: r.word_count ?? undefined,
    error: r.error ?? undefined,
    embeddingModel: r.embedding_model ?? undefined,
    kind: r.kind ?? "material",
    examName: r.exam_name ?? null,
    examYear: r.exam_year ?? null,
    paperStatus: r.paper_status ?? null,
    paperError: r.paper_error ?? null,
    suggestedKind: r.suggested_kind ?? null,
    createdAt: iso(r.created_at),
  };
}

function toMessage(r) {
  return {
    id: r.id,
    role: r.role,
    content: r.content,
    ...(r.citations ? { citations: r.citations } : {}),
    createdAt: iso(r.created_at),
  };
}

// Builds "col1 = $1, col2 = $2" from a camelCase patch, keeping only known keys.
// JSONB columns get their values serialized (a bare JS string is not valid JSON).
function buildSet(patch, columns, jsonColumns = []) {
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(columns)) {
    if (!(key in patch) || patch[key] === undefined) continue;
    let value = patch[key];
    if (jsonColumns.includes(column)) value = value === null ? null : JSON.stringify(value);
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }
  return { sets, values };
}

async function touch(notebookId, client = { query }) {
  await client.query("UPDATE notebooks SET updated_at = NOW() WHERE id = $1", [notebookId]);
}

// ---- Users -------------------------------------------------------------------

const PROFILE_FIELDS = ["name", "given_name", "family_name", "avatar_url", "locale"];

/**
 * Signs in a Google user. Matches on Google id first; otherwise links to an
 * existing account with the same (Google-verified) email, e.g. one created
 * with email + password; otherwise creates a new user.
 */
export async function upsertGoogleUser(profile) {
  const values = {
    name: profile.name ?? null,
    given_name: profile.givenName ?? null,
    family_name: profile.familyName ?? null,
    avatar_url: profile.avatarUrl ?? null,
    locale: profile.locale ?? null,
  };
  return withTransaction(async (client) => {
    let { rows } = await client.query("SELECT * FROM users WHERE google_id = $1", [profile.googleId]);
    let existing = rows[0];

    if (!existing) {
      ({ rows } = await client.query("SELECT * FROM users WHERE LOWER(email) = LOWER($1) FOR UPDATE", [profile.email]));
      existing = rows[0];
      if (existing && !profile.emailVerified) {
        throw Object.assign(new Error("This email already has an account. Sign in with your password instead."), {
          status: 409,
          expose: true,
        });
      }
    }

    if (existing) {
      // Keep a name the user already has if Google doesn't provide one.
      const params = [profile.googleId, profile.email, Boolean(profile.emailVerified) || existing.email_verified];
      const sets = ["google_id = $1", "email = $2", "email_verified = $3"];
      for (const field of PROFILE_FIELDS) {
        params.push(values[field]);
        sets.push(`${field} = COALESCE($${params.length}, ${field})`);
      }
      params.push(existing.id);
      ({ rows } = await client.query(
        `UPDATE users SET ${sets.join(", ")}, updated_at = NOW(), last_login_at = NOW() WHERE id = $${params.length} RETURNING *`,
        params
      ));
      return toUser(rows[0]);
    }

    ({ rows } = await client.query(
      `INSERT INTO users (google_id, email, email_verified, name, given_name, family_name, avatar_url, locale)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [profile.googleId, profile.email, Boolean(profile.emailVerified), values.name, values.given_name, values.family_name, values.avatar_url, values.locale]
    ));
    return toUser(rows[0]);
  });
}

export async function getUser(id) {
  const { rows } = await query("SELECT * FROM users WHERE id = $1", [id]);
  return toUser(rows[0]);
}

export async function getUserByEmail(email) {
  const { rows } = await query("SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1", [email]);
  return toUser(rows[0]);
}

/** The user plus their password hash, for checking a sign-in. */
export async function getUserCredentials(email) {
  const { rows } = await query("SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1", [email]);
  return rows[0] ? { user: toUser(rows[0]), passwordHash: rows[0].password_hash } : null;
}

/**
 * Sets the password for a verified email: creates the account if it doesn't
 * exist, or adds/replaces the password on an existing one (e.g. a Google user).
 */
export async function setPasswordForEmail(email, passwordHash, { name } = {}) {
  const cleanName = name?.trim() || null;
  const { rows } = await query(
    `INSERT INTO users (email, email_verified, password_hash, password_updated_at, name, given_name)
     VALUES ($1, TRUE, $2, NOW(), $3, $4)
     ON CONFLICT ((LOWER(email))) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       password_updated_at = NOW(),
       email_verified = TRUE,
       name = COALESCE(users.name, EXCLUDED.name),
       given_name = COALESCE(users.given_name, EXCLUDED.given_name),
       updated_at = NOW(),
       last_login_at = NOW()
     RETURNING *`,
    [email.trim().toLowerCase(), passwordHash, cleanName, cleanName?.split(/\s+/)[0] ?? null]
  );
  return toUser(rows[0]);
}

export async function touchLogin(userId) {
  await query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [userId]);
}

// Signs a user out of every browser by dropping their stored sessions.
export async function deleteUserSessions(userId) {
  await query("DELETE FROM user_sessions WHERE sess->'passport'->>'user' = $1", [userId]);
}

// ---- Email verification codes ---------------------------------------------------

export async function createEmailVerification({ email, purpose, codeHash, ttlMinutes }) {
  const { rows } = await query(
    `INSERT INTO email_verifications (email, purpose, code_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(mins => $4)) RETURNING id, created_at`,
    [email.trim().toLowerCase(), purpose, codeHash, ttlMinutes]
  );
  return rows[0];
}

/** Most recent unused code for this email + purpose. */
export async function latestEmailVerification(email, purpose) {
  const { rows } = await query(
    `SELECT *, expires_at < NOW() AS expired, EXTRACT(EPOCH FROM (NOW() - created_at)) AS age_seconds
       FROM email_verifications
      WHERE LOWER(email) = LOWER($1) AND purpose = $2 AND consumed_at IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [email, purpose]
  );
  return rows[0] ?? null;
}

export async function recordVerificationAttempt(id) {
  const { rows } = await query("UPDATE email_verifications SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts", [id]);
  return rows[0]?.attempts ?? 0;
}

export async function markEmailVerified(id) {
  await query("UPDATE email_verifications SET verified_at = NOW() WHERE id = $1", [id]);
}

/** Marks a verified code as used; returns false if it was already used or isn't verified. */
export async function consumeEmailVerification(id) {
  const { rowCount } = await query(
    "UPDATE email_verifications SET consumed_at = NOW() WHERE id = $1 AND verified_at IS NOT NULL AND consumed_at IS NULL",
    [id]
  );
  return rowCount === 1;
}

/** Retires every outstanding code for an email + purpose (after a new one is issued or used). */
export async function retireEmailVerifications(email, purpose, exceptId = null) {
  await query(
    `UPDATE email_verifications SET consumed_at = NOW()
      WHERE LOWER(email) = LOWER($1) AND purpose = $2 AND consumed_at IS NULL AND ($3::uuid IS NULL OR id <> $3)`,
    [email, purpose, exceptId]
  );
}

// ---- Notebooks -------------------------------------------------------------

// With a user: their role, the owner's name and the member count, for shared courses.
const NOTEBOOK_SHARING = `m.role, (SELECT COUNT(*) FROM notebook_members c WHERE c.notebook_id = n.id) AS member_count,
  o.name AS owner_name, o.email AS owner_email`;

/** Courses the user is a member of (owned and shared with them). */
export async function listNotebooks(userId) {
  const { rows } = await query(
    `SELECT n.*, (SELECT COUNT(*) FROM sources s WHERE s.notebook_id = n.id) AS source_count, ${NOTEBOOK_SHARING}
       FROM notebooks n
       JOIN notebook_members m ON m.notebook_id = n.id AND m.user_id = $1
       LEFT JOIN users o ON o.id = n.user_id
      ORDER BY n.updated_at DESC`,
    [userId]
  );
  return rows.map(toNotebook);
}

/** A course; with `userId`, only if they are a member (then with their `role`). */
export async function getNotebook(id, userId) {
  const { rows } = await query(
    userId
      ? `SELECT n.*, ${NOTEBOOK_SHARING} FROM notebooks n
           JOIN notebook_members m ON m.notebook_id = n.id AND m.user_id = $2
           LEFT JOIN users o ON o.id = n.user_id
          WHERE n.id = $1`
      : "SELECT * FROM notebooks WHERE id = $1",
    userId ? [id, userId] : [id]
  );
  return toNotebook(rows[0]);
}

/** Creates a course with its creator as owner. */
export async function addNotebook(notebook) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO notebooks (user_id, title, title_is_auto, emoji, summary, suggested_questions)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        notebook.userId,
        notebook.title ?? "Untitled course",
        notebook.titleIsAuto ?? true,
        notebook.emoji ?? "📓",
        notebook.summary ?? null,
        JSON.stringify(notebook.suggestedQuestions ?? []),
      ]
    );
    await client.query("INSERT INTO notebook_members (notebook_id, user_id, role) VALUES ($1, $2, 'owner')", [rows[0].id, notebook.userId]);
    return toNotebook({ ...rows[0], role: "owner", member_count: 1 });
  });
}

const NOTEBOOK_COLUMNS = {
  title: "title",
  titleIsAuto: "title_is_auto",
  emoji: "emoji",
  summary: "summary",
  suggestedQuestions: "suggested_questions",
  examType: "exam_type",
  examSettings: "exam_settings",
};

export async function updateNotebook(id, patch) {
  const { sets, values } = buildSet(patch, NOTEBOOK_COLUMNS, ["suggested_questions", "exam_settings"]);
  values.push(id);
  const { rows } = await query(
    `UPDATE notebooks SET ${[...sets, "updated_at = NOW()"].join(", ")} WHERE id = $${values.length} RETURNING *`,
    values
  );
  return toNotebook(rows[0]);
}

// Chunks and messages go with it (ON DELETE CASCADE). Returns the
// removed sources so callers can drop caches and stored files.
export async function deleteNotebook(id) {
  return withTransaction(async (client) => {
    const { rows } = await client.query("SELECT id, notebook_id, type, file_type FROM sources WHERE notebook_id = $1", [id]);
    await client.query("DELETE FROM notebooks WHERE id = $1", [id]);
    return rows.map((r) => ({ id: r.id, notebookId: r.notebook_id, type: r.type, fileType: r.file_type }));
  });
}

// ---- Sources ---------------------------------------------------------------

// Everything except the (potentially huge) full text.
const SOURCE_FIELDS = `id, notebook_id, unit_id, type, title, title_is_placeholder, url, file_name, file_type, status,
  progress, progress_note, selected, guide, chunk_count, char_count, word_count, error, embedding_model, created_at,
  kind, exam_name, exam_year, paper_status, paper_error, suggested_kind`;

const PREFIXED_SOURCE_FIELDS = SOURCE_FIELDS.replace(/(\w+)/g, "s.$1");
// A member's own chat selection (sources are on unless they switched them off).
const SELECTED_FOR = (userParam) =>
  `NOT EXISTS (SELECT 1 FROM source_deselections d WHERE d.source_id = s.id AND d.user_id = ${userParam}) AS selected`;

/** A course's sources; with `userId`, `selected` is that member's own selection. */
export async function listSources(notebookId, userId) {
  const { rows } = await query(
    `SELECT ${PREFIXED_SOURCE_FIELDS}${userId ? `, ${SELECTED_FOR("$2")}` : ""}
       FROM sources s WHERE s.notebook_id = $1 ORDER BY s.created_at ASC`,
    userId ? [notebookId, userId] : [notebookId]
  );
  return rows.map(toSource);
}

/** A source; with `userId`, only if they are a member of its course (then with their `role`). */
export async function getSource(id, userId) {
  const { rows } = await query(
    userId
      ? `SELECT ${PREFIXED_SOURCE_FIELDS}, m.role AS member_role, ${SELECTED_FOR("$2")} FROM sources s
           JOIN notebook_members m ON m.notebook_id = s.notebook_id AND m.user_id = $2
          WHERE s.id = $1`
      : `SELECT ${SOURCE_FIELDS} FROM sources WHERE id = $1`,
    userId ? [id, userId] : [id]
  );
  const source = toSource(rows[0]);
  if (source && rows[0].member_role) source.role = rows[0].member_role;
  return source;
}

/** Switches sources on or off for one member's chat. */
export async function setSourcesSelected(userId, sourceIds, selected) {
  if (sourceIds.length === 0) return;
  await query(
    selected
      ? "DELETE FROM source_deselections WHERE user_id = $1 AND source_id = ANY($2::uuid[])"
      : "INSERT INTO source_deselections (user_id, source_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING",
    [userId, sourceIds]
  );
}

export async function countSources(notebookId) {
  const { rows } = await query("SELECT COUNT(*)::int AS count FROM sources WHERE notebook_id = $1", [notebookId]);
  return rows[0].count;
}

export async function addSource(source) {
  const { rows } = await query(
    `INSERT INTO sources (id, notebook_id, type, title, title_is_placeholder, url, file_name, file_type, status, progress, selected, unit_id,
                          kind, exam_name, exam_year, paper_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING ${SOURCE_FIELDS}`,
    [
      source.id,
      source.notebookId,
      source.type,
      source.title,
      Boolean(source.titleIsPlaceholder),
      source.url ?? null,
      source.fileName ?? null,
      source.fileType ?? null,
      source.status ?? "processing",
      source.progress ?? 0,
      source.selected ?? true,
      source.unitId ?? null,
      source.kind ?? "material",
      source.examName ?? null,
      source.examYear ?? null,
      source.kind === "past_paper" ? "pending" : null,
    ]
  );
  await touch(source.notebookId);
  return toSource(rows[0]);
}

const SOURCE_COLUMNS = {
  unitId: "unit_id",
  title: "title",
  titleIsPlaceholder: "title_is_placeholder",
  status: "status",
  progress: "progress",
  progressNote: "progress_note",
  guide: "guide",
  chunkCount: "chunk_count",
  charCount: "char_count",
  wordCount: "word_count",
  error: "error",
  embeddingModel: "embedding_model",
  kind: "kind",
  examName: "exam_name",
  examYear: "exam_year",
  paperStatus: "paper_status",
  paperError: "paper_error",
  suggestedKind: "suggested_kind",
};

export async function updateSource(id, patch) {
  const { sets, values } = buildSet(patch, SOURCE_COLUMNS, ["guide"]);
  if (sets.length === 0) return getSource(id);
  values.push(id);
  const { rows } = await query(
    `UPDATE sources SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING ${SOURCE_FIELDS}`,
    values
  );
  return toSource(rows[0]);
}

/**
 * Sources left "processing" when the server stopped mid-run never finish; on
 * startup they become errors so they can be re-processed. Returns how many.
 */
export async function failInterruptedSources() {
  const { rowCount } = await query(
    "UPDATE sources SET status = 'error', progress = 100, progress_note = NULL, error = 'Processing was interrupted because the server stopped. Re-process this source to try again.' WHERE status = 'processing'"
  );
  return rowCount;
}

/** Marks a source as processing unless it already is; false if it was (so only one run starts). */
export async function claimSourceForProcessing(id) {
  const { rowCount } = await query(
    "UPDATE sources SET status = 'processing', progress = 0, progress_note = NULL, error = NULL WHERE id = $1 AND status <> 'processing'",
    [id]
  );
  return rowCount === 1;
}

export async function deleteSource(id) {
  const { rows } = await query(`DELETE FROM sources WHERE id = $1 RETURNING ${SOURCE_FIELDS}`, [id]);
  const source = toSource(rows[0]);
  if (source) await touch(source.notebookId);
  return source;
}

// Full extracted text of a source, with its page/slide locations (or null).
export async function setSourceContent(id, text, locations = null) {
  await query("UPDATE sources SET content = $1, locations = $2 WHERE id = $3", [text, locations ? JSON.stringify(locations) : null, id]);
}

export async function getSourceLocations(id) {
  const { rows } = await query("SELECT locations FROM sources WHERE id = $1", [id]);
  return rows[0]?.locations ?? null;
}

export async function getSourceContent(id) {
  const { rows } = await query("SELECT content FROM sources WHERE id = $1", [id]);
  return rows[0]?.content ?? "";
}

// ---- Units -------------------------------------------------------------------

function toUnit(r) {
  if (!r) return null;
  return { id: r.id, notebookId: r.notebook_id, title: r.title, position: r.position, createdAt: iso(r.created_at) };
}

export async function listUnits(notebookId) {
  const { rows } = await query("SELECT * FROM units WHERE notebook_id = $1 ORDER BY position, created_at", [notebookId]);
  return rows.map(toUnit);
}

/** A unit inside the given notebook (null otherwise). */
export async function getUnit(id, notebookId) {
  const { rows } = await query("SELECT * FROM units WHERE id = $1 AND notebook_id = $2", [id, notebookId]);
  return toUnit(rows[0]);
}

export async function countUnits(notebookId) {
  const { rows } = await query("SELECT COUNT(*)::int AS count FROM units WHERE notebook_id = $1", [notebookId]);
  return rows[0].count;
}

// New units go last.
export async function addUnit(notebookId, title) {
  const { rows } = await query(
    `INSERT INTO units (notebook_id, title, position)
     VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM units WHERE notebook_id = $1), 0)) RETURNING *`,
    [notebookId, title]
  );
  await touch(notebookId);
  return toUnit(rows[0]);
}

export async function renameUnit(id, title) {
  const { rows } = await query("UPDATE units SET title = $1 WHERE id = $2 RETURNING *", [title, id]);
  return toUnit(rows[0]);
}

/** Sets positions from an ordered list of unit ids; ids not listed keep their relative order after them. */
export async function reorderUnits(notebookId, orderedIds) {
  await withTransaction(async (client) => {
    const { rows } = await client.query("SELECT id FROM units WHERE notebook_id = $1 ORDER BY position, created_at", [notebookId]);
    const known = rows.map((r) => r.id);
    const order = [...orderedIds.filter((id) => known.includes(id)), ...known.filter((id) => !orderedIds.includes(id))];
    for (const [position, id] of order.entries()) {
      await client.query("UPDATE units SET position = $1 WHERE id = $2", [position, id]);
    }
  });
  return listUnits(notebookId);
}

// Its sources move to "General" (ON DELETE SET NULL).
export async function deleteUnit(id) {
  const { rows } = await query("DELETE FROM units WHERE id = $1 RETURNING *", [id]);
  if (rows[0]) await touch(rows[0].notebook_id);
  return toUnit(rows[0]);
}

// ---- Chunks (vector store) ---------------------------------------------------

const CHUNK_BATCH = 100;

/** Replaces a source's chunks. Each record: { pageContent, metadata, embedding }. */
export async function replaceChunks(sourceId, records) {
  await withTransaction(async (client) => {
    await client.query("DELETE FROM chunks WHERE source_id = $1", [sourceId]);
    for (let i = 0; i < records.length; i += CHUNK_BATCH) {
      const batch = records.slice(i, i + CHUNK_BATCH);
      const values = [];
      const tuples = batch.map((r) => {
        values.push(sourceId, r.metadata.chunk, r.pageContent, r.metadata.start, r.metadata.end, r.metadata.location ?? null, r.embedding);
        const n = values.length;
        return `($${n - 6}, $${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
      });
      await client.query(
        `INSERT INTO chunks (source_id, chunk_index, content, start_offset, end_offset, location, embedding) VALUES ${tuples.join(", ")}`,
        values
      );
    }
  });
}

export async function loadChunks(sourceId) {
  const { rows } = await query(
    `SELECT c.chunk_index, c.content, c.start_offset, c.end_offset, c.location, c.embedding, s.title
       FROM chunks c JOIN sources s ON s.id = c.source_id
      WHERE c.source_id = $1
      ORDER BY c.chunk_index`,
    [sourceId]
  );
  return rows.map((r) => ({
    pageContent: r.content,
    metadata: { sourceId, source: r.title, chunk: r.chunk_index, start: r.start_offset, end: r.end_offset, location: r.location },
    embedding: r.embedding,
  }));
}

// ---- Messages --------------------------------------------------------------

// Chat history is personal: each member sees only their own messages.
export async function listMessages(notebookId, userId) {
  const { rows } = await query("SELECT * FROM messages WHERE notebook_id = $1 AND user_id = $2 ORDER BY created_at ASC", [notebookId, userId]);
  return rows.map(toMessage);
}

export async function addMessage(notebookId, userId, message) {
  const { rows } = await query(
    `INSERT INTO messages (notebook_id, user_id, role, content, citations) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [notebookId, userId, message.role, message.content, message.citations ? JSON.stringify(message.citations) : null]
  );
  await touch(notebookId);
  return toMessage(rows[0]);
}

export async function clearMessages(notebookId, userId) {
  await query("DELETE FROM messages WHERE notebook_id = $1 AND user_id = $2", [notebookId, userId]);
}


/** Chunk texts (no vectors) of some sources, in reading order — for building study prompts. */
export async function listChunkTexts(sourceIds) {
  if (sourceIds.length === 0) return [];
  const { rows } = await query(
    `SELECT source_id, chunk_index, content, start_offset, end_offset, location
       FROM chunks WHERE source_id = ANY($1::uuid[]) ORDER BY source_id, chunk_index`,
    [sourceIds]
  );
  return rows.map((r) => ({
    sourceId: r.source_id,
    chunk: r.chunk_index,
    text: r.content,
    start: r.start_offset,
    end: r.end_offset,
    location: r.location,
  }));
}
