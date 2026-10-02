import { config } from "../config/index.js";

export function errorHandler(err, _req, res, _next) {
  if (!err.status || err.status >= 500) console.error(err);

  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ message: `File is larger than ${config.limits.uploadMaxMb}MB.` });
  }
  if (err?.code === "LIMIT_FILE_COUNT") {
    return res.status(413).json({ message: "Too many files at once — upload up to 20 per batch." });
  }

  const status = err.status || 500;
  res.status(status).json({ message: err.message || "Internal server error." });
}
