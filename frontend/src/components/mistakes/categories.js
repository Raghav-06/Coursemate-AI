// Mistake categories: label, icon and colour token (index.css --cat-*).
export const CATEGORY = {
  concept_gap: { label: "Concept gap", icon: "psychology_alt", color: "rgb(var(--cat-1))" },
  careless_error: { label: "Careless error", icon: "edit_off", color: "rgb(var(--cat-2))" },
  time_pressure: { label: "Time pressure", icon: "timer_off", color: "rgb(var(--cat-3))" },
};
export const CATEGORY_KEYS = ["concept_gap", "careless_error", "time_pressure"];

// What to do about each kind of mistake (same advice as the server's dashboard).
export const ADVICE = {
  concept_gap: { text: "Learn it again from your notes, then practise — start with the prerequisite the diagnosis points to, and only move on when you get the follow-ups right." },
  careless_error: { text: "Slow down and check: re-read the question, write units and signs at every step, estimate the answer before choosing, and re-check the option you mark. Drill untimed until accuracy is consistent." },
  time_pressure: { text: "Practise timed speed drills on this topic, set a time budget per question, skip and return to long ones, and do a mock under real timing every week." },
};
