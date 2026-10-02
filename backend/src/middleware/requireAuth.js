/** Rejects API requests from visitors who haven't signed in with Google. */
export function requireAuth(req, res, next) {
  if (req.isAuthenticated?.() && req.user) return next();
  res.status(401).json({ message: "Please sign in to continue.", code: "UNAUTHENTICATED" });
}
