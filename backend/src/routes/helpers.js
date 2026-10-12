import { isUuid } from "../utils/asyncHandler.js";
import { getUnit, listSources } from "../db/store.js";
import { LANGUAGES, isLanguage } from "../services/language.js";

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

const SOURCE_KINDS = ["material", "past_paper"];
const MAX_EXAM_NAME = 120;

/**
 * Past-paper fields of a request ({ kind?, examName?, examYear? }; multipart
 * bodies send strings). Absent fields stay undefined; anything odd is a 400.
 */
export function sourceKindFields(body) {
  const fields = {};
  if (body?.kind !== undefined && body.kind !== "") {
    if (!SOURCE_KINDS.includes(body.kind)) throw httpError(400, `kind must be one of ${SOURCE_KINDS.join(", ")}.`);
    fields.kind = body.kind;
  }
  if (body?.examName !== undefined) {
    if (body.examName !== null && typeof body.examName !== "string") throw httpError(400, "examName must be text.");
    fields.examName = cleanString(body.examName ?? "", MAX_EXAM_NAME) || null;
  }
  if (body?.examYear !== undefined) {
    if (body.examYear === null || body.examYear === "") fields.examYear = null;
    else {
      const year = Number(body.examYear);
      if (!Number.isInteger(year) || year < 1950 || year > new Date().getFullYear() + 1) throw httpError(400, "examYear must be a year (1950 or later).");
      fields.examYear = year;
    }
  }
  return fields;
}

/**
 * Sources a request should use: explicit ids if given, else the ones ticked
 * in the sources panel (or every source, with selectedOnly: false),
 * optionally limited to some units ("general" = no unit). Only ingested
 * sources can be used, and past papers only with includePastPapers.
 */
export async function resolveSources(notebookId, { sourceIds, unitIds, selectedOnly = true, includePastPapers = false } = {}) {
  const all = (await listSources(notebookId)).filter((s) => includePastPapers || s.kind !== "past_paper");
  let wanted = sourceIds ? all.filter((s) => sourceIds.includes(s.id)) : all.filter((s) => s.selected || !selectedOnly);
  if (unitIds?.length) {
    const units = new Set(unitIds.map((u) => (u === "general" ? null : u)));
    wanted = wanted.filter((s) => units.has(s.unitId));
  }
  return wanted.filter((s) => s.status === "ready");
}

/** Language fields of a settings request ({ language?, bilingual? }); 400 on anything odd. */
export function languagePatch(body, { allowInherit = false } = {}) {
  const patch = {};
  if (body?.language !== undefined) {
    if (body.language === null && allowInherit) patch.language = null;
    else if (!isLanguage(body.language)) throw httpError(400, `language must be one of ${LANGUAGES.map((l) => l.code).join(", ")}.`);
    else patch.language = body.language;
  }
  if (body?.bilingual !== undefined) {
    if (typeof body.bilingual !== "boolean") throw httpError(400, "bilingual must be true or false.");
    patch.bilingual = body.bilingual;
  }
  return patch;
}
