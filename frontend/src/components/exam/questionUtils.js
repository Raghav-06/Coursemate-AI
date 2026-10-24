// Labels for exam-style questions (shared by the question body, sessions and results).

export const TYPE_LABEL = {
  mcq_single: "Single correct",
  mcq_multi: "One or more correct",
  numerical: "Numerical",
  matching: "Matching",
  one_word: "One word",
  descriptive: "Written answer",
};

export function marksLabel(q) {
  if (q.type === "descriptive" || !q.negative) return `${q.marks} mark${q.marks === 1 ? "" : "s"}`;
  return `+${q.marks} / −${q.negative}`;
}
