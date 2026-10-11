import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config/index.js";

// Original uploaded files, stored as <originalsDir>/<sourceId>.<ext> so a
// source can be re-processed later. Only file sources have one.

export function originalPath(source) {
  const ext = String(source.fileType ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return path.join(config.paths.originalsDir, ext ? `${source.id}.${ext}` : source.id);
}

/** Moves an upload from the temp folder into the originals folder; returns the new path. */
export async function keepOriginal(tempPath, source) {
  const target = originalPath(source);
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.rename(tempPath, target);
  } catch {
    // Different volumes: copy, then drop the temp file.
    await fs.copyFile(tempPath, target);
    await fs.unlink(tempPath).catch(() => {});
  }
  return target;
}

export async function hasOriginal(source) {
  if (source.type !== "file") return false;
  return fs.access(originalPath(source)).then(
    () => true,
    () => false
  );
}

export async function deleteOriginal(source) {
  if (source.type !== "file") return;
  await fs.unlink(originalPath(source)).catch(() => {});
}
