// Demo data for trying CourseMate AI without uploading anything or calling a
// model: a demo account with one JEE Main Physics course (two pasted notes),
// a small knowledge map, self-checked practice questions, a submitted
// practice session with diagnosed mistakes, and this week's plan.
//   npm run seed:demo            (re-running resets the demo account)
//   npm run seed:demo -- --force (allowed with NODE_ENV=production)
// Everything is inserted directly, so no AI key is needed. The notes' chunks
// get placeholder (zero) vectors marked with a non-model name, so they are
// re-embedded with your embedding model the first time you chat.
import { migrate, pool, query, withTransaction } from "../src/db/pool.js";
import { hashPassword } from "../src/auth/password.js";
import { getNotebook, listSources } from "../src/db/store.js";
import { getExam, todayIn } from "../src/db/exams.js";
import { setMapStatus } from "../src/db/knowledgeMap.js";
import { mapSignature } from "../src/services/knowledgeMap.js";
import { signatureOf } from "../src/services/topics.js";
import { addDays } from "../src/services/examPlan.js";
import { generateWeeklyPlan } from "../src/services/weeklyPlan.js";

const EMAIL = "demo@coursemate.local";
const PASSWORD = "demo-pass-123";
const TIMEZONE = "Asia/Kolkata";
const PLACEHOLDER_EMBEDDING = "demo-seed:not-embedded";
const PLACEHOLDER_DIMS = 8;

const NOTES = [
  {
    title: "Laws of motion and friction (class notes)",
    text: `Newton's first law: a body stays at rest or in uniform motion in a straight line unless a net external force acts on it. Inertia is the tendency to resist changes in motion; mass measures inertia.

Newton's second law: the net force equals the rate of change of momentum, F = dp/dt. For constant mass, F = ma. In SI units force is measured in newtons (1 N = 1 kg·m/s²). Draw a free-body diagram for each body, choose axes, and write ΣF = ma along each axis.

Newton's third law: forces come in pairs. If A pushes B with force F, B pushes A with −F. The pair acts on different bodies, so the forces never cancel on one body.

Friction opposes relative motion (or the tendency of it) between surfaces in contact. Static friction adjusts itself up to a limit: f_s ≤ μ_s N. Static friction equals μ_s N only when sliding is about to start. Kinetic friction while sliding is f_k = μ_k N, and usually μ_k < μ_s. On an incline of angle θ a block stays at rest if tan θ ≤ μ_s; the angle where it just starts to slide is the angle of repose, tan θ = μ_s.

Circular motion: a body moving in a circle of radius r at speed v needs a net force towards the centre, the centripetal force m v²/r. On a flat curve this force is provided by friction, so the maximum safe speed is v = √(μ_s g r). On a banked road without friction, tan θ = v²/(r g).`,
  },
  {
    title: "Work, energy and power (class notes)",
    text: `Work done by a constant force: W = F·d = F d cos θ, where θ is the angle between the force and the displacement. Work is a scalar measured in joules. A force perpendicular to the motion (like the normal force on a level road) does no work.

Work–energy theorem: the work done by the net force on a body equals its change in kinetic energy, W_net = ΔK, with K = ½ m v².

Potential energy: near the Earth's surface U = m g h. A spring stretched by x stores U = ½ k x². Gravity and spring forces are conservative: the work they do depends only on the start and end points.

Conservation of mechanical energy: if only conservative forces do work, K + U stays constant. With friction, the mechanical energy lost equals the work done against friction, f_k × distance, which becomes heat.

Power is the rate of doing work: P = W / t, or P = F v for a force F on a body moving at speed v along it. The SI unit is the watt (1 W = 1 J/s); 1 horsepower ≈ 746 W.`,
  },
];

// subject → chapters → topics (with exam weights 0-1 and prerequisites by name).
const MAP = {
  subject: "Physics",
  chapters: [
    {
      name: "Laws of Motion",
      ref: "Unit 5",
      weight: 0.55,
      topics: [
        { name: "Newton's laws of motion", weight: 0.7, ref: "5.1" },
        { name: "Friction", weight: 0.8, ref: "5.2" },
        { name: "Circular motion", weight: 0.6, ref: "5.3" },
      ],
    },
    {
      name: "Work, Energy and Power",
      ref: "Unit 6",
      weight: 0.45,
      topics: [
        { name: "Work and kinetic energy", weight: 0.6, ref: "6.1" },
        { name: "Conservation of mechanical energy", weight: 0.75, ref: "6.2" },
        { name: "Power", weight: 0.4, ref: "6.3" },
      ],
    },
  ],
};
const PREREQUISITES = [
  ["Newton's laws of motion", "Friction"],
  ["Newton's laws of motion", "Circular motion"],
  ["Friction", "Circular motion"],
  ["Work and kinetic energy", "Conservation of mechanical energy"],
  ["Work and kinetic energy", "Power"],
];

const mcq = (topic, difficulty, stem, options, correct, solution, seconds = 120) => ({
  topic,
  format: "mcq",
  type: "mcq_single",
  difficulty,
  stem,
  options: options.map((text, i) => ({ id: "ABCD"[i], text })),
  answer: { correct: [correct] },
  solution,
  expectedSeconds: seconds,
  marks: 4,
  negative: 1,
});
const numerical = (topic, difficulty, stem, value, unit, solution, seconds = 180) => ({
  topic,
  format: "numerical",
  type: "numerical",
  difficulty,
  stem,
  options: null,
  answer: { value, tolerance: 0.02, unit },
  solution,
  expectedSeconds: seconds,
  marks: 4,
  negative: 0,
});

const QUESTIONS = [
  mcq("Newton's laws of motion", "easy", "A net force of $12\\,\\text{N}$ acts on a $3\\,\\text{kg}$ block. Its acceleration is", ["$4\\,\\text{m/s}^2$", "$36\\,\\text{m/s}^2$", "$0.25\\,\\text{m/s}^2$", "$9\\,\\text{m/s}^2$"], "A", "By $F = ma$: $a = F/m = 12/3 = 4\\,\\text{m/s}^2$."),
  mcq("Newton's laws of motion", "medium", "A horse pulls a cart forward. By Newton's third law, the force the cart exerts on the horse is", ["equal and in the same direction", "equal and opposite", "smaller, so the cart moves", "zero once the cart moves"], "B", "Third-law pairs are equal and opposite and act on different bodies, so they don't cancel on the cart."),
  mcq("Friction", "medium", "A $5\\,\\text{kg}$ block rests on a level floor ($\\mu_s = 0.4$, $g = 10\\,\\text{m/s}^2$). A horizontal push of $10\\,\\text{N}$ is applied. The friction force on the block is", ["$20\\,\\text{N}$", "$10\\,\\text{N}$", "$0\\,\\text{N}$", "$50\\,\\text{N}$"], "B", "Limiting friction is $\\mu_s N = 0.4 \\times 50 = 20\\,\\text{N}$. The push (10 N) is less, so static friction only balances it: $f_s = 10\\,\\text{N}$."),
  numerical("Friction", "medium", "A block just starts to slide down an incline when the angle is $30^\\circ$. Find $\\mu_s$ (to two decimals).", 0.58, "", "At the angle of repose $\\tan\\theta = \\mu_s$, so $\\mu_s = \\tan 30^\\circ \\approx 0.58$."),
  mcq("Circular motion", "medium", "A car takes a flat curve of radius $50\\,\\text{m}$ with $\\mu_s = 0.5$ ($g = 10\\,\\text{m/s}^2$). The maximum safe speed is about", ["$5\\,\\text{m/s}$", "$15.8\\,\\text{m/s}$", "$25\\,\\text{m/s}$", "$250\\,\\text{m/s}$"], "B", "$v = \\sqrt{\\mu_s g r} = \\sqrt{0.5 \\times 10 \\times 50} = \\sqrt{250} \\approx 15.8\\,\\text{m/s}$."),
  numerical("Work and kinetic energy", "easy", "A $2\\,\\text{kg}$ ball speeds up from $3\\,\\text{m/s}$ to $5\\,\\text{m/s}$. How much work did the net force do?", 16, "J", "$W = \\Delta K = \\tfrac12 \\cdot 2 \\cdot (5^2 - 3^2) = 16\\,\\text{J}$."),
  mcq("Work and kinetic energy", "easy", "A force of $10\\,\\text{N}$ moves a box $4\\,\\text{m}$ at $60^\\circ$ to the force. The work done is", ["$40\\,\\text{J}$", "$20\\,\\text{J}$", "$34.6\\,\\text{J}$", "$0\\,\\text{J}$"], "B", "$W = F d \\cos\\theta = 10 \\times 4 \\times \\tfrac12 = 20\\,\\text{J}$."),
  numerical("Conservation of mechanical energy", "medium", "A ball is dropped from $20\\,\\text{m}$ ($g = 10\\,\\text{m/s}^2$, no air resistance). Its speed just before hitting the ground is", 20, "m/s", "$mgh = \\tfrac12 m v^2 \\Rightarrow v = \\sqrt{2gh} = \\sqrt{400} = 20\\,\\text{m/s}$."),
  mcq("Conservation of mechanical energy", "hard", "A block slides $5\\,\\text{m}$ on a rough floor ($f_k = 4\\,\\text{N}$). The mechanical energy turned into heat is", ["$0.8\\,\\text{J}$", "$9\\,\\text{J}$", "$20\\,\\text{J}$", "$1.25\\,\\text{J}$"], "C", "Energy lost to friction $= f_k \\times d = 4 \\times 5 = 20\\,\\text{J}$."),
  numerical("Power", "easy", "A motor lifts a $50\\,\\text{kg}$ load $10\\,\\text{m}$ in $25\\,\\text{s}$ ($g = 10\\,\\text{m/s}^2$). Its power output is", 200, "W", "$P = mgh/t = 50 \\times 10 \\times 10 / 25 = 200\\,\\text{W}$."),
  mcq("Friction", "easy", "Static friction on a block at rest", ["always equals $\\mu_s N$", "is never larger than the applied force along the surface", "always equals $\\mu_k N$", "acts along the applied force"], "B", "Static friction adjusts to balance the applied force, up to the limit $\\mu_s N$."),
  mcq("Circular motion", "easy", "The centripetal force on a body moving in a circle points", ["along the velocity", "away from the centre", "towards the centre", "along the axis"], "C", "Uniform circular motion needs a net force $m v^2 / r$ directed towards the centre."),
];

// The submitted session: question index → what the student did.
const SESSION_ANSWERS = [
  { q: 0, choice: ["A"], seconds: 70, confidence: "sure" },
  { q: 2, choice: ["A"], seconds: 55, confidence: "sure", wrong: true }, // treated static friction as μN
  { q: 4, choice: ["B"], seconds: 140, confidence: "unsure" },
  { q: 5, value: "16", unit: "J", seconds: 100, confidence: "sure" },
  { q: 8, choice: ["A"], seconds: 25, confidence: "guess", wrong: true }, // divided instead of multiplying
];

function chunksOf(text) {
  const parts = text.split("\n\n");
  let offset = 0;
  return parts.map((content, i) => {
    const start = text.indexOf(content, offset);
    offset = start + content.length;
    return { index: i, content, start, end: offset };
  });
}

async function main() {
  if (process.env.NODE_ENV === "production" && !process.argv.includes("--force")) {
    console.error("Refusing to seed demo data with NODE_ENV=production. Pass --force if you really want it (npm run seed:demo -- --force).");
    process.exit(1);
  }
  await migrate();
  const today = await todayIn(TIMEZONE);
  const hash = await hashPassword(PASSWORD);

  const ids = await withTransaction(async (client) => {
    const q = (text, params) => client.query(text, params).then((r) => r.rows);

    // Reset: deleting the account removes its courses and everything in them.
    await q("DELETE FROM users WHERE LOWER(email) = LOWER($1)", [EMAIL]);
    const [user] = await q(
      "INSERT INTO users (email, email_verified, password_hash, password_updated_at, name, given_name) VALUES ($1, TRUE, $2, NOW(), 'Demo Student', 'Demo') RETURNING id",
      [EMAIL, hash]
    );
    const [notebook] = await q(
      `INSERT INTO notebooks (user_id, title, title_is_auto, emoji, summary, suggested_questions, exam_type, exam_settings)
       VALUES ($1, 'JEE Physics: Mechanics (demo)', FALSE, '🚀', $2, $3, 'jee_main', $4) RETURNING id`,
      [
        user.id,
        "Demo course: Newton's laws, friction, circular motion, and work, energy and power, prepared for JEE Main Physics.",
        JSON.stringify(["When is static friction equal to μN?", "Derive the maximum safe speed on a flat curve.", "State the work–energy theorem."]),
        JSON.stringify({ subjects: ["Physics"] }),
      ]
    );
    await q("INSERT INTO notebook_members (notebook_id, user_id, role) VALUES ($1, $2, 'owner')", [notebook.id, user.id]);

    // Two pasted notes with placeholder vectors (re-embedded on the first chat).
    for (const note of NOTES) {
      const chunks = chunksOf(note.text);
      const [source] = await q(
        `INSERT INTO sources (notebook_id, type, title, status, progress, content, chunk_count, char_count, word_count, embedding_model, kind)
         VALUES ($1, 'text', $2, 'ready', 100, $3, $4, $5, $6, $7, 'material') RETURNING id`,
        [notebook.id, note.title, note.text, chunks.length, note.text.length, note.text.split(/\s+/).length, PLACEHOLDER_EMBEDDING]
      );
      for (const c of chunks) {
        await q("INSERT INTO chunks (source_id, chunk_index, content, start_offset, end_offset, embedding) VALUES ($1, $2, $3, $4, $5, $6)", [
          source.id,
          c.index,
          c.content,
          c.start,
          c.end,
          new Array(PLACEHOLDER_DIMS).fill(0),
        ]);
      }
    }

    // Course topics (General unit) linked to the map's topic nodes.
    const topicIds = new Map();
    const allTopics = MAP.chapters.flatMap((c) => c.topics);
    for (const [i, t] of allTopics.entries()) {
      const [row] = await q("INSERT INTO topics (notebook_id, unit_id, name, position) VALUES ($1, NULL, $2, $3) RETURNING id", [notebook.id, t.name, i]);
      topicIds.set(t.name, row.id);
    }

    // Knowledge map: Physics → 2 chapters → 6 topics, with prerequisites.
    const nodeIds = new Map();
    const [subject] = await q(
      "INSERT INTO km_nodes (notebook_id, level, name, weight, weight_source, position) VALUES ($1, 'subject', $2, 1, 'model', 0) RETURNING id",
      [notebook.id, MAP.subject]
    );
    nodeIds.set(MAP.subject, subject.id);
    for (const [ci, chapter] of MAP.chapters.entries()) {
      const [c] = await q(
        "INSERT INTO km_nodes (notebook_id, parent_id, level, name, weight, weight_source, syllabus_ref, position) VALUES ($1, $2, 'chapter', $3, $4, 'model', $5, $6) RETURNING id",
        [notebook.id, subject.id, chapter.name, chapter.weight, chapter.ref, ci]
      );
      nodeIds.set(chapter.name, c.id);
      for (const [ti, t] of chapter.topics.entries()) {
        const [n] = await q(
          `INSERT INTO km_nodes (notebook_id, parent_id, level, name, weight, weight_source, syllabus_ref, topic_id, position)
           VALUES ($1, $2, 'topic', $3, $4, 'model', $5, $6, $7) RETURNING id`,
          [notebook.id, c.id, t.name, t.weight, t.ref, topicIds.get(t.name), ti]
        );
        nodeIds.set(t.name, n.id);
      }
    }
    for (const [from, to] of PREREQUISITES) {
      await q("INSERT INTO km_edges (notebook_id, from_node, to_node) VALUES ($1, $2, $3)", [notebook.id, nodeIds.get(from), nodeIds.get(to)]);
    }

    // Self-checked bank questions (validators + an independent solve, as generation records them).
    const questionIds = [];
    for (const item of QUESTIONS) {
      const [row] = await q(
        `INSERT INTO bank_questions (notebook_id, node_ids, exam_type, format, type, difficulty, stem, options, answer, solution,
                                     expected_seconds, marks, negative, verified, verification, created_by)
         VALUES ($1, $2, 'jee_main', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE, $13, $14) RETURNING id`,
        [
          notebook.id,
          [nodeIds.get(item.topic)],
          item.format,
          item.type,
          item.difficulty,
          item.stem,
          item.options ? JSON.stringify(item.options) : null,
          JSON.stringify(item.answer),
          item.solution,
          item.expectedSeconds,
          item.marks,
          item.negative,
          JSON.stringify({ status: "verified", attempts: 1, solverAnswer: item.answer.correct ?? { value: item.answer.value }, reasons: [], history: [] }),
          user.id,
        ]
      );
      questionIds.push(row.id);
    }

    // Older practice (3-9 days ago) so mastery varies: strong on Newton's laws, weak on friction.
    const history = [
      ["Newton's laws of motion", [1, 1, 1, 0.8, 1], 9],
      ["Friction", [0, 1, 0, 0], 6],
      ["Circular motion", [1, 0, 1], 5],
      ["Work and kinetic energy", [1, 1, 0.8, 1], 4],
      ["Power", [1, 1, 1], 3],
    ];
    for (const [name, scores, daysAgo] of history) {
      for (const [i, score] of scores.entries()) {
        await q(
          "INSERT INTO topic_events (user_id, topic_id, node_id, kind, score, weight, created_at) VALUES ($1, $2, $3, 'practice', $4, 1, NOW() - make_interval(days => $5, mins => $6))",
          [user.id, topicIds.get(name), nodeIds.get(name), score, daysAgo, i * 3]
        );
      }
    }

    // A submitted topic drill from yesterday with two diagnosed mistakes.
    const sessionQs = SESSION_ANSWERS.map((a) => QUESTIONS[a.q]);
    const score = SESSION_ANSWERS.reduce((s, a) => s + (a.wrong ? -QUESTIONS[a.q].negative : QUESTIONS[a.q].marks), 0);
    const [session] = await q(
      `INSERT INTO practice_sessions (notebook_id, user_id, kind, exam_type, title, node_ids, status, settings, started_at, finished_at, score, max_score, created_at)
       VALUES ($1, $2, 'drill', 'jee_main', 'Topic drill: Friction, Work and kinetic energy', $3, 'finished', $4,
               NOW() - INTERVAL '1 day 20 minutes', NOW() - INTERVAL '1 day', $5, $6, NOW() - INTERVAL '1 day 21 minutes')
       RETURNING id`,
      [notebook.id, user.id, [nodeIds.get("Friction"), nodeIds.get("Work and kinetic energy")], JSON.stringify({ count: SESSION_ANSWERS.length, instantFeedback: true }), score, sessionQs.reduce((s, x) => s + x.marks, 0)]
    );
    let elapsed = 0;
    for (const [position, a] of SESSION_ANSWERS.entries()) {
      const item = QUESTIONS[a.q];
      elapsed += a.seconds;
      const answer = a.choice ? { choice: a.choice } : { value: a.value, unit: a.unit };
      await q("INSERT INTO session_questions (session_id, position, question_id) VALUES ($1, $2, $3)", [session.id, position, questionIds[a.q]]);
      await q(
        `INSERT INTO session_answers (session_id, position, question_id, answer, attempted, correct, fraction, marks, time_spent_ms, answer_changes, confidence, grading, locked, answered_at)
         VALUES ($1, $2, $3, $4, TRUE, $5, $6, $7, $8, 0, $9, $10, TRUE, NOW() - INTERVAL '1 day 20 minutes' + make_interval(secs => $11))`,
        [session.id, position, questionIds[a.q], JSON.stringify(answer), !a.wrong, a.wrong ? 0 : 1, a.wrong ? -item.negative : item.marks, a.seconds * 1000, a.confidence, JSON.stringify({ by: "code" }), elapsed]
      );
      await q(
        "INSERT INTO topic_events (user_id, topic_id, node_id, kind, score, weight, created_at) VALUES ($1, $2, $3, 'practice', $4, 1, NOW() - INTERVAL '1 day')",
        [user.id, topicIds.get(item.topic), nodeIds.get(item.topic), a.wrong ? 0 : 1]
      );
    }

    // Their diagnoses (as the agent stores them), with follow-up questions from the bank.
    const diagnoses = [
      {
        position: 1,
        q: 2,
        category: "concept_gap",
        confidence: 0.82,
        revisit: "Friction",
        misconception: "Treats static friction as always equal to μ_s N, even when the push is smaller than the limit.",
        explanation: "Static friction only grows as large as it needs to: here it balances the 10 N push. μ_s N = 20 N is the most it could be, reached only when sliding is about to start.",
        evidence: ["Answered 20 N (= μ_s N) in 55 s, marked sure", "Friction mastery 25% before this session (1 of 4 recent answers right)"],
        followups: [10, 3],
        signals: { expectedS: 120, spentS: 55, ratio: 0.46, confidence: "sure", masteryBefore: 0.25 },
      },
      {
        position: 4,
        q: 8,
        category: "careless_error",
        confidence: 0.64,
        revisit: "Conservation of mechanical energy",
        misconception: "Divided force by distance instead of multiplying (work done against friction = f × d).",
        explanation: "The heat produced equals the work done against friction, f_k × d = 4 N × 5 m = 20 J. 0.8 J is 4 ÷ 5 — a slip, not a gap: the same idea was right in the work questions.",
        evidence: ["Answered in 25 s against ~120 s expected", "Marked as a guess"],
        followups: [7],
        signals: { expectedS: 120, spentS: 25, ratio: 0.21, confidence: "guess" },
      },
    ];
    for (const d of diagnoses) {
      const item = QUESTIONS[d.q];
      await q(
        `INSERT INTO diagnoses (notebook_id, user_id, session_id, position, question_id, node_ids, status, category, confidence, rule_category,
                                signals, evidence, misconception, revisit_node_id, explanation, followup_question_ids, marks_lost, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'ready', $7, $8, $7, $9, $10, $11, $12, $13, $14, $15, NOW() - INTERVAL '1 day')`,
        [
          notebook.id,
          user.id,
          session.id,
          d.position,
          questionIds[d.q],
          [nodeIds.get(item.topic)],
          d.category,
          d.confidence,
          JSON.stringify(d.signals),
          JSON.stringify(d.evidence),
          d.misconception,
          nodeIds.get(d.revisit),
          d.explanation,
          d.followups.map((i) => questionIds[i]),
          item.marks + item.negative,
        ]
      );
      if (d.category === "concept_gap") {
        await q(
          "INSERT INTO topic_events (user_id, topic_id, node_id, kind, score, weight, created_at) VALUES ($1, $2, $3, 'diagnosis', 0.3, 0.5, NOW() - INTERVAL '1 day')",
          [user.id, topicIds.get(d.revisit), nodeIds.get(d.revisit)]
        );
      }
    }
    await q("INSERT INTO user_activity (user_id, day, kind, count) VALUES ($1, $2::date - 1, 'practice', $3)", [user.id, today, SESSION_ANSWERS.length]);

    // The exam: JEE Main in 60 days, on the weekly plan (Sunday off).
    const [exam] = await q(
      `INSERT INTO exams (notebook_id, user_id, name, exam_date, plan_kind, study_minutes, session_minutes, rest_day, timezone, week_starts_on)
       VALUES ($1, $2, 'JEE Main (Session 1)', $3::date + 60, 'weekly', $4, 45, 'sun', $5, 'mon') RETURNING id`,
      [notebook.id, user.id, today, JSON.stringify({ mon: 90, tue: 90, wed: 120, thu: 90, fri: 90, sat: 180, sun: 0 }), TIMEZONE]
    );

    return { userId: user.id, notebookId: notebook.id, examId: exam.id };
  });

  // Mark the map and topics as built from these sources, so opening them doesn't rebuild with a model.
  const [notebook, sources] = await Promise.all([getNotebook(ids.notebookId), listSources(ids.notebookId)]);
  await setMapStatus(ids.notebookId, { status: "ready", signature: mapSignature(sources, notebook), built: true });
  await query("INSERT INTO topic_sets (notebook_id, unit_key, signature, status) VALUES ($1, 'general', $2, 'ready')", [
    ids.notebookId,
    signatureOf(sources.filter((s) => s.kind === "material")),
  ]);

  // This week's plan from the data above (priority order, no model call); next
  // week's when no study days are left this week (e.g. on the Sunday rest day).
  const exam = await getExam(ids.examId, ids.userId);
  const { items, weekStart } = await generateWeeklyPlan(exam, ids.userId, today, { useModel: false });

  console.log(`
✅ Demo data ready (${items.length} tasks planned ${weekStart > today ? `for next week, from ${weekStart}` : "this week"}).

   Sign in with email + password:
     Email:    ${EMAIL}
     Password: ${PASSWORD}

   Course: "${notebook.title}" — open Exam plan → Weekly plan.
   Chats re-embed the demo notes with your EMBEDDING_MODEL the first time.
`);
}

main()
  .catch((err) => {
    console.error(`\n❌ Seeding failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
