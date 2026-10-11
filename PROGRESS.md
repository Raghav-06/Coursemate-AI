# CourseMate AI upgrade — progress

Turning CourseMate AI into a study and exam-prep app for college courses (10 stages, built in order;
each stage is verified, committed and pushed before the next). This file is the checklist for
resuming the work in a new conversation.

| # | Stage | Status |
|---|-------|--------|
| 1 | Courses with units | ✅ done |
| 2 | Page and slide citations | ✅ done |
| 3 | Spaced-repetition flashcards | ⏳ next |
| 4 | Quizzes, graded answers, weak topics | — |
| 5 | Past-paper analysis | — |
| 6 | Exam mode, revision plans, daily goal, streaks | — |
| 7 | Explain-it-back and Indian languages | — |
| 8 | Image OCR and lecture transcription | — |
| 9 | Shared courses and quiz battles | — |
| 10 | New visual identity, privacy settings, license | — |

## How verification is done

No real AI provider or PostgreSQL service was available on the build machine, so every stage is
verified against a local test harness (kept outside the repo):

- **Database:** a throwaway PostgreSQL 17 (`embedded-postgres`, UTF-8) — the real server, so
  `schema.sql` migrations run exactly as they would for you, including upgrading a database that
  already holds data from earlier stages.
- **AI:** a small mock of an OpenAI-compatible API (chat, streaming, embeddings) returning canned
  JSON per feature. This proves routing, parsing, validation, storage and citations end to end,
  but **not the quality of real model output** — run `npm run check-api` and try each feature with
  your own provider.
- Backend started with `npm run dev` (boots + migrates), `npm run check-api` against the mock,
  `node --check` on changed files; frontend `npm run build` and `npx oxlint src` (0 errors; the 15
  warnings are pre-existing patterns); UI checked in a headless browser.

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
