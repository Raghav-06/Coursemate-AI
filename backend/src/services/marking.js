// Marks for an answer under an exam profile's format (see config/examProfiles.js).
// Pure: grading decides what is correct; this turns it into marks.

const round = (n) => Math.round(n * 100) / 100;

/**
 * outcome: { attempted, correct } for every type; mcq_multi adds `chosen` and
 * `key` (option ids); descriptive adds `fraction` (0-1 of the rubric met).
 * Returns marks (negative for wrong answers where the format has negative marking).
 */
export function marksFor(format, outcome) {
  if (!outcome?.attempted) return 0;
  if (format.type === "descriptive") return Math.round(Math.max(0, Math.min(1, outcome.fraction ?? 0)) * format.marks * 2) / 2;
  if (format.type === "mcq_multi") {
    const key = new Set(outcome.key ?? []);
    const chosen = new Set(outcome.chosen ?? []);
    const wrongPick = [...chosen].some((c) => !key.has(c));
    const exact = !wrongPick && chosen.size === key.size;
    if (exact) return format.marks;
    if (wrongPick || chosen.size === 0) return round(-format.negative);
    // Only correct options chosen, but not all of them.
    if (format.partial === "jee_advanced") {
      if (key.size === 4 && chosen.size === 3) return 3;
      if (key.size >= 3 && chosen.size === 2) return 2;
      if (key.size >= 2 && chosen.size === 1) return 1;
    }
    return round(-format.negative);
  }
  return outcome.correct ? format.marks : round(-format.negative);
}

/** Total and maximum marks of graded answers: [{ format, marks }]. */
export function scoreOf(answers) {
  return {
    marks: round(answers.reduce((s, a) => s + (a.marks ?? 0), 0)),
    maxMarks: round(answers.reduce((s, a) => s + a.format.marks, 0)),
  };
}
