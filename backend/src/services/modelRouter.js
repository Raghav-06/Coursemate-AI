import { config } from "../config/index.js";

// Which model tier does each AI task (see MODEL_NANO_* / MODEL_SUPER_* /
// MODEL_ULTRA_* in .env.example). Callers name their task; llm.js picks the
// tier here, so moving a task to another tier is a one-line change.
//
//   nano  — quick judgement on short inputs: grading objective answers that
//           need it (units, tolerance, one word, matching), tagging questions
//           and attempts with topics, classifying uploads.
//   super — writing exam content: questions, answer keys and solutions, the
//           independent self-check solve, grading descriptive answers, the
//           daily replanning adjustments.
//   ultra — deep reasoning over the whole course: mistake diagnosis, building
//           the knowledge map, the weekly plan.
// Tasks not listed (chat, source guides, overviews, topics, flashcards,
// explain-it-back, OCR…) use the default LLM model.
export const TASK_TIERS = {
  grade_objective: "nano",
  tag_topics: "nano",
  classify_source: "nano",
  past_paper_topics: "nano",

  generate_questions: "super",
  self_check: "super",
  grade_descriptive: "super",
  quiz: "super",
  written_questions: "super",
  grade_answer: "super",
  replan_daily: "super",

  diagnose_mistake: "ultra",
  build_knowledge_map: "ultra",
  weekly_plan: "ultra",
};

/** The tier for a task ("nano" | "super" | "ultra"), or undefined for the default LLM model. */
export function tierFor(task) {
  return TASK_TIERS[task];
}

/** The settings a call runs with: a tier's, or the default LLM model's (tier "default"). */
export function modelSettings(tier) {
  return config.ai.tiers[tier] ?? { tier: "default", systemPrefix: null, ...config.ai.chat };
}
