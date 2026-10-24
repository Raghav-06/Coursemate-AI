// Access-control check for shared courses: creates three throwaway accounts
// (owner, viewer, outsider) plus an editor, runs the real API on a random
// port against your database, and verifies who can do what. Cleans up after
// itself. No AI calls are needed.
//   npm run check-access
import crypto from "node:crypto";
import { createApp } from "../src/app.js";
import { migrate, pool, query } from "../src/db/pool.js";
import { hashPassword } from "../src/auth/password.js";

const PASSWORD = `pw-${crypto.randomBytes(8).toString("hex")}`;
const tag = crypto.randomBytes(4).toString("hex");
const emails = ["owner", "editor", "viewer", "outsider"].map((r) => `${r}.${tag}@access-check.invalid`);

let failures = 0;
function check(label, actual, expected) {
  const ok = Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "✔" : "✘"} ${label} → ${actual}${ok ? "" : ` (expected ${expected})`}`);
}

async function main() {
  await migrate();
  const hash = await hashPassword(PASSWORD);
  for (const email of emails) {
    await query("INSERT INTO users (email, email_verified, password_hash, name) VALUES ($1, TRUE, $2, $3)", [email, hash, email.split(".")[0]]);
  }

  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const sessions = {};
  const call = async (who, method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(sessions[who] && { Cookie: sessions[who] }), ...(body && { "Content-Type": "application/json" }) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: res.status, data, headers: res.headers };
  };

  try {
    for (const [i, who] of ["owner", "editor", "viewer", "outsider"].entries()) {
      const res = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emails[i], password: PASSWORD }),
      });
      sessions[who] = res.headers.get("set-cookie").split(";")[0];
    }

    // Owner sets up a course with a unit, a deck and a (pasted) source.
    const course = (await call("owner", "POST", "/api/notebooks", { title: "Access check" })).data;
    const id = course.id;
    const unit = (await call("owner", "POST", `/api/notebooks/${id}/units`, { title: "Unit 1" })).data;
    const deck = (await call("owner", "POST", `/api/notebooks/${id}/decks`, { title: "Deck" })).data;
    const source = (await call("owner", "POST", `/api/notebooks/${id}/sources/text`, { title: "Notes", text: "Some notes." })).data;
    check("owner created a course", course.role, "owner");
    const { rows: bankRows } = await query(
      `INSERT INTO bank_questions (notebook_id, format, type, difficulty, stem, answer, expected_seconds, marks, verified)
       VALUES ($1, 'mcq', 'mcq_single', 'easy', 'Access check question?', '{"correct": ["A"]}', 60, 4, TRUE) RETURNING id`,
      [id]
    );
    const bankId = bankRows[0].id;
    const ownerId = (await query("SELECT id FROM users WHERE LOWER(email) = LOWER($1)", [emails[0]])).rows[0].id;
    const { rows: sessionRows } = await query(
      "INSERT INTO practice_sessions (notebook_id, user_id, kind, title) VALUES ($1, $2, 'drill', 'Access check') RETURNING id",
      [id, ownerId]
    );
    const sessionId = sessionRows[0].id;
    const { rows: diagRows } = await query(
      "INSERT INTO diagnoses (notebook_id, user_id, session_id, position, status, category) VALUES ($1, $2, $3, 0, 'ready', 'concept_gap') RETURNING id",
      [id, ownerId, sessionId]
    );
    const diagnosisId = diagRows[0].id;
    const { rows: examRows } = await query(
      "INSERT INTO exams (notebook_id, user_id, name, exam_date, plan_kind, week_start) VALUES ($1, $2, 'Access check exam', CURRENT_DATE + 30, 'weekly', CURRENT_DATE) RETURNING id",
      [id, ownerId]
    );
    const examId = examRows[0].id;
    const { rows: itemRows } = await query(
      "INSERT INTO exam_plan_items (exam_id, plan_date, task_type, title, minutes, payload) VALUES ($1, CURRENT_DATE, 'drill', 'Drill', 20, '{\"kind\": \"drill\", \"nodeIds\": []}') RETURNING id",
      [examId]
    );
    const itemId = itemRows[0].id;
    const examRoutes = [
      ["GET", `/api/exams/${examId}`],
      ["PATCH", `/api/exams/${examId}/schedule`],
      ["GET", `/api/exams/${examId}/weekly-plan`],
      ["POST", `/api/exams/${examId}/weekly-plan`],
      ["POST", `/api/exams/${examId}/weekly-plan/replan`],
      ["GET", `/api/exams/${examId}/plan-changes`],
      ["PATCH", `/api/plan-items/${itemId}`],
      ["POST", `/api/plan-items/${itemId}/start`],
    ];

    // Sharing: existing accounts are added straight away.
    check("owner invites editor", (await call("owner", "POST", `/api/notebooks/${id}/invites`, { email: emails[1], role: "editor" })).status, 201);
    check("owner invites viewer", (await call("owner", "POST", `/api/notebooks/${id}/invites`, { email: emails[2], role: "viewer" })).status, 201);
    check("invite with a bad role", (await call("owner", "POST", `/api/notebooks/${id}/invites`, { email: "x@y.invalid", role: "owner" })).status, 400);

    // A non-member sees nothing (404, not 403, so ids can't be probed).
    for (const [method, path] of [
      ["GET", `/api/notebooks/${id}`],
      ["GET", `/api/notebooks/${id}/sources`],
      ["GET", `/api/notebooks/${id}/units`],
      ["GET", `/api/notebooks/${id}/members`],
      ["GET", `/api/notebooks/${id}/messages`],
      ["GET", `/api/sources/${source.id}`],
      ["GET", `/api/sources/${source.id}/content`],
      ["GET", `/api/decks/${deck.id}`],
      ["PATCH", `/api/notebooks/${id}`],
      ["DELETE", `/api/notebooks/${id}`],
      ["POST", `/api/notebooks/${id}/invites`],
      ["GET", `/api/notebooks/${id}/exam-profile`],
      ["PUT", `/api/notebooks/${id}/exam-profile`],
      ["GET", `/api/notebooks/${id}/knowledge-map`],
      ["POST", `/api/notebooks/${id}/knowledge-map/rebuild`],
      ["GET", `/api/notebooks/${id}/questions`],
      ["POST", `/api/notebooks/${id}/questions/generate`],
      ["GET", `/api/questions/${bankId}`],
      ["POST", `/api/questions/${bankId}/report`],
      ["GET", `/api/notebooks/${id}/sessions`],
      ["POST", `/api/notebooks/${id}/sessions`],
      ["GET", `/api/sessions/${sessionId}`],
      ["POST", `/api/sessions/${sessionId}/finish`],
      ["GET", `/api/sessions/${sessionId}/diagnoses`],
      ["GET", `/api/notebooks/${id}/mistakes`],
      ["GET", `/api/diagnoses/${diagnosisId}`],
      ["PATCH", `/api/diagnoses/${diagnosisId}`],
      ["POST", `/api/diagnoses/${diagnosisId}/practice`],
      ...examRoutes,
    ]) {
      check(`outsider ${method} ${path.replace(id, ":id")}`, (await call("outsider", method, path, method === "GET" || method === "DELETE" ? undefined : { title: "x", email: "a@b.invalid", role: "viewer" })).status, 404);
    }
    const listed = (await call("outsider", "GET", "/api/notebooks")).data;
    check("outsider's course list doesn't include it", listed.some((n) => n.id === id), false);

    // Viewer: can read and use personal features, can't edit.
    check("viewer GET course", (await call("viewer", "GET", `/api/notebooks/${id}`)).data?.role, "viewer");
    check("viewer GET sources", (await call("viewer", "GET", `/api/notebooks/${id}/sources`)).status, 200);
    check("viewer GET deck", (await call("viewer", "GET", `/api/decks/${deck.id}`)).status, 200);
    check("viewer course list shows the owner", (await call("viewer", "GET", "/api/notebooks")).data.find((n) => n.id === id)?.owner?.email, emails[0]);
    check("viewer can untick a source for their own chat", (await call("viewer", "PATCH", `/api/sources/${source.id}`, { selected: false })).status, 200);
    check("…and the owner's selection is unchanged", (await call("owner", "GET", `/api/notebooks/${id}/sources`)).data[0].selected, true);
    for (const [method, path, body] of [
      ["PATCH", `/api/notebooks/${id}`, { title: "Hacked" }],
      ["DELETE", `/api/notebooks/${id}`],
      ["POST", `/api/notebooks/${id}/units`, { title: "U" }],
      ["PATCH", `/api/notebooks/${id}/units/${unit.id}`, { title: "U" }],
      ["DELETE", `/api/notebooks/${id}/units/${unit.id}`],
      ["POST", `/api/notebooks/${id}/sources/text`, { text: "x" }],
      ["PATCH", `/api/sources/${source.id}`, { title: "Renamed" }],
      ["DELETE", `/api/sources/${source.id}`],
      ["POST", `/api/sources/${source.id}/reprocess`],
      ["POST", `/api/notebooks/${id}/decks`, { title: "D" }],
      ["PATCH", `/api/decks/${deck.id}`, { title: "D" }],
      ["DELETE", `/api/decks/${deck.id}`],
      ["POST", `/api/notebooks/${id}/invites`, { email: "a@b.invalid", role: "viewer" }],
      ["PUT", `/api/notebooks/${id}/exam-profile`, { examType: "neet" }],
      ["POST", `/api/notebooks/${id}/knowledge-map/rebuild`],
    ]) {
      check(`viewer ${method} ${path.replace(id, ":id")}`, (await call("viewer", method, path, body)).status, 403);
    }
    const memberUpload = await fetch(`${base}/api/notebooks/${id}/sources/files`, { method: "POST", headers: { Cookie: sessions.viewer } });
    check("viewer file upload", memberUpload.status, 403);

    // Editor: manages sources, units and decks; not members or deletion.
    check("editor adds a unit", (await call("editor", "POST", `/api/notebooks/${id}/units`, { title: "Unit 2" })).status, 201);
    check("editor renames the source", (await call("editor", "PATCH", `/api/sources/${source.id}`, { title: "Renamed" })).status, 200);
    check("editor sets the exam profile", (await call("editor", "PUT", `/api/notebooks/${id}/exam-profile`, { examType: "jee_main" })).status, 200);
    check("viewer can't open the owner's practice session (personal)", (await call("viewer", "GET", `/api/sessions/${sessionId}`)).status, 404);
    check("viewer can't answer in it", (await call("viewer", "PUT", `/api/sessions/${sessionId}/answers/0`, { answer: null })).status, 404);
    check("viewer can't see the owner's diagnosis", (await call("viewer", "GET", `/api/diagnoses/${diagnosisId}`)).status, 404);
    check("viewer's own mistakes dashboard is empty", (await call("viewer", "GET", `/api/notebooks/${id}/mistakes`)).data?.total, 0);
    check("owner opens their session", (await call("owner", "GET", `/api/sessions/${sessionId}`)).status, 200);
    // Exams and weekly plans are personal: a co-member can't see or change someone else's.
    for (const [method, path] of examRoutes) {
      check(`viewer ${method} ${path.replace(examId, ":examId").replace(itemId, ":itemId")} (someone else's)`, (await call("viewer", method, path, method === "GET" ? undefined : { done: true, restDay: null })).status, 404);
    }
    check("owner reads their weekly plan", (await call("owner", "GET", `/api/exams/${examId}/weekly-plan`)).status, 200);
    check("owner sets their rest day", (await call("owner", "PATCH", `/api/exams/${examId}/schedule`, { restDay: "sun" })).data?.restDay, "sun");
    check("owner skips a task", (await call("owner", "PATCH", `/api/plan-items/${itemId}`, { skipped: true, reason: "busy" })).data?.skipReason, "busy");
    const viewerExam = await call("viewer", "POST", `/api/notebooks/${id}/exams`, { name: "My exam", examDate: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10), planKind: "weekly" });
    check("viewer adds their own weekly-plan exam", viewerExam.data?.planKind, "weekly");
    check("viewer changes their own schedule", (await call("viewer", "PATCH", `/api/exams/${viewerExam.data?.id}/schedule`, { studyMinutes: 90 })).status, 200);
    // With an AI key set, adding the source above logs the owner's own calls in the
    // background (source guide, kind, overview, topics), so wait for that work to
    // finish and the count to hold, then compare before and after one inserted row.
    const ownerUsage = async () => (await call("owner", "GET", "/api/me/ai-usage?days=7")).data;
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    for (let waited = 0; waited < 60; waited++) {
      const busy =
        (await call("owner", "GET", `/api/sources/${source.id}`)).data?.status === "processing" ||
        (await call("owner", "GET", `/api/notebooks/${id}/topics`)).data?.some((u) => u.status === "pending");
      if (!busy) break;
      await sleep(1000);
    }
    let usageBefore = await ownerUsage();
    for (let stable = 0, waited = 0; stable < 3 && waited < 30; waited++) {
      await sleep(1000);
      const latest = await ownerUsage();
      stable = latest?.totals?.calls === usageBefore?.totals?.calls ? stable + 1 : 0;
      usageBefore = latest;
    }
    await query("INSERT INTO ai_calls (user_id, notebook_id, tier, task, latency_ms, ok) VALUES ($1, $2, 'super', 'access_check', 1, TRUE)", [ownerId, id]);
    const usageAfter = await ownerUsage();
    check("owner's AI usage goes up by the one new call", usageAfter?.totals?.calls - usageBefore?.totals?.calls, 1);
    check("owner's AI usage by feature has access_check", usageAfter?.byFeature?.find((f) => f.feature === "access_check")?.calls, 1);
    const outsiderUsage = (await call("outsider", "GET", "/api/me/ai-usage")).data;
    check("outsider's AI usage doesn't include the owner's", outsiderUsage?.totals?.calls, 0);
    check("…nor the owner's access_check call", outsiderUsage?.byFeature?.some((f) => f.feature === "access_check"), false);
    check("AI usage with days=0", (await call("owner", "GET", "/api/me/ai-usage?days=0")).status, 400);
    check("owner can't see the viewer's exam", (await call("owner", "GET", `/api/exams/${viewerExam.data?.id}`)).status, 404);
    check("viewer sees a bank question", (await call("viewer", "GET", `/api/questions/${bankId}`)).status, 200);
    check("viewer reads the knowledge map", (await call("viewer", "GET", `/api/notebooks/${id}/knowledge-map`)).status, 200);
    check("editor renames the deck", (await call("editor", "PATCH", `/api/decks/${deck.id}`, { title: "Deck 2" })).status, 200);
    check("editor can't invite", (await call("editor", "POST", `/api/notebooks/${id}/invites`, { email: "a@b.invalid", role: "viewer" })).status, 403);
    check("editor can't delete the course", (await call("editor", "DELETE", `/api/notebooks/${id}`)).status, 403);
    check("editor can't remove the viewer", (await call("editor", "DELETE", `/api/notebooks/${id}/members/${(await call("owner", "GET", `/api/notebooks/${id}/members`)).data.members.find((m) => m.role === "viewer").userId}`)).status, 403);

    // Owner manages roles; the viewer leaves and loses access.
    check("owner can't leave", (await call("owner", "DELETE", `/api/notebooks/${id}/members/me`)).status, 409);
    check("viewer leaves", (await call("viewer", "DELETE", `/api/notebooks/${id}/members/me`)).status, 204);
    check("…then gets 404", (await call("viewer", "GET", `/api/notebooks/${id}`)).status, 404);
    check("signed out", (await call("nobody", "GET", `/api/notebooks/${id}`)).status, 401);

    await call("owner", "DELETE", `/api/notebooks/${id}`);
  } finally {
    server.close();
    await query("DELETE FROM users WHERE email = ANY($1)", [emails]);
    await pool.end();
  }
  console.log(failures ? `\n❌ ${failures} check(s) failed` : "\n✅ All access checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch(async (err) => {
  console.error(`\n❌ ${err.message}`);
  await query("DELETE FROM users WHERE email = ANY($1)", [emails]).catch(() => {});
  process.exit(1);
});
