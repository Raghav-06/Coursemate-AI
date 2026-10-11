import { isUuid } from "../utils/asyncHandler.js";
import { getUnit, listSources } from "../db/store.js";

// Shared request helpers for the API routers.

const MAX_IDS = 200;

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Trimmed text from a request field, at most `max` characters ("" if not a string). */
export const cleanString = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** A list of ids from the request body: undefined if absent, else validated (400 on anything odd). */
export function idList(value, { allow = [], name = "ids" } = {}) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > MAX_IDS || !value.every((v) => allow.includes(v) || isUuid(v))) {
    throw httpError(400, `${name} must be a list of ids.`);
  }
  return [...new Set(value)];
}

/**
 * Turns a requested unit into a unit id of this course: "general", "" or null
 * mean no unit (null); undefined means "not given".
 */
export async function resolveUnitId(notebookId, value) {
  if (value === undefined) return undefined;
  if (value === null || value === "" || value === "general") return null;
  if (!isUuid(value) || !(await getUnit(value, notebookId))) throw httpError(400, "That unit doesn't exist in this course.");
  return value;
}

/**
 * Sources a request should use: explicit ids if given, else the ones ticked
 * in the sources panel (or every source, with selectedOnly: false),
 * optionally limited to some units ("general" = no unit). Only ingested
 * sources can be used.
 */
export async function resolveSources(notebookId, { sourceIds, unitIds, selectedOnly = true } = {}) {
  const all = await listSources(notebookId);
  let wanted = sourceIds ? all.filter((s) => sourceIds.includes(s.id)) : all.filter((s) => s.selected || !selectedOnly);
  if (unitIds?.length) {
    const units = new Set(unitIds.map((u) => (u === "general" ? null : u)));
    wanted = wanted.filter((s) => units.has(s.unitId));
  }
  return wanted.filter((s) => s.status === "ready");
}
