import { Router } from "express";
import { asyncHandler, isUuid } from "../utils/asyncHandler.js";
import { config } from "../config/index.js";
import { httpError, requireRole } from "./helpers.js";
import { getUserByEmail } from "../db/store.js";
import {
  acceptInvitesForUser,
  addMember,
  createInvite,
  deleteInvite,
  getInviteByToken,
  getMember,
  listInvites,
  listMembers,
  removeMember,
  setMemberRole,
} from "../db/members.js";
import { sendCourseInvite } from "../services/mailer.js";

// Sharing a course: owners invite people by email as editors or viewers,
// change roles and remove members; anyone but the owner can leave.

const INVITE_ROLES = ["editor", "viewer"];
const MAX_EMAIL_CHARS = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function inviteEmail(value) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!email || email.length > MAX_EMAIL_CHARS || !EMAIL_RE.test(email)) throw httpError(400, "Enter a valid email address.");
  const domains = config.auth.allowedDomains;
  if (domains.length && !domains.includes(email.split("@")[1])) {
    throw httpError(400, `Only ${domains.map((d) => `@${d}`).join(", ")} addresses can use this CourseMate.`);
  }
  return email;
}

function inviteRole(value) {
  if (!INVITE_ROLES.includes(value)) throw httpError(400, `role must be one of ${INVITE_ROLES.join(", ")}.`);
  return value;
}

const inviterName = (user) => user.name || user.email;

/** Member routes scoped to a course; added to the courses router (so :id is already checked). */
export function courseMemberRoutes(router) {
  // { members, invites (owner only), role } — every member can see who's in the course.
  router.get(
    "/:id/members",
    asyncHandler(async (req, res) => {
      const owner = req.notebook.role === "owner";
      const [members, invites] = await Promise.all([listMembers(req.notebook.id), owner ? listInvites(req.notebook.id) : []]);
      res.json({ members, invites, role: req.notebook.role });
    })
  );

  // body: { email, role: editor|viewer }. Someone with an account is added at
  // once; anyone else gets an invite that applies when they sign up or sign in.
  // → { member } or { invite, link, emailed }
  router.post(
    "/:id/invites",
    requireRole("owner"),
    asyncHandler(async (req, res) => {
      const email = inviteEmail(req.body?.email);
      const role = inviteRole(req.body?.role ?? "viewer");
      const [members, invites] = await Promise.all([listMembers(req.notebook.id), listInvites(req.notebook.id)]);
      if (members.some((m) => m.email?.toLowerCase() === email)) throw httpError(409, "That person is already in this course.");
      const max = config.limits.membersPerNotebook;
      const pendingOthers = invites.filter((i) => i.email !== email).length;
      if (members.length + pendingOthers >= max) throw httpError(409, `A course can be shared with up to ${max} people.`);

      const courseTitle = req.notebook.title;
      const existing = await getUserByEmail(email);
      if (existing) {
        await addMember(req.notebook.id, existing.id, role, req.user.id);
        const link = `${config.clientUrl}/#/notebook/${req.notebook.id}`;
        const emailed = await sendCourseInvite(email, { courseTitle, inviterName: inviterName(req.user), role, link, existing: true });
        return res.status(201).json({ member: await getMember(req.notebook.id, existing.id), emailed });
      }

      const { invite, token } = await createInvite(req.notebook.id, { email, role, invitedBy: req.user.id, ttlDays: config.limits.inviteTtlDays });
      const link = `${config.clientUrl}/#/invite/${token}`;
      const emailed = await sendCourseInvite(email, { courseTitle, inviterName: inviterName(req.user), role, link, existing: false });
      res.status(201).json({ invite, link, emailed });
    })
  );

  router.delete(
    "/:id/invites/:inviteId",
    requireRole("owner"),
    asyncHandler(async (req, res) => {
      if (!isUuid(req.params.inviteId) || !(await deleteInvite(req.notebook.id, req.params.inviteId))) throw httpError(404, "Invite not found.");
      res.status(204).end();
    })
  );

  // body: { role: editor|viewer }
  router.patch(
    "/:id/members/:userId",
    requireRole("owner"),
    asyncHandler(async (req, res) => {
      const role = inviteRole(req.body?.role);
      if (!isUuid(req.params.userId)) throw httpError(404, "Member not found.");
      if (req.params.userId === req.user.id) throw httpError(409, "You own this course.");
      const member = await setMemberRole(req.notebook.id, req.params.userId, role);
      if (!member) throw httpError(404, "Member not found.");
      res.json(member);
    })
  );

  // The owner removes someone, or a member leaves ("me" or their own id).
  router.delete(
    "/:id/members/:userId",
    asyncHandler(async (req, res) => {
      const userId = req.params.userId === "me" ? req.user.id : req.params.userId;
      if (!isUuid(userId)) throw httpError(404, "Member not found.");
      const self = userId === req.user.id;
      if (self && req.notebook.role === "owner") throw httpError(409, "The owner can't leave their course. Delete it instead.");
      if (!self && req.notebook.role !== "owner") throw httpError(403, "Only the course's owner can do that.");
      if (!(await removeMember(req.notebook.id, userId))) throw httpError(404, "Member not found.");
      res.status(204).end();
    })
  );
}

// ---- Invite links ------------------------------------------------------------------

export const invitesRouter = Router();

async function loadInvite(req) {
  const token = String(req.params.token ?? "");
  const invite = token.length >= 20 && token.length <= 64 ? await getInviteByToken(token) : null;
  if (!invite) throw httpError(404, "This invite link is invalid or has expired.");
  return invite;
}

// What the link is for, before accepting it.
invitesRouter.get(
  "/:token",
  asyncHandler(async (req, res) => {
    const invite = await loadInvite(req);
    res.json({
      courseTitle: invite.courseTitle,
      courseEmoji: invite.courseEmoji,
      inviterName: invite.inviterName,
      role: invite.role,
      email: invite.email,
      emailMatches: invite.email.toLowerCase() === String(req.user.email ?? "").toLowerCase(),
      expiresAt: invite.expiresAt,
    });
  })
);

// Joins the course. The invite only works for the email it was sent to.
invitesRouter.post(
  "/:token/accept",
  asyncHandler(async (req, res) => {
    const invite = await loadInvite(req);
    if (invite.email.toLowerCase() !== String(req.user.email ?? "").toLowerCase()) {
      throw httpError(403, `This invite was sent to ${invite.email}. Sign in with that email to accept it.`);
    }
    if (!req.user.emailVerified) throw httpError(403, "Verify your email address first.");
    await acceptInvitesForUser(req.user);
    res.json({ notebookId: invite.notebookId });
  })
);
