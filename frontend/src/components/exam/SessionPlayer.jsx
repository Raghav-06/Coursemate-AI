import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { ConfirmDialog, Icon, IconButton, Spinner } from "../ui";
import Markdown from "../Markdown";
import QuestionBody from "./QuestionBody";
import SessionResults from "./SessionResults";
import { fmtTime } from "./sessionResultsUtils";
import DiagnosisCard from "../mistakes/DiagnosisCard";
import { ADVICE } from "../mistakes/categories";
import { toast } from "../uiUtils";
import { TYPE_LABEL, marksLabel } from "./questionUtils";

const POLL_MS = 2000;
const SAVE_DELAY_MS = 600;
const CONFIDENCE = [
  ["sure", "Sure"],
  ["unsure", "Unsure"],
  ["guess", "Guess"],
];

function Clock({ seconds, timed }) {
  if (!timed) return null;
  const low = seconds <= 60;
  return (
    <span className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-xl font-mono text-sm tabular-nums ${low ? "bg-danger/15 text-danger" : "bg-panel-2"}`} aria-live={low ? "polite" : "off"} aria-label="Time left">
      <Icon name="timer" size={18} />
      {fmtTime(seconds).replace("m ", ":").replace("s", "")}
    </span>
  );
}

/**
 * Takes a practice session: preparing → intro → questions (timer, palette,
 * answer, confidence, working) → submit → results. `renderExtra(row)` adds
 * content under each result (the diagnosis).
 */
export default function SessionPlayer({ sessionId, onExit, onOpenCitation, onFinished, onPlaySession }) {
  const [view, setView] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [pos, setPos] = useState(0);
  const [answers, setAnswers] = useState({}); // position → answer row
  const [remaining, setRemaining] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showWorking, setShowWorking] = useState(false);
  const [diagnoses, setDiagnoses] = useState({ diagnosing: false, list: [] });
  const spent = useRef({}); // position → ms
  const enteredAt = useRef(null); // when the current question was opened (set on the first load)
  const saveTimer = useRef(null);
  const pending = useRef({}); // position → body not yet sent
  const clock = useRef(null); // seconds left, as ticked by the test clock below
  const submitRef = useRef(null); // the latest submit (null while one is running), for the clock's time-up

  const setClock = useCallback((seconds) => {
    clock.current = seconds;
    setRemaining(seconds);
  }, []);

  const load = useCallback(
    () =>
      api
        .getSession(sessionId)
        .then(async (v) => {
          enteredAt.current ??= Date.now();
          setView(v);
          setClock(v.remainingSeconds);
          setAnswers(Object.fromEntries(v.answers.map((a) => [a.position, a])));
          for (const a of v.answers) spent.current[a.position] = Math.max(spent.current[a.position] ?? 0, a.timeSpentMs);
          if (v.status === "finished") setResults(await api.sessionResults(sessionId));
        })
        .catch((err) => setError(err.message)),
    [sessionId, setClock]
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (view?.status !== "preparing") return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [view?.status, load]);

  // Diagnoses arrive in the background after a submit (or a wrong drill check).
  const loadDiagnoses = useCallback(
    () => api.sessionDiagnoses(sessionId).then((r) => setDiagnoses({ diagnosing: r.diagnosing, list: r.diagnoses }), () => {}),
    [sessionId]
  );
  const wantDiagnoses = Boolean(results) || Object.values(answers).some((x) => x.locked && x.correct === false);
  useEffect(() => {
    if (wantDiagnoses) loadDiagnoses();
  }, [wantDiagnoses, loadDiagnoses]);
  const stillDiagnosing = diagnoses.diagnosing || diagnoses.list.some((d) => d.status === "pending");
  useEffect(() => {
    if (!wantDiagnoses || !stillDiagnosing) return;
    const t = setInterval(loadDiagnoses, 3000);
    return () => clearInterval(t);
  }, [wantDiagnoses, stillDiagnosing, loadDiagnoses]);
  const diagnosisCard = (position, citations) => {
    const d = diagnoses.list.find((x) => x.position === position);
    if (!d) return null;
    return <DiagnosisCard key={`${d.id}:${d.status}`} diagnosis={d} citations={citations} onOpenCitation={onOpenCitation} onPractise={onPlaySession ? (s) => onPlaySession(s.id) : undefined} advice={ADVICE} />;
  };

  const active = view?.status === "active";
  const timed = Boolean(view?.durationSeconds);

  // Time on the current question.
  const takeTime = useCallback(() => {
    const now = Date.now();
    spent.current[pos] = (spent.current[pos] ?? 0) + (now - enteredAt.current);
    enteredAt.current = now;
    return spent.current[pos];
  }, [pos]);

  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current);
    const entries = Object.entries(pending.current);
    pending.current = {};
    for (const [p, body] of entries) {
      try {
        const saved = await api.saveSessionAnswer(sessionId, Number(p), body);
        setAnswers((a) => ({ ...a, [p]: { ...saved, answer: a[p]?.answer ?? saved.answer, workingText: a[p]?.workingText ?? saved.workingText, confidence: a[p]?.confidence !== undefined ? a[p].confidence : saved.confidence } }));
      } catch (err) {
        if (err.status === 409) load();
        else toast(err.message, "error");
      }
    }
  }, [sessionId, load]);

  // Merges a change into the pending save for a question and (re)schedules the flush.
  // Stable across renders, so the timers and callbacks below always use the current flush.
  const queue = useCallback(
    (position, body, delay = SAVE_DELAY_MS) => {
      pending.current[position] = { ...pending.current[position], ...body };
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, delay);
    },
    [flush]
  );

  const submit = useCallback(async () => {
    setSubmitting(true);
    try {
      queue(pos, { timeSpentMs: Math.round(takeTime()) }, 0);
      await flush();
      setResults(await api.finishSession(sessionId));
      setView((v) => ({ ...v, status: "finished" }));
      onFinished?.();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  }, [sessionId, flush, queue, takeTime, pos, onFinished]);

  useEffect(() => {
    submitRef.current = submitting ? null : submit;
  }, [submit, submitting]);

  // The test clock: ticks locally, submits at zero.
  useEffect(() => {
    if (!active || !timed) return;
    const t = setInterval(() => {
      if (clock.current === null) return;
      setClock(Math.max(0, clock.current - 1));
      if (clock.current === 0) {
        clearInterval(t);
        toast("Time's up — submitting your test");
        submitRef.current?.();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [active, timed, setClock]);

  // Save time spent every 20 s and when leaving.
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => queue(pos, { timeSpentMs: Math.round(takeTime()) }), 20_000);
    return () => clearInterval(t);
  }, [active, pos, takeTime, queue]);

  const go = (next) => {
    queue(pos, { timeSpentMs: Math.round(takeTime()) }, 0);
    setPos(next);
    setShowWorking(false);
  };

  const start = async () => {
    try {
      const v = await api.startSession(sessionId);
      setView(v);
      setClock(v.remainingSeconds);
      enteredAt.current = Date.now();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const check = async () => {
    setChecking(true);
    try {
      queue(pos, {}, 0);
      await flush();
      const saved = await api.saveSessionAnswer(sessionId, pos, { check: true, timeSpentMs: Math.round(takeTime()) });
      setAnswers((a) => ({ ...a, [pos]: saved }));
      setView((v) => ({ ...v, questions: v.questions.map((q) => (q.position === pos ? { ...q, question: { ...q.question, answer: saved.key, solution: saved.solution } } : q)) }));
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setChecking(false);
    }
  };

  const uploadWorking = async (file) => {
    if (!file) return;
    try {
      toast("Reading your working…");
      const saved = await api.uploadWorking(sessionId, pos, file);
      setAnswers((a) => ({ ...a, [pos]: { ...a[pos], workingOcr: saved.workingOcr } }));
      toast("Working attached");
    } catch (err) {
      toast(err.message, "error");
    }
  };

  // ---- Render ----------------------------------------------------------------------

  if (error) {
    return (
      <div className="p-6 flex flex-col items-start gap-3">
        <p className="text-sm text-danger">{error}</p>
        <button type="button" className="btn-outline" onClick={onExit}>
          Back
        </button>
      </div>
    );
  }
  if (!view) return <div className="flex justify-center py-16 text-ink-3"><Spinner className="w-6 h-6" /></div>;

  if (results) {
    return (
      <div className="h-full overflow-y-auto scroll-thin">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
          <SessionResults
            results={results}
            onOpenCitation={onOpenCitation}
            onClose={onExit}
            renderExtra={(row) => diagnosisCard(row.position, row.question.citations)}
            header={
              stillDiagnosing ? (
                <p className="flex items-center gap-2 rounded-xl bg-accent-soft text-accent-soft-fg text-sm px-4 py-3" aria-live="polite">
                  <Spinner /> Diagnosing your mistakes — why each one went wrong and what to fix…
                </p>
              ) : diagnoses.list.length ? (
                <p className="text-sm text-ink-2">
                  {diagnoses.list.length} mistake{diagnoses.list.length === 1 ? "" : "s"} diagnosed — open a question to see why and what to practise.
                </p>
              ) : null
            }
          />
        </div>
      </div>
    );
  }

  if (view.status === "preparing" || view.status === "ready" || view.status === "error" || view.status === "grading") {
    const p = view.preparing;
    return (
      <div className="h-full overflow-y-auto scroll-thin">
        <div className="max-w-xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <IconButton icon="arrow_back" label="Back to practice" onClick={onExit} />
            <h2 className="font-display text-xl font-semibold min-w-0 truncate">{view.title}</h2>
          </div>
          {view.status === "preparing" && (
            <div className="rounded-2xl border border-line p-5 flex flex-col gap-3" aria-live="polite">
              <p className="flex items-center gap-2 text-sm">
                <Spinner /> Preparing questions{p ? ` — ${p.done}/${p.total} ready` : ""}…
              </p>
              <p className="text-xs text-ink-3">Questions the bank doesn't have yet are being written and self-checked. This can take a minute.</p>
              {p && (
                <div className="h-1.5 rounded-full bg-panel-3 overflow-hidden">
                  <div className="h-full bg-accent transition-all" style={{ width: `${Math.max(5, (p.done / p.total) * 100)}%` }} />
                </div>
              )}
            </div>
          )}
          {view.status === "error" && <p className="rounded-xl bg-danger/10 text-danger text-sm px-4 py-3">{view.error}</p>}
          {view.status === "grading" && (
            <p className="flex items-center gap-2 text-sm">
              <Spinner /> Grading…
            </p>
          )}
          {view.status === "ready" && (
            <div className="rounded-3xl border border-line p-6 flex flex-col gap-4">
              <ul className="text-sm text-ink-2 flex flex-col gap-2">
                <li className="flex items-center gap-2">
                  <Icon name="format_list_numbered" size={18} /> {view.questions.length} questions
                </li>
                <li className="flex items-center gap-2">
                  <Icon name="timer" size={18} /> {view.durationSeconds ? `${Math.round(view.durationSeconds / 60)} minutes — submits automatically when time is up` : "Untimed (your time per question is still recorded)"}
                </li>
                <li className="flex items-center gap-2">
                  <Icon name="rule" size={18} /> {view.settings.instantFeedback ? "Check each answer as you go" : "Marked with the exam's scheme when you submit (negative marking included)"}
                </li>
              </ul>
              {view.error && <p className="text-xs text-ink-3">{view.error}</p>}
              <p className="text-xs text-ink-3">Tip: mark how sure you are and jot how you solved it — it helps CourseMate work out why an answer went wrong.</p>
              <button type="button" className="btn-primary self-start h-11 px-6" onClick={start}>
                <Icon name="play_arrow" size={20} /> Start
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Active
  const item = view.questions.find((q) => q.position === pos) ?? view.questions[0];
  const q = item.question;
  const a = answers[item.position] ?? {};
  const locked = a.locked;
  const setAnswer = (answer) => {
    setAnswers((s) => ({ ...s, [item.position]: { ...s[item.position], answer } }));
    queue(item.position, { answer });
  };
  const answered = (p) => {
    const x = answers[p]?.answer;
    return x && (x.choice?.length || String(x.value ?? "").trim() || Object.values(x.pairs ?? {}).some(Boolean) || String(x.text ?? "").trim());
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 sm:px-5 h-14 border-b border-line/60 shrink-0">
        <IconButton icon="close" label="Leave (your answers are saved)" onClick={() => flush().then(onExit)} />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{view.title}</p>
        <Clock seconds={remaining ?? 0} timed={timed} />
        <button type="button" className="btn-primary h-9" onClick={() => setConfirming(true)} disabled={submitting}>
          {submitting ? <Spinner /> : <Icon name="done_all" size={18} />} <span className="max-sm:hidden">Submit</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <nav className="shrink-0 lg:w-56 border-b lg:border-b-0 lg:border-r border-line/60 p-3 overflow-x-auto lg:overflow-y-auto scroll-thin" aria-label="Questions">
          <div className="flex lg:grid lg:grid-cols-5 gap-1.5">
            {view.questions.map((x) => {
              const ax = answers[x.position];
              const tone = ax?.locked ? (ax.correct ? "bg-success text-white" : "bg-danger text-white") : answered(x.position) ? "bg-accent text-accent-fg" : "bg-panel-2 text-ink-2";
              return (
                <button
                  key={x.position}
                  type="button"
                  onClick={() => go(x.position)}
                  aria-current={x.position === item.position ? "true" : undefined}
                  className={`shrink-0 w-9 h-9 rounded-lg text-xs font-semibold tabular-nums ${tone} ${x.position === item.position ? "ring-2 ring-offset-2 ring-offset-panel ring-ink" : ""}`}
                >
                  {x.position + 1}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 flex flex-col gap-5">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
              <span className="font-semibold text-ink">
                Question {item.position + 1} of {view.questions.length}
              </span>
              {item.section && <span>{item.section}</span>}
              <span>{TYPE_LABEL[q.type]}</span>
              <span>{marksLabel(q)}</span>
            </p>
            <QuestionBody question={q} value={a.answer} onChange={setAnswer} disabled={locked} answerKey={locked ? q.answer : null} onOpenCitation={onOpenCitation} />

            {!locked && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-ink-3">How sure are you?</span>
                {CONFIDENCE.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={a.confidence === id}
                    onClick={() => {
                      const next = a.confidence === id ? null : id;
                      setAnswers((s) => ({ ...s, [item.position]: { ...s[item.position], confidence: next } }));
                      queue(item.position, { confidence: next });
                    }}
                    className={`h-8 px-3 rounded-lg border text-sm ${a.confidence === id ? "border-accent bg-accent-soft text-accent-soft-fg" : "border-line hover:bg-panel-2"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <div className="rounded-2xl border border-line">
              <button type="button" className="w-full flex items-center gap-2 px-4 h-11 text-sm text-left" onClick={() => setShowWorking((v) => !v)} aria-expanded={showWorking}>
                <Icon name="draw" size={18} className="text-ink-3" />
                <span className="flex-1">How I solved it <span className="text-ink-3">(optional)</span></span>
                {(a.workingText || a.workingOcr) && <Icon name="check" size={18} className="text-success" />}
                <Icon name={showWorking ? "expand_less" : "expand_more"} size={20} className="text-ink-3" />
              </button>
              {showWorking && (
                <div className="px-4 pb-4 flex flex-col gap-2">
                  <textarea
                    className="input min-h-20"
                    maxLength={4000}
                    placeholder="Key steps, formulas you used…"
                    value={a.workingText ?? ""}
                    disabled={locked}
                    onChange={(e) => {
                      const text = e.target.value;
                      setAnswers((s) => ({ ...s, [item.position]: { ...s[item.position], workingText: text } }));
                      queue(item.position, { workingText: text });
                    }}
                    aria-label="How I solved it"
                  />
                  <label className="btn-outline self-start cursor-pointer">
                    <Icon name="photo_camera" size={18} /> Add a photo of your working
                    <input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" className="sr-only" onChange={(e) => uploadWorking(e.target.files?.[0])} />
                  </label>
                  {a.workingOcr && <p className="text-xs text-ink-3 whitespace-pre-line">Read from your photo: {a.workingOcr}</p>}
                </div>
              )}
            </div>

            {locked && (
              <div className={`rounded-2xl p-4 ${a.correct ? "bg-success/10" : "bg-danger/10"}`}>
                <p className={`font-semibold ${a.correct ? "text-success" : "text-danger"}`}>
                  {a.correct ? "Correct" : "Not quite"} · {a.marks > 0 ? `+${a.marks}` : a.marks} marks
                </p>
                {a.grading?.feedback && <Markdown text={a.grading.feedback} citations={q.citations} onOpenCitation={onOpenCitation} className="text-sm! mt-2" />}
                {q.solution && <Markdown text={q.solution} citations={q.citations} onOpenCitation={onOpenCitation} className="text-sm! mt-2" />}
              </div>
            )}
            {locked && a.correct === false && diagnosisCard(item.position, q.citations)}

            <div className="flex flex-wrap items-center gap-2 pb-6">
              <button type="button" className="btn-ghost" onClick={() => go(item.position - 1)} disabled={item.position === 0}>
                <Icon name="chevron_left" size={20} /> Previous
              </button>
              {view.settings.instantFeedback && !locked && (
                <button type="button" className="btn-outline" onClick={check} disabled={checking || !answered(item.position)}>
                  {checking ? <Spinner /> : <Icon name="fact_check" size={18} />} Check
                </button>
              )}
              <span className="flex-1" />
              {item.position < view.questions.length - 1 ? (
                <button type="button" className="btn-primary" onClick={() => go(item.position + 1)}>
                  Next <Icon name="chevron_right" size={20} />
                </button>
              ) : (
                <button type="button" className="btn-primary" onClick={() => setConfirming(true)}>
                  Submit
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Submit this session?"
        message={`${view.questions.filter((x) => answered(x.position)).length} of ${view.questions.length} answered. Unanswered questions score 0; wrong answers lose marks where the exam has negative marking.`}
        confirmLabel="Submit"
        onConfirm={submit}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
