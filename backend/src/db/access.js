// Shared SQL fragments for "may this user open this course?" checks, so every
// query that reaches a course through another row (deck, card, quiz…) applies
// the same rule: the user is a member (owner, editor or viewer). `alias` is the
// notebooks table alias, `userParam` the placeholder holding the user id (e.g. "$2").
export function canAccessNotebook(alias, userParam) {
  return `EXISTS (SELECT 1 FROM notebook_members access_m WHERE access_m.notebook_id = ${alias}.id AND access_m.user_id = ${userParam})`;
}

/** The user's role in the course (NULL if not a member), as a SQL expression. */
export function memberRoleSql(alias, userParam) {
  return `(SELECT access_r.role FROM notebook_members access_r WHERE access_r.notebook_id = ${alias}.id AND access_r.user_id = ${userParam})`;
}

// What each role may do. Personal things (chat history, flashcard progress,
// quizzes, answers, exams, plans, settings) need only membership.
const RANK = { viewer: 1, editor: 2, owner: 3 };
export const ROLES = ["owner", "editor", "viewer"];

/** True if `role` is at least `needed` (viewer < editor < owner). */
export function roleAtLeast(role, needed) {
  return (RANK[role] ?? 0) >= RANK[needed];
}

// Start of "today" in the user's timezone (placeholder holds an IANA name).
export function dayStartSql(tzParam) {
  return `(date_trunc('day', NOW() AT TIME ZONE ${tzParam}) AT TIME ZONE ${tzParam})`;
}
