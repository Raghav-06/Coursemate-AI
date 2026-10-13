import crypto from "node:crypto";
import { query, withTransaction } from "./pool.js";

// Course members (owner / editor / viewer) and email invites. A role never
// goes down by accepting an invite, and the owner's role never changes here.

const iso = (d) => (d instanceof Date ? d.toISOString() : d ?? null);

const toMember = (r) => ({
  userId: r.user_id,
  role: r.role,
  name: r.name ?? null,
  email: r.email,
  avatarUrl: r.avatar_url ?? null,
  joinedAt: iso(r.created_at),
});

const toInvite = (r) => ({
  id: r.id,
  notebookId: r.notebook_id,
  email: r.email,
  role: r.role,
  expiresAt: iso(r.expires_at),
  createdAt: iso(r.created_at),
});

export const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

export async function listMembers(notebookId) {
  const { rows } = await query(
    `SELECT m.user_id, m.role, m.created_at, u.name, u.email, u.avatar_url
       FROM notebook_members m JOIN users u ON u.id = m.user_id
      WHERE m.notebook_id = $1
      ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, m.created_at`,
    [notebookId]
  );
  return rows.map(toMember);
}

export async function getMember(notebookId, userId) {
  const { rows } = await query(
    `SELECT m.user_id, m.role, m.created_at, u.name, u.email, u.avatar_url
       FROM notebook_members m JOIN users u ON u.id = m.user_id
      WHERE m.notebook_id = $1 AND m.user_id = $2`,
    [notebookId, userId]
  );
  return rows[0] ? toMember(rows[0]) : null;
}

const KEEP_HIGHER_ROLE = `CASE WHEN notebook_members.role = 'owner' OR (notebook_members.role = 'editor' AND EXCLUDED.role = 'viewer')
  THEN notebook_members.role ELSE EXCLUDED.role END`;

/** Adds a member (an existing member keeps the higher of both roles). Returns true if they were new. */
export async function addMember(notebookId, userId, role, invitedBy, client = { query }) {
  const { rows } = await client.query(
    `INSERT INTO notebook_members (notebook_id, user_id, role, invited_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (notebook_id, user_id) DO UPDATE SET role = ${KEEP_HIGHER_ROLE}
     RETURNING (xmax = 0) AS inserted`,
    [notebookId, userId, role, invitedBy]
  );
  return rows[0].inserted;
}

/** Changes a non-owner's role; null if they aren't a (non-owner) member. */
export async function setMemberRole(notebookId, userId, role) {
  const { rowCount } = await query(
    "UPDATE notebook_members SET role = $3 WHERE notebook_id = $1 AND user_id = $2 AND role <> 'owner'",
    [notebookId, userId, role]
  );
  return rowCount ? getMember(notebookId, userId) : null;
}

/** Removes a non-owner member (also used to leave a course). */
export async function removeMember(notebookId, userId) {
  const { rowCount } = await query("DELETE FROM notebook_members WHERE notebook_id = $1 AND user_id = $2 AND role <> 'owner'", [notebookId, userId]);
  return rowCount > 0;
}

// ---- Invites -------------------------------------------------------------------

/** Creates (or renews) the open invite for an email; returns { invite, token }. */
export async function createInvite(notebookId, { email, role, invitedBy, ttlDays }) {
  const token = crypto.randomBytes(24).toString("base64url");
  const { rows } = await query(
    `INSERT INTO notebook_invites (notebook_id, email, role, token_hash, invited_by, expires_at)
     VALUES ($1, LOWER($2), $3, $4, $5, NOW() + make_interval(days => $6))
     ON CONFLICT (notebook_id, LOWER(email)) WHERE accepted_at IS NULL DO UPDATE SET
       role = EXCLUDED.role, token_hash = EXCLUDED.token_hash, invited_by = EXCLUDED.invited_by,
       expires_at = EXCLUDED.expires_at, created_at = NOW()
     RETURNING *`,
    [notebookId, email, role, hashToken(token), invitedBy, ttlDays]
  );
  return { invite: toInvite(rows[0]), token };
}

export async function listInvites(notebookId) {
  const { rows } = await query(
    "SELECT * FROM notebook_invites WHERE notebook_id = $1 AND accepted_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC",
    [notebookId]
  );
  return rows.map(toInvite);
}

export async function deleteInvite(notebookId, inviteId) {
  const { rowCount } = await query("DELETE FROM notebook_invites WHERE id = $1 AND notebook_id = $2 AND accepted_at IS NULL", [inviteId, notebookId]);
  return rowCount > 0;
}

/** An open, unexpired invite by its token, with the course title and inviter's name. */
export async function getInviteByToken(token) {
  const { rows } = await query(
    `SELECT i.*, n.title AS course_title, n.emoji AS course_emoji, u.name AS inviter_name
       FROM notebook_invites i
       JOIN notebooks n ON n.id = i.notebook_id
       LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > NOW()`,
    [hashToken(token)]
  );
  const r = rows[0];
  return r ? { ...toInvite(r), courseTitle: r.course_title, courseEmoji: r.course_emoji, inviterName: r.inviter_name ?? null } : null;
}

/**
 * Applies every open invite for the user's email (at sign-up / sign-in, or
 * when they open an invite link). Returns the course ids joined.
 */
export async function acceptInvitesForUser(user) {
  if (!user?.email) return [];
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE notebook_invites SET accepted_at = NOW()
        WHERE LOWER(email) = LOWER($1) AND accepted_at IS NULL AND expires_at > NOW()
        RETURNING notebook_id, role, invited_by`,
      [user.email]
    );
    for (const invite of rows) await addMember(invite.notebook_id, user.id, invite.role, invite.invited_by, client);
    return rows.map((r) => r.notebook_id);
  });
}
