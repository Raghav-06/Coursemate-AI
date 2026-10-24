import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { Icon, Menu, Spinner } from "../ui";
import Markdown, { MathText } from "../Markdown";
import QuestionBody from "./QuestionBody";
import GenerateQuestionsDialog from "./GenerateQuestionsDialog";
import ReportDialog from "./ReportDialog";
import SessionSetupDialog from "./SessionSetupDialog";
import { timeAgo, toast } from "../uiUtils";
import { TYPE_LABEL, marksLabel } from "./questionUtils";
import { SESSION_TYPES } from "./sessionTypes";

const JOB_POLL_MS = 2000;

function QuestionCard({ question, nodeName, onOpenCitation, onReport }) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(null);
  const [loading, setLoading] = useState(false);
  const reveal = async () => {
    setLoading(true);
    try {
      setRevealed(await api.getQuestion(question.id, true));
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="rounded-2xl border border-line bg-panel">
      <div className="flex items-start gap-3 p-3 pl-4">
        <button type="button" className="flex-1 min-w-0 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-3 mb-1">
            <span className="px-1.5 rounded bg-panel-2 font-semibold text-ink-2">{TYPE_LABEL[question.type]}</span>
            <span>{question.difficulty}</span>
            <span>{marksLabel(question)}</span>
            <span>~{Math.round(question.expectedSeconds / 60) || 1} min</span>
            {nodeName && <span className="truncate max-w-48">{nodeName}</span>}
            <span className="inline-flex items-center gap-0.5 text-success" title="Solved independently and matched the key">
              <Icon name="verified" size={13} /> self-checked
            </span>
          </p>
          {!open && (
            <p className="text-sm text-ink line-clamp-2">
              <MathText text={question.stem} />
            </p>
          )}
        </button>
        <Menu
          items={[
            { label: open ? "Collapse" : "Open", icon: open ? "unfold_less" : "unfold_more", onClick: () => setOpen((o) => !o) },
            { label: "Report a problem", icon: "flag", onClick: () => onReport(question) },
          ]}
        />
      </div>
      {open && (
        <div className="border-t border-line/60 p-4 flex flex-col gap-4">
          <QuestionBody question={question} answerKey={revealed?.answer ?? null} onOpenCitation={onOpenCitation} />
          {revealed ? (
            <div className="rounded-xl bg-panel-2 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-2">Solution</p>
              {revealed.type === "descriptive" && (
                <ul className="mb-3 text-sm list-disc pl-5">
                  {revealed.answer.rubric.map((r) => (
                    <li key={r.point}>
                      {r.point} <span className="text-ink-3">({r.marks})</span>
                    </li>
                  ))}
                </ul>
              )}
              <Markdown text={revealed.solution ?? revealed.answer?.modelAnswer ?? ""} citations={revealed.citations} onOpenCitation={onOpenCitation} />
            </div>
          ) : (
            <button type="button" className="btn-outline self-start" onClick={reveal} disabled={loading}>
              {loading ? <Spinner /> : <Icon name="visibility" size={18} />} Show answer & solution
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Exam practice: self-checked questions in the course's exam pattern,
 * generated for knowledge-map topics. `preset` ({ nodeIds }) opens the
 * generator for those nodes.
 */
const STATUS_LABEL = { preparing: "Preparing", ready: "Not started", active: "In progress", grading: "Grading", finished: "Finished", error: "Failed" };

function SessionRow({ session, onOpen }) {
  const share = session.maxScore ? Math.max(0, session.score) / session.maxScore : null;
  return (
    <button type="button" onClick={() => onOpen(session.id)} className="w-full flex items-center gap-3 p-3 pl-4 rounded-2xl border border-line bg-panel hover:bg-panel-2 text-left">
      <Icon name={SESSION_TYPES.find((t) => t.kind === session.kind)?.icon ?? "quiz"} size={22} className="text-accent shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium truncate">{session.title}</span>
        <span className="block text-xs text-ink-3 truncate">
          {session.questionCount} questions{session.durationSeconds ? ` · ${Math.round(session.durationSeconds / 60)} min` : ""} · {timeAgo(session.createdAt)}
        </span>
      </span>
      {session.status === "finished" ? (
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums ${share >= 0.6 ? "bg-success/15 text-success" : "bg-panel-3 text-ink-2"}`}>
          {session.score}/{session.maxScore}
        </span>
      ) : (
        <span className="text-xs text-ink-3">{STATUS_LABEL[session.status]}</span>
      )}
    </button>
  );
}

export default function ExamPractice({ notebook, onOpenCitation, preset, onPresetUsed, onPlay }) {
  const [map, setMap] = useState(null);
  const [profile, setProfile] = useState(null);
  const [bank, setBank] = useState(null);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(null); // { nodeIds }
  const [job, setJob] = useState(null);
  const [reporting, setReporting] = useState(null);
  const [setup, setSetup] = useState(null); // { kind, nodeIds }
  const [sessions, setSessions] = useState(null);
  const [handledPreset, setHandledPreset] = useState(null);

  const loadBank = useCallback(() => api.listBankQuestions(notebook.id).then(setBank, (err) => setError(err.message)), [notebook.id]);
  useEffect(() => {
    api.knowledgeMap(notebook.id).then(setMap, (err) => setError(err.message));
    api.getExamProfile(notebook.id).then(setProfile, () => {});
    loadBank();
    api.listSessions(notebook.id).then(setSessions, () => setSessions([]));
  }, [notebook.id, loadBank]);

  // A new preset (e.g. "Practise this" on the map) opens its dialog: state is
  // adjusted while rendering, once per preset, instead of in an effect.
  if (preset && preset !== handledPreset) {
    setHandledPreset(preset);
    if (preset.session) setSetup({ kind: preset.session, nodeIds: preset.nodeIds ?? [] });
    else if (preset.nodeIds?.length) setGenerating({ nodeIds: preset.nodeIds });
  }
  // …and the parent is told it was used (so it clears it).
  useEffect(() => {
    if (preset) onPresetUsed?.();
  }, [preset, onPresetUsed]);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const t = setInterval(async () => {
      try {
        const next = await api.questionJob(notebook.id, job.id);
        setJob(next);
        if (next.status === "done") {
          toast(`${next.verified} question${next.verified === 1 ? "" : "s"} ready${next.rejected ? ` — ${next.rejected} failed the self-check and ${next.rejected === 1 ? "was" : "were"} dropped` : ""}`);
          loadBank();
        }
        if (next.status === "error") toast(next.error, "error");
      } catch {
        // try again next tick
      }
    }, JOB_POLL_MS);
    return () => clearInterval(t);
  }, [job, notebook.id, loadBank]);

  const nodes = map?.nodes ?? [];
  const nodeName = (q) => nodes.find((n) => n.id === q.nodeIds[0])?.name;
  const noMap = map && nodes.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-3xl bg-accent-soft text-accent-soft-fg p-5 flex flex-wrap items-center gap-4">
        <span className="w-12 h-12 rounded-2xl bg-panel/60 flex items-center justify-center">
          <Icon name="verified" size={26} />
        </span>
        <div className="flex-1 min-w-[180px]">
          <p className="font-display text-lg font-semibold">{profile?.profile ? `${profile.profile.name} practice` : "Exam practice"}</p>
          <p className="text-sm opacity-80">Questions in your exam's formats and marking, written from your notes and checked by an independent solve before you see them.</p>
        </div>
        <button type="button" className="btn-primary h-10 px-5" onClick={() => setGenerating({ nodeIds: [] })} disabled={!map || noMap || job?.status === "running"}>
          <Icon name="add" size={20} /> New questions
        </button>
      </div>

      {!noMap && map && (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Practice sessions</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SESSION_TYPES.map((t) => (
              <button key={t.kind} type="button" onClick={() => setSetup({ kind: t.kind, nodeIds: [] })} className="flex items-start gap-3 p-4 rounded-2xl border border-line bg-panel hover:bg-panel-2 text-left">
                <span className="w-10 h-10 rounded-xl bg-panel-2 text-accent flex items-center justify-center shrink-0">
                  <Icon name={t.icon} size={22} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{t.title}</span>
                  <span className="block text-xs text-ink-3 leading-5">{t.text}</span>
                </span>
              </button>
            ))}
          </div>
          {sessions?.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold mt-2">Your sessions</h3>
              {sessions.slice(0, 8).map((s) => (
                <SessionRow key={s.id} session={s} onOpen={onPlay} />
              ))}
            </div>
          )}
        </section>
      )}
      <h3 className="text-sm font-semibold mt-2">Question bank</h3>

      {job?.status === "running" && (
        <div className="rounded-2xl border border-line p-4 flex flex-col gap-2" aria-live="polite">
          <p className="flex items-center gap-2 text-sm">
            <Spinner /> Writing and self-checking questions… {job.done}/{job.total}
          </p>
          <div className="h-1.5 rounded-full bg-panel-3 overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.max(5, (job.done / job.total) * 100)}%` }} />
          </div>
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      {noMap && (
        <p className="rounded-xl bg-panel-2 text-sm text-ink-2 px-4 py-3">
          Practice questions are organised by the course's <b>knowledge map</b>. Open Knowledge map and add the syllabus (or build it from your notes) first.
        </p>
      )}
      {!bank && !error && (
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-16 rounded-2xl" />
          ))}
        </div>
      )}
      {bank && bank.questions.length === 0 && !noMap && (
        <div className="flex flex-col items-center text-center gap-3 py-10 px-6 rounded-3xl border border-dashed border-line">
          <Icon name="quiz" size={36} className="text-ink-3" />
          <p className="text-sm font-medium text-ink-2">No practice questions yet</p>
          <p className="text-xs text-ink-3 max-w-sm leading-5">Pick topics from the knowledge map and generate a set. Verified questions stay in the course's bank for everyone in it.</p>
        </div>
      )}
      {bank?.questions.length > 0 && (
        <>
          <p className="text-xs text-ink-3">
            {bank.stats.verified} verified question{bank.stats.verified === 1 ? "" : "s"} in this course's bank
            {bank.stats.rejected ? ` · ${bank.stats.rejected} dropped by the self-check` : ""}
            {bank.stats.reported ? ` · ${bank.stats.reported} reported` : ""}
          </p>
          <div className="flex flex-col gap-2">
            {bank.questions.map((q) => (
              <QuestionCard key={q.id} question={q} nodeName={nodeName(q)} onOpenCitation={onOpenCitation} onReport={setReporting} />
            ))}
          </div>
        </>
      )}

      {generating && (
        <GenerateQuestionsDialog
          notebookId={notebook.id}
          nodes={nodes}
          profile={profile?.profile}
          initialNodeIds={generating.nodeIds}
          onClose={() => setGenerating(null)}
          onStarted={setJob}
        />
      )}
      {setup && (
        <SessionSetupDialog
          notebookId={notebook.id}
          kind={setup.kind}
          nodes={nodes}
          profile={profile?.profile}
          initialNodeIds={setup.nodeIds}
          onClose={() => setSetup(null)}
          onCreated={(s) => onPlay(s.id)}
        />
      )}
      {reporting && <ReportDialog question={reporting} onClose={() => setReporting(null)} onReported={(q) => setBank((b) => ({ ...b, questions: b.questions.filter((x) => x.id !== q.id) }))} />}
    </div>
  );
}
