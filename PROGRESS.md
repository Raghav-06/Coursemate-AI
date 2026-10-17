# CourseMate AI — progress

## Exam-prep agent (current work)

Adding an exam-prep **agent** for Indian competitive and university exams (JEE, NEET, GATE, UPSC,
university): knowledge map, self-checked practice questions, mistake diagnosis and daily
replanning, on three model tiers (Nano / Super / Ultra). 7 stages, each verified, committed and
pushed before the next. It **extends** what exists (units, topics, topic mastery, quizzes, past-paper
analysis, exams + revision plans, streaks) instead of duplicating it.

| # | Stage | Status |
|---|-------|--------|
| 1 | Nano/Super/Ultra model tiers | ✅ done |
| 2 | Exam profiles and knowledge map | ✅ done |
| 3 | Self-checked practice question generation | ✅ done |
| 4 | Timed practice sessions | ⏳ next |
| 5 | Mistake diagnosis agent | ☐ |
| 6 | Weekly plan and daily replanning | ☐ |
| 7 | Demo course, AI usage panel and docs | ☐ |

Before stage 1, the uncommitted shared-provider work that was in the tree (AI_PROVIDER / LLM_*
settings, failing interrupted sources on boot) was committed on its own ("Shared AI provider
settings…"), as agreed.

### Test harness (rebuild in the session scratchpad if it's gone)
- PostgreSQL 16 scratch cluster: `initdb -D <scratch>/pg/data -U postgres -A trust`, started on port
  55432 (`pg_ctl -o "-p 55432"`), database `cm`.
- Mock OpenAI-compatible API (`<scratch>/mock/server.mjs` + `rules.mjs`, reloaded on change): chat
  (incl. streaming), embeddings (hashed bag of words, 128 dims). Port 18080 plain; port 18081
  requires key `nvapi-test` and prefixes every reply with a `<think>…</think>` block (stands in for a
  reasoning model on another endpoint). `log.jsonl` records model, stream, system-prompt start,
  temperature, max_tokens and the key's last 6 chars for every request.
- Backend runs from a Linux copy (`rsync` of `backend/src` + `npm ci` there; `/mnt/d` is very slow)
  on port 3100 with every setting exported (`env.sh`): `AI_PROVIDER=custom` → mock, `MODEL_NANO_MODEL=
  mock-nano`, `MODEL_SUPER_MODEL=mock-super` (same endpoint), `MODEL_ULTRA_*` on the 18081 mock with
  its own key, `MODEL_ULTRA_SYSTEM_PREFIX="detailed thinking on"`, `MODEL_ULTRA_TEMPERATURE=default`.
  Test users are inserted with a scrypt hash and signed in with `/auth/login` (cookie jar).
- Frontend: Linux copy with `npm ci`, `src` rsynced in, `vite build` + `oxlint src`.

### 1. Nano/Super/Ultra model tiers ✅
- Config (`config/index.js`): `ai.tiers.{nano,super,ultra}` from `MODEL_<TIER>_BASE_URL / _API_KEY /
  _MODEL / _TEMPERATURE / _MAX_TOKENS / _SYSTEM_PREFIX`; empty = the LLM settings (key reused only
  when the base URL is the LLM one, or local); `default` for temperature/max tokens = provider's
  choice; a base URL without a key is reported at startup. `aiSummary().tiers` (model, host, local,
  inherited, reasoningPrefix) → `/health` `tiers` and `ai.tiers`.
- `services/modelRouter.js`: the one task → tier map (`TASK_TIERS`), `tierFor(task)`,
  `modelSettings(tier)`. Existing features were given task names; quizzes, written questions and
  written-answer grading now run on Super, past-paper topic mapping on Nano; chat, guides,
  overviews, topics, flashcards, explain-it-back and OCR stay on the default LLM.
- `llm.js`: `complete` / `completeJson` / `streamCompletion` take `{ tier }` or `{ task }` (plus
  `language`, optional `userId` / `notebookId`); one cached `ChatOpenAI` per tier; the tier's system
  prefix goes first; a leading `<think>…</think>` is stripped (also while streaming); provider
  errors name the tier's settings (e.g. "Check MODEL_ULTRA_API_KEY"); a prose reply to a JSON request
  now counts as invalid JSON (was parsed into a bare string by jsonrepair) and is retried.
- `ai_calls` table + `db/aiCalls.js` (`logAiCall`, `flushAiLog`, `aiUsage`): every chat/JSON/stream,
  vision and transcription call → user, course, tier, model, task, latency, ok, error code
  (`429`, `401`, `timeout`, `network`, `invalid_json`, `missing_key`…), never prompt text. Who/which
  course comes from `services/aiContext.js` (AsyncLocalStorage per /api request; the `:id` course
  loader fills in the course; background jobs started by a request inherit it).
- `npm run check-api` also tests each tier (plain text + JSON `{"sum": 42}`) and exits non-zero if a
  tier fails. Settings → AI & privacy lists the three tiers.
- Tested: check-api against the mocks → Nano/Super on 18080 (models mock-nano / mock-super,
  temperatures 0 / 0.3), Ultra on 18081 with its own key, "detailed thinking on" first in the system
  prompt, no temperature sent, max_tokens 8000, `<think>` block removed from text and JSON; backend
  boots and migrates (fresh DB, then again on restart); ingestion + chat on a course logged
  `source_guide`, `topics`, `course_overview`, `chat` with the user and course; forced failures logged
  `generate_questions` super `429`, `grade_objective` nano `invalid_json` ×3 (retries), wrong Ultra key
  → message "Check MODEL_ULTRA_API_KEY" and `401`; `/health` shows tier models/hosts and no keys.
  Frontend build + oxlint: 0 errors (2 existing warnings).

### 2. Exam profiles and knowledge map ✅
- `config/examProfiles.js`: 7 profiles as data (subjects, formats with type/marks/negative/partial/
  typical seconds, mock pattern per subject or whole paper); `courseProfile`, `cleanExamSettings`,
  `profileList`. `services/marking.js` (`marksFor`, `scoreOf`): negative marking, JEE Advanced
  partial marking, GATE MSQ all-or-nothing, descriptive half marks.
- DB: `notebooks.exam_type`, `notebooks.exam_settings` (subjects, name); `sources.suggested_kind`;
  `km_nodes` (parent, level subject|chapter|topic|subtopic, name, description, weight 0-1,
  weight_source past_papers|model, syllabus_ref, topic_id → topics, unit_id, position), `km_edges`
  (from → to prerequisite), `km_maps` (status, signature, error, built_at);
  `past_paper_questions.node_id`; `topic_events.node_id` (topic_id now nullable). Queries in
  `db/knowledgeMap.js`.
- Source kinds: `material` (shown as "Notes") | `syllabus` | `past_paper`. The syllabus is used in
  chat but not by generators (`resolveSources` `includeSyllabus`), nor for unit topic extraction.
  `services/sourceKind.js`: Nano classifies new uploads → `suggested_kind` when it differs (≥ 0.6
  confidence); PATCH `kind` or `dismissKindSuggestion` clears it.
- `services/knowledgeMap.js`: Ultra build (syllabus ≤ 20k chars, 16 note passages, ≤ 60 past-paper
  questions, course units and topics, exam subjects) → `parseMap` (dedupe per level, caps 8/30/20/10,
  ≤ 500 nodes, subject names snapped to the profile's, prerequisites resolved by name, self links
  and cycles dropped) → link chapters to units and topic nodes to course topics → `replaceMap`
  (ids kept by level + name, preferring the same parent) → weights → Nano tagging of past-paper
  questions (5 embedding candidates; invalid answer → most similar, null → untagged) → weights from
  count + marks per level. Rebuilt on demand, and (debounced 5 s) when sources/kinds/exam change
  once a map exists or a syllabus is present; papers analysed later are tagged then.
  `nodeMastery` (own events + linked topic's, recency-weighted, rolled up by attempts),
  `courseMap`, `nodeDetail` (MMR passages for the node path, past-paper questions in its subtree,
  history, prerequisites/dependants).
- Routes (`routes/knowledgeMap.routes.js`): `GET /api/exam-profiles`, `GET|PUT
  /api/notebooks/:id/exam-profile` (PUT editors), `GET /:id/knowledge-map`, `POST
  /:id/knowledge-map/rebuild` (editors), `GET /:id/knowledge-map/nodes/:nodeId` (node must belong to
  the course). check-access extended (outsider 404 ×4, viewer 403 on PUT profile and rebuild, editor
  sets the profile, viewer reads the map).
- UI: course tool "Knowledge map" (sidebar + mobile bar, now 7 items): exam line + Choose/Change
  exam dialog (profiles, subjects or custom subjects, formats with marking), Rebuild, pending /
  error / empty states ("Add the syllabus", "Build from current sources"), Tree (collapsible,
  mastery dot, syllabus ref, weight bars, PYQ count, score) | Prerequisites (layered SVG graph,
  scrolls inside its box on phones), legend and topic counts; node slide-over with mastery +
  history bars, Learn first / Builds towards (navigate), cited passages (open the source viewer),
  past-paper questions, Practise this (quiz on the linked topic for now; Stage 3 switches it to
  generated questions) and Ask in chat. Add sources: Notes / Syllabus / Past papers. Sources list:
  Syllabus badge, "Looks like … — mark it / dismiss", Mark as notes / syllabus / past paper.
- Tested (curl, mock AI): profile validation (unknown exam, subjects not a list → 400; outsider →
  404); 3 sources → Nano suggested "syllabus" for the syllabus only; marking it as syllabus built
  the map (Ultra once): 18 nodes, "physics" → "Physics", duplicate topic, subtopic equal to its
  topic and empty subject dropped, 3 edges kept of 6 (cycle, self link and unknown name dropped),
  syllabus refs kept, 5 topic nodes linked to course topics; tagging: Q1 → "Range" subtopic, Q2's
  invalid letter → most similar ("Friction"), Q3 null → untagged; weights from past papers. Mastery:
  Friction 2 topic events (1 then 0) + Static friction 2 node events (0, 0) → Friction 0.23 (4
  answers), rolled up to chapter and subject; viewer sees 0 attempts (personal). Forced rebuild kept
  all 18 ids and the history. Node detail: ancestors, prerequisite Newton laws, the paper question,
  2 citations. Bad / foreign node id → 404. ai_calls show classify_source / tag_topics on nano,
  build_knowledge_map on ultra. Marking unit checks (16 cases) pass. check-access passes. Build +
  oxlint 0 errors. UI (headless Chromium): map light desktop, node detail dark, prerequisites graph
  mobile, exam dialog mobile dark; no page errors, no horizontal page scroll.

### 3. Self-checked practice question generation ✅
- DB: `bank_questions` (notebook, node_ids UUID[] + GIN index, exam_type, format id, type, difficulty,
  stem, options, answer JSONB, solution, citations, expected_seconds, marks, negative, verified,
  verification {status, attempts, solverAnswer, reasons, history[]}, quality_flags, hidden,
  created_by); `question_reports` (question, user, reason, note). Queries in `db/questionBank.js`.
- `services/questionGen.js`: `profileFor` (course profile, else University), `pickFormats` (requested
  formats in turn, else the mock pattern's mix by largest remainder), one Super generation call for
  all slots, `normaliseQuestion` (validators; MCQ options shuffled and re-lettered A-D; numeric
  tolerance capped at 5%, integer formats exact; rubric scaled to the format's marks; invalid [n]
  stripped; citations = passages cited), `selfCheck` (separate Super call, `task: self_check`, sees
  only stem/options/passages; descriptive → rubric support check ≥ 80% of marks), `compareAnswer`,
  regeneration of one slot with the rejection reason (≤ 2 retries), concurrency 4. Rejected
  questions are stored hidden (verified false); questions that never validated are discarded.
- `services/questionJobs.js`: in-memory jobs (≤ 2 running per user, 1 h TTL) → insert → verified ids.
- Routes `routes/questions.routes.js`: generate (members; nodes must be on the course map; count
  1-15; formats must belong to the profile), job polling (owner of the job only), bank list (no keys),
  `GET /api/questions/:id` (`?reveal=1` adds key/solution/verification), report (hides + logs).
- Frontend: `remark-math`, `rehype-katex`, `katex` (CSS imported in Markdown.jsx); `MathText` inline
  renderer for options/explanations (quiz player too); long display equations scroll inside their
  block. Practice gets an "Exam practice" tab (default): header card, New questions → dialog
  (NodePicker by chapter with mastery dots and weights, 5/10/15, difficulty, formats), job progress
  bar, bank list (type, difficulty, marks with negative, ~time, node, "self-checked"), expand →
  `QuestionBody` (all six types) + Show answer & solution (key highlighted, rubric, cited solution),
  Report a problem dialog. Map → Practise this opens the generator for that node.
- Tested (curl, mock AI; the mock keeps each generated key and its solver answers from the stem,
  deliberately returning malformed items and wrong solves): input validation (no nodes, count 16,
  descriptive format on JEE Main, foreign node → 400); a 6-question JEE Main job → 6 verified, with
  slot 2 rejected first by validators ("needs exactly 4 options", "options are not distinct") and
  slot 3/6 rejected first by the solver, both regenerated and verified; a node whose question the
  solver always gets wrong → discarded after 3 attempts (stored hidden, verified false, 3-entry
  history); JEE Advanced single/multi(A,C)/integer(35, exact)/matching all verified with marks
  3/−1, 4/−2, 4/0, 3/−1; University one-word, 2- and 5-mark descriptive (rubric 2/2/1 scaled to
  1/1/0.5 for 2 marks); numerical without a unit → "unit missing" then fixed; a non-integer integer
  answer → "answer must be an integer" (discarded). Validator unit cases: correct option text in the
  stem, unparseable number, "the answer is 5 m" + invalid citation, MSQ with no correct option, MCQ
  with 2 correct; `pickFormats` JEE Main 5 → 4 MCQ + 1 numerical; numeric compare within tolerance.
  List hides keys; reveal shows key + solution with [99] stripped; bad report reason → 400; report →
  hidden for everyone, flag `reported_wrong_key`, stats reported 1. ai_calls show
  generate_questions / self_check on super. check-access: outsider 404 on list, generate, question,
  report; viewer can read a question. Build + oxlint 0 errors. UI: bank with revealed numerical
  question rendering LaTeX + cited solution (light), generator dialog from the map (mobile dark).

## Earlier upgrade (done)

Turning CourseMate AI into a study and exam-prep app for college courses (10 stages, built in order;
each stage is verified, committed and pushed before the next).

| # | Stage | Status |
|---|-------|--------|
| 1 | Courses with units | ✅ done |
| 2 | Page and slide citations | ✅ done |
| 3 | Spaced-repetition flashcards | ✅ done |
| 4 | Quizzes, graded answers, weak topics | ✅ done |
| 5 | Past-paper analysis | ✅ done |
| 6 | Exam mode, revision plans, daily goal, streaks | ✅ done |
| 7 | Explain-it-back and Indian languages | ✅ done |
| 8 | Image OCR and lecture transcription | ✅ done |
| 9 | Shared courses and quiz battles | ✅ done |
| 10 | New visual identity, privacy settings, license | ✅ done |

## How verification is done

No real AI provider was available on the build machine, so every stage is verified against a
local test harness (kept outside the repo, in the session scratchpad — rebuild it if it's gone):

- **Database:** a throwaway PostgreSQL cluster (`embedded-postgres` 17 for stages 1–3; from stage 4
  a scratch `initdb` of the machine's PostgreSQL 16 on port 55432, UTF-8) — the real server, so
  `schema.sql` migrations run exactly as they would for you, including upgrading a database that
  already holds data from earlier stages.
- **AI:** a small mock of an OpenAI-compatible API (chat, streaming, vision, embeddings, audio
  transcriptions) returning canned JSON per feature. This proves routing, parsing, validation, storage and citations end to end,
  but **not the quality of real model output** — run `npm run check-api` and try each feature with
  your own provider.
- Backend started with `npm run dev` (boots + migrates), `npm run check-api` against the mock,
  `node --check` on changed files; frontend `npm run build` and `npx oxlint src` (0 errors; the
  warnings are the existing `set-state-in-effect` / ref patterns); UI checked in headless Chromium
  (Playwright) in light, dark and mobile.
- WSL notes: `frontend/node_modules` was installed from Windows (no Linux rolldown/oxlint
  bindings), so the frontend is built and linted from a Linux copy (`npm ci` in the scratchpad).
  `node --watch` doesn't see edits on `/mnt/d`, so the backend is restarted by hand. The working
  tree had CRLF line endings while commits are LF; files were normalised to LF (no content change).

## Stage notes

### 1. Courses with units ✅
- DB: `units` (id, notebook_id → notebooks CASCADE, title, position, created_at); `sources.unit_id`
  → units ON DELETE SET NULL (no unit = "General").
- API: `GET/POST /api/notebooks/:id/units`, `PATCH/DELETE /api/notebooks/:id/units/:unitId`,
  `PUT /api/notebooks/:id/units/order`; `unitId` on all three source-create routes and on
  `PATCH /api/sources/:id` (move; `null`/`"general"` = General); chat takes `unitIds`
  (`"general"` allowed). Shared request helpers in `backend/src/routes/helpers.js`.
- Setting: `MAX_UNITS_PER_NOTEBOOK` (default 50).
- UI: "course" wording everywhere user-facing; sources grouped under collapsible unit headers
  (per-unit select-all, menu: add sources here / rename / move up / move down / delete);
  "Move to unit" on each source; unit picker in Add sources; scope selector above the chat input.
  `vite.config.js` accepts `BACKEND_URL` to proxy to a backend on another port.
- Tested (curl): create/rename/reorder/delete units; blank title → 400; bad order payload → 400;
  sources added to units (text + multipart file with `unitId`); unknown unit → 400; move source to a
  unit and back to General; chat scoped to one unit cited only that unit's source, scoped to
  `general` cited only the unit-less source; bad `unitIds` → 400; deleting a unit moved its sources
  to General; another user got 404 on every unit route and on moving a source; signed out → 401.
  Existing database (from before this stage) migrated without data loss. UI: units grouped, scope
  menu lists units with counts, no page errors.

### 2. Page and slide citations ✅
- Extraction (`services/ingestion.js`) returns labelled segments: PDF pages via pdf-parse's per-page
  hook (uploads and PDF links), PPTX slides. `assembleSegments` joins them into the normalised text
  and records `sources.locations` `[{label, start, end}]`; `chunks.location` is computed per chunk
  ("p. 12", "pp. 12–13", "Slide 4", "Slides 4–6"). Citations carry `location`, and the model sees
  it in each passage header.
- Originals: uploads are now kept in `ORIGINALS_DIR` (default `<UPLOAD_DIR>/originals`, new
  setting) as `<sourceId>.<ext>` and deleted with the source/course. `POST /api/sources/:id/reprocess`
  re-extracts from the original, re-fetches links, recovers slides of old PPTX sources from their
  stored "Slide N" headings, and re-chunks pasted text. Old *uploaded* PDFs (no original kept) get a
  clear 409 asking to re-upload. A failed re-process keeps the source usable and records the error.
  Concurrent re-process requests: only one starts (atomic claim).
- UI: location badge in citation popovers and the viewer header; page/slide markers in the source
  viewer; "Re-process" in each source's menu and a hint in the viewer for paged sources without
  page numbers.
- Tested (curl): 3-page PDF upload + PDF link → 3 page locations; PPTX → 3 slide locations; chunk
  rows carry locations; chat citations show "p. 3", "Slides 1–3". Sources created by the Stage 1
  build (no locations), after migration: PPTX re-process recovered slides, PDF-link re-process gained
  pages, uploaded PDF → 409 with message; 3 concurrent re-process calls → one 202 + two 409; other
  user → 404; deleting a source removed its stored original. UI: chip label/popover/viewer show
  "p. 3", markers p. 1–3 rendered, highlighted passage scrolled into view.
- Note: the Stage 2 code commit went out before these doc updates (a script error); the docs
  follow in a separate commit.

### 3. Spaced-repetition flashcards ✅
- DB: `decks` (notebook, unit nullable, title, created_by), `cards` (front, back, topic, source_id,
  location, quote, position), per-user `card_reviews` (ease 2.5, interval_days, repetitions, due_at,
  last_reviewed_at, lapses), `review_log` (every rating; feeds the new-card cap and, later, daily
  activity). Queries in `backend/src/db/study.js`; course-access SQL is centralised in
  `backend/src/db/access.js` (Stage 9 switches it to membership).
- SM-2 (`services/srs.js`): again → 10 min, back to start (lapse + ease −0.2 only for learned
  cards); hard/good/easy = SM-2 quality 3/4/5 with ×1.2 / ×ease / ×ease×1.3 intervals; first
  intervals 1d (easy 4d), second 6d (hard 3d, easy 8d). Previews returned with each queued card.
- Generation (`services/flashcards.js` + shared `services/studyContext.js`): numbered passages
  sampled evenly from the chosen sources → `completeJson` → validated (empty/duplicate cards
  dropped, lengths capped, bad passage numbers resolved by word overlap) → each card cites its
  source, page/slide and quote.
- New setting `NEW_CARDS_PER_DAY` (default 20, per user per course, in the user's timezone via the
  `X-Timezone` header validated against `pg_timezone_names`).
- UI: Chat / Study switch in the course header (and mobile nav) with an "N due" badge; Study area
  with due summary, deck list, generate dialog (units, 10/20/30, difficulty), deck editor
  (add/edit/delete cards, rename, unit, citations), review screen (flip, 4 ratings with next
  interval, keys 1–4 / Space / Esc, "again" cards return in-session, completion summary).
- Tested: SM-2 traces (good→1d→6d→15d, hard, again lapses, easy) and previews; generate with bad
  count/difficulty → 400; unit-scoped deck (all cards cite unit sources), course deck cards cite
  p. 1–3; model duplicates/empty cards dropped, invalid passage number resolved; manual deck + card
  CRUD with length validation; deck list counts; queue capped at 20 new → 17 after 3 reviews;
  forced-due card returns first with previews; deck from another course → 404; second user → 404 on
  deck/card/review/edit/delete. UI: badge, review via Space + "3" (18 → 17 left), editor, generate
  dialog, mobile dark layout.

### 4. Quizzes, graded answers, weak topics ✅
- DB: `topics` (per unit; `unit_id` NULL = General) + `topic_sets` (source fingerprint, status) —
  re-extracted when a unit's sources change (ingest, move, delete, unit delete), names that survive
  keep their id. `quizzes`, `quiz_questions` (4 options, answer, explanation, topic, source +
  location + quote), `quiz_attempts`, `quiz_answers` (correct, time_ms), `answer_attempts`
  (marks, score, feedback JSON, citations, topic, origin), `topic_events` (user, topic, kind, score,
  weight); `cards.topic_id`. Queries in `backend/src/db/practice.js`.
- Services: `topics.js` (extraction 5–15/unit, debounced refresh, `matchTopic` preferring the
  passage's unit, mastery = recency-weighted average), `quizzes.js` (validated MCQs, options
  shuffled, answer as index/letter/text), `grading.js` (written questions per 2/5/10 marks; grading
  with MMR retrieval → score clamped to half marks, points with valid passage numbers only, model
  answer with invalid `[n]` stripped). Routes in `routes/practice.routes.js`.
- Mastery evidence: quiz answer weight 1, flashcard rating 0.5 (again 0 / hard .6 / good .85 /
  easy 1), graded answer weight 1/2/3 for 2/5/10 marks (score = marks awarded / marks).
- UI: course tabs Chat / Study / Practice / Progress (mobile bottom nav has all five). Practice:
  quiz list, new-quiz dialog (units, 5/10/15/20, difficulty), quiz player (one question at a time,
  instant feedback with explanation + citation, results by topic, retake), Answer writing (marks,
  units, suggest questions, word count, graded result with cited points and model answer, past
  answers). Progress: units with mastery bars, topics weakest first, "Revise these today" with Quiz
  me / Flashcards / Ask in chat (and "Quiz me on all").
- Fix during verification: flashcard ratings were matched to a topic by name across the whole
  course, so units sharing a topic name could credit the wrong unit → cards now store `topic_id`
  (and quiz/grade/card topic matching prefers the unit of the cited passage).
- Tested (curl, on a database created with the Stage 3 schema): topics extracted for 2 units +
  General automatically after ingestion (model duplicate dropped); quiz bad count/difficulty/unit →
  400; unit-scoped quiz cites only that unit's source, no answers leaked before answering, malformed
  model question dropped; answer → correct/explanation/citation, duplicate answer 409, chosenIndex 4
  → 400, review before finish 409, finish → score 1/5 + per-topic results + total time, answer after
  finish 409; written questions (bad marks/count → 400) tagged with topics; grading: empty/missing/
  12k+ answer → 400, score 3.2 → 3 (half marks), invalid passage numbers [42]/99 stripped; deck on a
  topic → all cards tagged; flashcard rating credited to the deck unit's topic (also after editing
  the card's topic); progress mastery 0.42 = (2×0.6 + 0.85×1×0)/(2.85) as expected; second user →
  404 on quiz, attempt, finish, answers, topics, progress, quiz creation. `check-api` OK. UI:
  Practice, quiz player, Answer writing, Progress (light, dark, mobile), no page errors.

### 5. Past-paper analysis ✅
- DB: `sources.kind` (material | past_paper, default material), `exam_name`, `exam_year`,
  `paper_status` (pending | ready | error), `paper_error`; `past_paper_questions` (number, text,
  marks, year, section, unit, topic, similarity, citations JSONB). Queries in `db/pastPapers.js`.
- Service `services/pastPapers.js`: extraction (`completeJson` per ~14k-char window; text ≥ 8
  chars, deduped, marks/year validated, ≤ 200 questions; year from the paper if the user gave
  none), mapping (question embeddings vs. material chunks → top 3 citations + similarity-weighted
  unit vote; topic candidates = top 5 by embedding similarity +0.1 for the voted unit → model picks
  a letter or null in batches of 15; invalid/missing answers fall back to the best candidate;
  below 0.2 similarity and no topic → unplaced), one run per source, insights aggregation, and
  `topicExamWeight()` for Stage 6 plans. Routes `routes/pastPapers.routes.js` + `/sources/:id/analyse`.
- Past papers are excluded from chat (unless `includePastPapers`), quizzes, decks, grading,
  topics and the course overview; analysed automatically after ingest, re-process, or being
  marked as a past paper; marking as material deletes its questions.
- UI: Add sources has "Course material / Past exam papers" + exam name + year; past-paper badge
  and analysis status on sources, "Mark as past paper / course material", "Find questions again";
  scope menu "Include past papers"; new "Exam insights" view (papers, most examined topics, by
  unit, filterable questions with "Answer in" citations, Change topic, Practise this question →
  Answer writing with marks rounded to 2/5/10 and origin past_paper).
- Tested (curl, on the Stage 4 database): bad kind / year / exam name → 400; text paper (unit 1)
  and multipart file paper (kind, examYear, examName fields) → analysed to ready; 4 + 2 questions
  (model duplicate and too-short item dropped), marks/sections/years kept, year 2023 detected from
  the paper text and saved; topic confirmation: model null → unmapped, invalid letter → best
  candidate; each question has 3 citations; insights ranking (Carnot 2 questions/7 marks first);
  filters by year/unit/topic/general, bad filters → 400; chat without the flag cited only material,
  with `includePastPapers` cited the papers too; adding papers didn't re-extract topics; analyse a
  material source → 409, analyse twice at once → 202 then 409; paper → material deleted its
  questions, back to past paper (year 2021) re-analysed; manual topic fix sets the topic's unit, bad
  topic → 400, unknown question → 404; second user → 404 on insights, questions, patch, analyse,
  kind change. Fresh database migrates (twice). UI: insights (light/dark/mobile), topic filter,
  practise → Answer writing prefilled, scope menu, Add sources past-paper fields, source badges.

### 6. Exam mode, revision plans, daily goal, streaks ✅
- DB: `exams` (notebook, user, name, exam_date DATE, unit_ids, plan_generated_at),
  `exam_plan_items` (date, position, task_type read|flashcards|quiz|answer|past_paper, unit, topic,
  title, details, target_count, done, done_at), `user_activity` (user, day, kind, count),
  `users.daily_goal` (default 20). DATE columns are returned as strings (type parser in `pool.js`).
  Queries in `db/exams.js`.
- `services/examPlan.js`: `planDays`, `prioritise`, pure `layoutPlan` (see README), model ordering
  + tips with validation/fallback, `generatePlan` (keeps done tasks), `replanMissed` (missed tasks
  → least busy remaining days; stale flashcard sessions dropped). `services/today.js`: streaks
  (current/best) and the Today summary. Routes in `routes/exams.routes.js`.
- Activity is recorded on card review, quiz answer, graded answer and chat question.
- UI: Home opens on "Today" (goal ring + change goal dialog, streak, last 7 days, next exam with
  countdown and tickable tasks, flashcards due per course → opens the course's Study); course tab
  "Exams" = Revision plan (add/edit/delete exam, countdown, progress, missed banner + re-plan,
  regenerate, days grouped with Today highlighted, Start buttons: read → ask chat, flashcards →
  Study, quiz → quiz on the topic (or mixed quiz on the exam units), answer → Answer writing,
  past paper → Past papers filtered to the topic) | Past papers (Stage 5 insights).
  `#/notebook/<id>?view=study|exams|…` opens a tool directly.
- Fixes during verification: an exam today put 17 topic tasks on one day → cap of 8 per day and
  quizzes-only cram mode for ≤ 2 days; Today's 7-day bars had no height (percentage inside an
  auto-height flex child).
- Tested (curl + unit checks of the pure planner): exam validation (no name, past date, 30 Feb,
  > 2 years, foreign unit → 400); 10-day plan: days today..day before exam, flashcards daily,
  model order with invalid/duplicate numbers ignored and tips applied, final mixed quiz; tick
  (bad body → 400); plan shifted 2 days back → 8 missed → re-plan moved 8 to the lightest days,
  stale flashcards removed, done task kept; regenerate keeps done tasks; exam today → one-day plan
  with unit-B topics only; edit/delete; layouts for 1/2/3/30 days (≤ 8 tasks/day, all topics covered
  for 30), 90-day cap for far exams; Today: streak current 3 / best 4 from seeded history (today
  not met), real actions counted by kind (12 cards, 5 quiz, 1 answer, 1 chat), goal 10 → today
  met → streak 4; goal 0 / 2.5 → 400; second user → 404 on exam, plan, item, course exams, and an
  empty Today. Fresh database migrates (twice). UI: Home Today (light, mobile dark), plan view,
  Start quiz from the plan, Past papers tab.

### 7. Explain-it-back and Indian languages ✅
- DB: `explanations` (notebook, user, topic, prompt, explanation, clarity 0-10, accuracy 0-10,
  feedback JSON {summary, correctPoints, gaps, misconceptions, followUp}, citations, unit_ids),
  `users.preferences` JSONB, `course_preferences` (user, notebook, preferences). Queries in
  `db/practice.js` and `db/preferences.js`.
- `services/explain.js` (MMR retrieval on the prompt + explanation, validated points with valid
  passage numbers only, scores 0-10, accuracy estimated from the points when missing; topic event
  kind `explain`, weight 1.5, score accuracy/10; activity `explain`). Routes in
  `routes/practice.routes.js`.
- `services/language.js`: 12 languages, `languageFrom`, `responseLanguage(user, course)` (course
  override → user setting → English), `languageInstruction` (full or bilingual; keeps formulas,
  symbols, units, proper nouns, `[n]` citations and JSON keys). `llm.js` `withLanguage()` is applied
  by `complete`, `completeJson` and `streamCompletion` when a `language` option is passed; every
  route that calls the AI resolves and passes it (chat, guide + overview on add/re-process, deck,
  quiz, written questions, grading, explanation, plan). Topic extraction and past-paper
  extraction/mapping deliberately get none.
- New shared helper `firstNumber()` in `studyContext.js`: model numbers like "7/10", "3/5", "1-2",
  "Passage 3" were parsed by stripping non-digits (→ 710, 35, 12) — a "3/5" grade would have been
  full marks. Now the first number is used everywhere (grading, explain, plan order, past-paper
  marks/years/answers, passage numbers).
- UI: Practice tab "Explain it back" (topic picker grouped by unit or free prompt, explanation,
  clarity/accuracy chips, cited points, follow-up → "Explain this next", history); Progress topic
  menu "Explain it back"; Settings page (`#/settings`, account menu → Settings) with response
  language + bilingual and daily goal; course header 文A button → language for this course
  ("Use my default (…)" or a language).
- Tested (curl): explanation validation (no topic/prompt, < 20 chars, bad / foreign topic, > 8000
  chars → 400); with a topic → clarity "7/10" → 7, accuracy 6.4 → 6, invalid passage numbers
  dropped, follow-up, unit = the topic's unit; free prompt → topic matched; topic events (explain,
  0.6, 1.5) and activity counted; second user → 404 on get/delete/list/create. Settings: defaults
  (en), bad language / bilingual / null → 400; user hi + bilingual; course override ta → GET shows
  effective Tamil; second user → 404 on course preferences. With the override, the mock's request
  log showed the Tamil instruction on chat (stream), quiz, written questions, grading, flashcards,
  explain, plan, source guide and course overview, and none on topic extraction; clearing the
  override → Hindi bilingual instruction; English → no instruction. Fresh database migrates
  (twice). UI: explain form + result, course language dialog, Settings (mobile dark).

### 8. Image OCR and lecture transcription ✅
- Accepted uploads: + `.png .jpg .jpeg .webp` and `.mp3 .m4a .wav .webm .ogg .mp4 .mov .mkv`
  (multer filter + Add sources). DB: `sources.progress_note` (what a slow step is doing).
- `services/media.js` (ffmpeg via `ffmpeg-static` or `FFMPEG_PATH`: image downscaling, raw PDF page
  pixels → JPEG, audio extraction/compression/splitting with a CSV segment list, timestamps),
  `services/ocr.js` (vision prompt; images; scanned PDF pages: pages with < 40 non-space chars get
  their largest image decoded by pdf-parse's bundled pdf.js — no canvas needed — up to
  `VISION_MAX_PAGES`), `services/transcription.js` (POST `/audio/transcriptions` verbose_json per
  piece, retries 429/5xx, clear errors per status, segments offset by piece start, grouped into
  ~45 s paragraphs labelled "12:34"). `llm.js` `completeVision()` = LangChain ChatOpenAI with the
  `VISION_*` settings. `processSource` passes `onProgress(fraction, note)` to loaders (10–29%,
  note shown under the progress bar). PDF links get scanned-page OCR too. A mixed PDF whose OCR
  fails keeps its text pages; a fully scanned one fails with the reason.
- `GET /api/sources/:id/original` serves image/audio/video originals (owner only, Range support,
  nosniff + sandbox CSP); `/health` adds `visionModel`, `transcribeModel`, `uploadMaxMb`.
- New settings: `VISION_BASE_URL`, `VISION_API_KEY`, `VISION_MODEL` (default: chat settings),
  `VISION_MAX_PAGES` (60), `TRANSCRIBE_BASE_URL`, `TRANSCRIBE_API_KEY` (default: chat ones),
  `TRANSCRIBE_MODEL` (whisper-1), `TRANSCRIBE_MAX_MB` (24), `FFMPEG_PATH`.
- UI: upload progress bar (XHR) and the server's size limit in Add sources; image / mic / video
  icons; progress note under processing sources; viewer shows the image beside the text (stacked
  when narrow) or a sticky audio/video player, timestamp markers seek and play, a cited timestamp
  opens the recording at that moment.
- Tested (curl, on the Stage 7 database — migration kept its data): small PNG sent as PNG data URL,
  16 MB PNG re-encoded to JPEG; 2-page scanned PDF (generated, JPEG pages, no text) → 2 OCR calls,
  locations p. 1 / p. 2; 5-min M4A with `TRANSCRIBE_MAX_MB=0.5` → 3 pieces (~111 s), labels 0:00,
  1:05, 1:51, 2:56, 3:42, 4:47 (offsets correct); MP4 transcribed from its audio track; video with no
  audio → "This recording has no audio track."; non-audio .mp3 → "no audio that can be read"; .gif
  → 400 listing types; vision provider 400 → image error naming VISION_MODEL / VISION_BASE_URL,
  scanned PDF → "scanned (no text layer)…" + reason; re-process of a recording shows "Extracting
  audio…"; chat citations carry `0:00` / `pp. 1–2`; original route: PNG 200 image/png, M4A Range →
  206, PDF / text source → 404, other user → 404, signed out → 401. `check-api` OK. UI (headless
  Chromium): image beside text, audio player + clicking 1:05 seeks to 1:05 (dark), Add sources
  dialog, mobile dark video viewer; no page errors.
- Not tested against real providers (vision/transcription quality, provider-specific limits).

### 9. Shared courses and quiz battles ✅
- DB: `notebook_members` (owner/editor/viewer; backfilled: each course's creator → owner),
  `notebook_invites` (email, role, sha256 token hash, expires_at, accepted_at; one open invite per
  course+email), `messages.user_id` (backfilled to the owner; chat history personal),
  `source_deselections` (per-user chat selection; previously unticked sources migrated to the
  owner, then `sources.selected` reset), `battles` + `battle_players`. Queries: `db/members.js`,
  `db/battles.js`; `db/access.js` `canAccessNotebook` now = membership, plus `memberRoleSql`,
  `roleAtLeast`.
- Access: `getNotebook`/`getSource`/`getDeck`/`getCard` return the user's `role`; `requireRole()` /
  `assertRole()` in `routes/helpers.js`. Editor+: course rename/overview, units, add/edit/delete/
  reprocess/analyse sources (upload guard runs before multer), decks + cards, topic refresh,
  past-paper question fixes. Owner: invites, roles, removing members, deleting the course. Any
  member: read, chat, own selection, reviews, quizzes, answers, explanations, exams, preferences,
  battles. Personal data stays filtered by user id.
- Invites (`routes/members.routes.js`): existing account → added immediately (+ notice email);
  otherwise invite + link `#/invite/<token>`; emailed via the existing mailer (`sendCourseInvite`),
  printed to the console and returned to the owner when SMTP isn't set. Applied at sign-up / sign-in
  (password, email code, Google — verified emails only) and via the link (invited email only).
  New settings `MAX_MEMBERS_PER_COURSE` (50), `INVITE_TTL_DAYS` (14), `MAX_BATTLE_PLAYERS` (30).
- Battles (`services/battles.js`, in memory): 6-char codes (no 0/O/1/I), lobby → start (host) →
  question (`seconds`, closes early when all answered) → 5 s reveal → … → finished (saved, activity
  "quiz" + topic events per answer). Points: 500 + up to 500 for speed. Answers and the current
  question's points are hidden until the reveal. Lobbies expire after 30 min, results stay 15 min;
  max 2 live battles per host. SSE `GET /api/battles/:code/events` (personalised snapshots, 20 s
  pings). Only members of the battle's course can see/join it (others: 404).
- `npm run check-access` (`scripts/checkAccess.js`): creates owner/editor/viewer/outsider accounts,
  starts the app on a random port, runs 46 checks (outsider 404 on every course/source/deck route
  and missing from the list; viewer 403 on 13 edit routes + file upload, personal selection;
  editor allowed on sources/units/decks, 403 on invites/delete/remove; owner can't leave; viewer
  leaves → 404; signed out 401), deletes the accounts.
- UI: Share dialog (owner: invite by email + role, copyable link when not emailed, change role,
  remove, cancel invites; others: member list + Leave), header Share / people button and "Shared by"
  chip, read-only title/sources/decks/insights for viewers, Home course cards with people count and
  "Shared by", Leave course in the card menu, "Join a battle" (code dialog), invite page, Practice →
  Battles (create, happening now with join/rejoin, past battles), battle page (lobby with big code,
  timed question with keys 1–4, locked-in state, reveal with explanation + source location, live
  leaderboard, results with your answers).
- Tested: `check-access` all pass; curl: invite of a new email (mixed case) → link, existing user →
  added as viewer; wrong account accepting the link → 403, bad token → 404; the invited email signs
  up → member with role editor; viewer chat stored only in their history, clearing it left the
  owner's; viewer quiz personal; deselection migration (owner only); battle: bad count/seconds →
  400, outsider join/events → 404, lowercase code works, non-host start → 403, answer before start
  → 409, duplicate answer → 409, early reveal when all answered, speed points (997/998), SSE stream
  lobby→question→reveal×5→finished, results saved with ranks, activity + 11 topic events recorded,
  past battles listed, outsider → 404. Fix during verification: the leaderboard showed the current
  question's points before the reveal (gave answers away) → hidden until reveal (re-tested).
  UI (headless Chromium): Share dialog, viewer course (dark), invite page with wrong account
  (mobile), lobby (host, dark), question after pressing 1 (mobile), reveal + leaderboard (dark);
  no page errors.

### 10. Own identity and polish ✅
- Palette (CSS variables in `src/index.css`): warm paper + ink with a deep green accent (light),
  slate-green night mode (dark), new `--gold` (streaks/wins) and `--sidebar` tokens, `shadow-card`;
  buttons/inputs/segmented controls are rounded rectangles instead of pills. Type: DM Sans (UI) +
  Fraunces (headings) + JetBrains Mono. New logo/favicon (`public/favicon.svg`: open book + spark).
  Reduced-motion support.
- Layout: course page = left sidebar (logo, course card with editable title / sharing info, tools:
  Chat, Study, Practice, Exam plan, Exam insights, Progress; then Units & sources), main area with a
  breadcrumb header and the selected tool, source viewer as a slide-over (`SlideOver` in ui.jsx;
  Escape/backdrop closes). Mobile: sidebar as a drawer, bottom bar (Units, Chat, Study, Practice,
  Exams, Progress), full-width viewer. Home: date + greeting, Today first, "Join a battle" in the
  header, course cards with a coloured spine and emoji tile. Sign-in: study-focused hero, card
  illustration, six feature cards (flashcards, graded practice, past papers, plan, lectures/notes,
  Indian languages).
- Settings → "AI & privacy": chat, embeddings, vision and transcription models with their host or
  "on this computer" (from `/health` `ai`, built by `aiSummary()` in config; never keys) and a note
  on local models. README: new intro, "Any AI provider — or fully local" (Ollama / LM Studio /
  LocalAI per job), design bullet, license section.
- MIT `LICENSE` (2026 Raghav Biyani), backend package licence → MIT; `.claude/` untracked
  (`git rm -r --cached`, kept locally) and ignored; NotebookLM references removed from code/docs.
- Tested: `/health` `ai` with mock (all local) and with Ollama-style URLs (local=true, host
  localhost); no key values in `/health`; `check-api`, `check-access` pass; build + oxlint (0 errors;
  the remaining warnings are the existing set-state-in-effect / ref patterns). Headless Chromium:
  sign-in (light desktop, dark mobile), Home (light full page, dark, dark mobile), course Chat
  (light/dark), slide-over viewer with audio (dark), Study, Practice (dark), Exam plan, Exam
  insights (dark), Progress, Settings with AI & privacy, mobile chat / drawer (dark) / viewer /
  Study (dark); no page errors.

## Notes for whoever continues
- All 10 stages are done. Real-provider testing (output quality, vision/transcription limits) was
  not possible here — everything AI-facing was verified against the mock.
- `ffmpeg-static` downloads an ffmpeg binary for the OS that ran `npm install`. It was installed from
  WSL (Linux binary); if the backend runs on Windows, run `npm rebuild ffmpeg-static` (or set
  `FFMPEG_PATH`).
- Quiz battles live in one backend process's memory (see README).
