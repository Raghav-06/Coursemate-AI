// Shared SQL fragments for "may this user open this course?" checks, so every
// query that reaches a course through another row (deck, card, quiz…) applies
// the same rule. `alias` is the notebooks table alias, `userParam` the
// placeholder holding the user id (e.g. "$2").
export function canAccessNotebook(alias, userParam) {
  return `${alias}.user_id = ${userParam}`;
}

// Start of "today" in the user's timezone (placeholder holds an IANA name).
export function dayStartSql(tzParam) {
  return `(date_trunc('day', NOW() AT TIME ZONE ${tzParam}) AT TIME ZONE ${tzParam})`;
}
