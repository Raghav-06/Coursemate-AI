// Exam profiles: the subjects, question formats and marking of each exam a
// course can prepare for. Plain data so it is easy to adjust; marking is
// computed from it in services/marking.js.
//
// Format types:
//   mcq_single  4 options, exactly one correct
//   mcq_multi   4 options, one or more correct (JEE Advanced multiple-correct, GATE MSQ)
//   numerical   a number (integer or decimal), graded within a tolerance, optional unit
//   matching    match each item of List-I to one of List-II
//   one_word    a word or short phrase
//   descriptive a written answer marked against a rubric
// marks: full marks; negative: marks lost for a wrong answer (0 = none);
// partial: "jee_advanced" (multiple-correct partial marking) or none;
// seconds: typical time a well-prepared student spends (used when a question has none).

const F = (id, type, label, marks, negative, extra = {}) => ({ id, type, label, marks, negative, ...extra });

export const EXAM_PROFILES = {
  jee_main: {
    name: "JEE Main",
    subjects: ["Physics", "Chemistry", "Mathematics"],
    formats: [
      F("mcq", "mcq_single", "MCQ (single correct)", 4, 1, { seconds: 120 }),
      F("numerical", "numerical", "Numerical value", 4, 0, { seconds: 180 }),
    ],
    // Full mock, per subject: 20 MCQs + 5 numerical, 60 minutes (180 for all three).
    mock: { perSubject: [{ format: "mcq", count: 20 }, { format: "numerical", count: 5 }], minutesPerSubject: 60 },
  },
  jee_advanced: {
    name: "JEE Advanced",
    subjects: ["Physics", "Chemistry", "Mathematics"],
    formats: [
      F("mcq", "mcq_single", "Single correct", 3, 1, { seconds: 150 }),
      F("multi", "mcq_multi", "One or more correct", 4, 2, { partial: "jee_advanced", seconds: 210 }),
      F("integer", "numerical", "Integer / numerical", 4, 0, { integer: true, seconds: 180 }),
      F("matching", "matching", "Matching list", 3, 1, { seconds: 210 }),
    ],
    mock: {
      perSubject: [
        { format: "mcq", count: 4 },
        { format: "multi", count: 4 },
        { format: "integer", count: 6 },
        { format: "matching", count: 4 },
      ],
      minutesPerSubject: 60,
    },
  },
  neet: {
    name: "NEET",
    subjects: ["Physics", "Chemistry", "Botany", "Zoology"],
    formats: [F("mcq", "mcq_single", "MCQ (single correct)", 4, 1, { seconds: 60 })],
    mock: { perSubject: [{ format: "mcq", count: 45 }], minutesPerSubject: 45 },
  },
  gate: {
    name: "GATE",
    subjects: ["General Aptitude", "Engineering Mathematics", "Core subject"],
    formats: [
      F("mcq_1", "mcq_single", "MCQ, 1 mark", 1, 1 / 3, { seconds: 90 }),
      F("mcq_2", "mcq_single", "MCQ, 2 marks", 2, 2 / 3, { seconds: 180 }),
      F("msq_1", "mcq_multi", "MSQ, 1 mark", 1, 0, { seconds: 120 }),
      F("msq_2", "mcq_multi", "MSQ, 2 marks", 2, 0, { seconds: 210 }),
      F("nat_1", "numerical", "NAT, 1 mark", 1, 0, { seconds: 120 }),
      F("nat_2", "numerical", "NAT, 2 marks", 2, 0, { seconds: 240 }),
    ],
    // 65 questions, 100 marks, 180 minutes (whole paper, not per subject).
    mock: {
      whole: [
        { format: "mcq_1", count: 15 },
        { format: "mcq_2", count: 18 },
        { format: "msq_1", count: 5 },
        { format: "msq_2", count: 7 },
        { format: "nat_1", count: 10 },
        { format: "nat_2", count: 10 },
      ],
      minutes: 180,
    },
  },
  upsc_prelims: {
    name: "UPSC Prelims",
    subjects: ["History", "Geography", "Polity", "Economy", "Environment", "Science & Technology", "Current affairs"],
    formats: [F("mcq", "mcq_single", "MCQ (GS Paper I)", 2, 2 / 3, { seconds: 72 })],
    mock: { whole: [{ format: "mcq", count: 100 }], minutes: 120 },
  },
  upsc_mains: {
    name: "UPSC Mains",
    subjects: ["Essay", "GS I", "GS II", "GS III", "GS IV"],
    formats: [
      F("desc_10", "descriptive", "10 marks (150 words)", 10, 0, { words: 150, seconds: 420 }),
      F("desc_15", "descriptive", "15 marks (250 words)", 15, 0, { words: 250, seconds: 660 }),
    ],
    // A GS paper: 10 × 10 marks + 10 × 15 marks, 180 minutes.
    mock: { whole: [{ format: "desc_10", count: 10 }, { format: "desc_15", count: 10 }], minutes: 180 },
  },
  university: {
    name: "University (custom)",
    subjects: [],
    custom: true,
    formats: [
      F("mcq", "mcq_single", "MCQ", 1, 0, { seconds: 60 }),
      F("one_word", "one_word", "One word / fill in the blank", 1, 0, { seconds: 45 }),
      F("desc_2", "descriptive", "2 marks", 2, 0, { words: 50, seconds: 240 }),
      F("desc_5", "descriptive", "5 marks", 5, 0, { words: 180, seconds: 600 }),
      F("desc_10", "descriptive", "10 marks", 10, 0, { words: 400, seconds: 1200 }),
    ],
    mock: {
      whole: [
        { format: "mcq", count: 10 },
        { format: "one_word", count: 5 },
        { format: "desc_2", count: 5 },
        { format: "desc_5", count: 3 },
        { format: "desc_10", count: 2 },
      ],
      minutes: 180,
    },
  },
};

export const EXAM_TYPES = Object.keys(EXAM_PROFILES);
export const FORMAT_TYPES = ["mcq_single", "mcq_multi", "numerical", "matching", "one_word", "descriptive"];
const MAX_SUBJECTS = 12;
const MAX_SUBJECT_CHARS = 60;

/**
 * The profile a course uses: its exam type's data with the course's own
 * subjects (a custom list for University, or a subset of the exam's).
 * null when the course has no exam type.
 */
export function courseProfile(examType, settings = {}) {
  const base = EXAM_PROFILES[examType];
  if (!base) return null;
  const subjects = Array.isArray(settings.subjects) && settings.subjects.length ? settings.subjects : base.subjects;
  return { type: examType, ...base, name: settings.name || base.name, subjects };
}

/** The format of a profile by id, or null. */
export const formatOf = (profile, formatId) => profile?.formats.find((f) => f.id === formatId) ?? null;

/** Validated course exam settings from a request: { examType, settings } (throws { status: 400 }). */
export function cleanExamSettings(body) {
  const fail = (message) => Object.assign(new Error(message), { status: 400 });
  const examType = body?.examType;
  if (examType === null) return { examType: null, settings: {} };
  if (!EXAM_PROFILES[examType]) throw fail(`examType must be one of ${EXAM_TYPES.join(", ")}.`);
  const settings = {};
  if (body.subjects !== undefined) {
    if (!Array.isArray(body.subjects) || body.subjects.length > MAX_SUBJECTS) throw fail(`subjects must be a list of up to ${MAX_SUBJECTS} names.`);
    const seen = new Set();
    settings.subjects = body.subjects
      .map((s) => (typeof s === "string" ? s.trim().slice(0, MAX_SUBJECT_CHARS) : ""))
      .filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
  }
  if (body.name !== undefined) {
    if (body.name !== null && typeof body.name !== "string") throw fail("name must be text.");
    settings.name = (body.name ?? "").trim().slice(0, 80) || undefined;
  }
  return { examType, settings };
}

/** Profiles for the UI (subjects, formats with marking, mock pattern). */
export function profileList() {
  return EXAM_TYPES.map((type) => ({ type, ...EXAM_PROFILES[type] }));
}
