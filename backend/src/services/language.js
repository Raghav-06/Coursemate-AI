import { getCoursePreferences, getUserPreferences } from "../db/preferences.js";

// Response language for AI output. A user picks a language (and optionally
// "bilingual": explanations in that language, technical terms in English);
// a course can override it for them. Every AI feature appends the same
// instruction to its system prompt (see withLanguage in llm.js).

export const LANGUAGES = [
  { code: "en", name: "English", native: "English" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "bn", name: "Bengali", native: "বাংলা" },
  { code: "mr", name: "Marathi", native: "मराठी" },
  { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "te", name: "Telugu", native: "తెలుగు" },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ml", name: "Malayalam", native: "മലയാളം" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "or", name: "Odia", native: "ଓଡ଼ିଆ" },
  { code: "ur", name: "Urdu", native: "اردو" },
];
const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));
export const isLanguage = (code) => BY_CODE.has(code);

/** { code, name, native, bilingual } from stored preferences (English if unset or unknown). */
export function languageFrom(prefs = {}) {
  const lang = BY_CODE.get(prefs.language) ?? BY_CODE.get("en");
  return { ...lang, bilingual: lang.code !== "en" && prefs.bilingual === true };
}

/** The language this user's AI output should use (in a course, when given). */
export async function responseLanguage(userId, notebookId) {
  const [user, course] = await Promise.all([getUserPreferences(userId), notebookId ? getCoursePreferences(userId, notebookId) : {}]);
  return languageFrom(course.language ? course : user);
}

/** The system-prompt instruction for a language ("" for English). */
export function languageInstruction(language) {
  if (!language || language.code === "en") return "";
  const name = `${language.name} (${language.native})`;
  const common =
    "Keep formulas, equations, symbols, units, code, chemical names and proper nouns exactly as in the sources. " +
    "Keep citation markers such as [1] or [2][3] exactly as they are. In JSON output keep the keys in English and translate only the text values.";
  return language.bilingual
    ? `LANGUAGE: Write all explanations and other prose in ${name}, but give every technical term in English — write the English term, then the ${language.name} term in brackets the first time it appears — so the student can match their English textbooks and exam papers. ${common}`
    : `LANGUAGE: Write all prose in ${name}. For technical terms that are usually taught in English, give the English term in brackets after the ${language.name} term the first time it appears. ${common}`;
}
