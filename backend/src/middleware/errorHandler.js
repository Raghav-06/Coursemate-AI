import { config } from "../config/index.js";

const GENERIC_MESSAGE = "Something went wrong on the server. Please try again.";

export function errorHandler(err, _req, res, _next) {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ message: `File is larger than ${config.limits.uploadMaxMb}MB.` });
  }
  if (err?.code === "LIMIT_FILE_COUNT") {
    return res.status(413).json({ message: "Too many files at once — upload up to 20 per batch." });
  }

  // Errors we raise ourselves carry a status and a user-facing message. Anything
  // else (database, library, programming errors) may contain internals: log it
  // and return a generic message instead.
  const status = err?.status ?? err?.statusCode ?? (err?.expose ? 400 : null);
  if (!status || status >= 500) console.error(err);
  if (!status) return res.status(500).json({ message: GENERIC_MESSAGE });

  res.status(status).json({ message: err.message || GENERIC_MESSAGE });
}
