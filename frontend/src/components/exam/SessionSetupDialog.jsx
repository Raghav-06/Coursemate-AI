import { useState } from "react";
import { api } from "../../api";
import { Modal, Segmented, Spinner, toast } from "../ui";
import NodePicker from "./NodePicker";

export const SESSION_TYPES = [
  { kind: "drill", icon: "target", title: "Topic drill", text: "Questions on chosen topics, checked one at a time with the solution." },
  { kind: "mixed", icon: "shuffle", title: "Mixed practice", text: "A mix across topics — weak and high-weight ones first. Timer optional." },
  { kind: "sectional", icon: "timer", title: "Sectional test", text: "A timed test on one subject or chapter, at the exam's pace and marking." },
  { kind: "mock", icon: "assignment", title: "Full mock", text: "The whole paper: question count, duration and marking of the exam." },
];
const COUNTS = { drill: [5, 10, 15, 20], mixed: [10, 15, 20, 30], sectional: [10, 15, 20, 30] };

/** Sets up a practice session of one kind (topics, length, timer) and creates it. */
export default function SessionSetupDialog({ notebookId, kind, nodes, profile, initialNodeIds = [], onClose, onCreated }) {
  const type = SESSION_TYPES.find((t) => t.kind === kind);
  const [picked, setPicked] = useState(initialNodeIds);
  const [count, setCount] = useState(kind === "drill" ? 10 : 15);
  const [minutes, setMinutes] = useState(kind === "mixed" ? 0 : null);
  const [busy, setBusy] = useState(false);
  const needsNodes = kind === "drill" || kind === "sectional";
  const sectionalNodes = nodes.filter((n) => n.level === "subject" || n.level === "chapter");

  const create = async () => {
    setBusy(true);
    try {
      const body = { kind, ...(kind !== "mock" ? { nodeIds: picked, count } : {}), ...(minutes ? { minutes } : {}) };
      onCreated(await api.createSession(notebookId, body));
      onClose();
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const mock = profile?.mock;
  const mockSummary = mock
    ? mock.perSubject
      ? `${mock.perSubject.reduce((s, p) => s + p.count, 0)} questions and ${mock.minutesPerSubject} minutes per subject`
      : `${mock.whole.reduce((s, p) => s + p.count, 0)} questions in ${mock.minutes} minutes`
    : "";

  return (
    <Modal
      open
      onClose={onClose}
      title={type.title}
      width="max-w-xl"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={create} disabled={busy || (needsNodes && picked.length === 0)}>
            {busy && <Spinner />} Create
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm text-ink-2">{type.text}</p>
        {kind === "mock" ? (
          <p className="rounded-xl bg-panel-2 px-4 py-3 text-sm">
            {profile?.name ?? "Exam"} pattern: {mockSummary}. Questions not yet in the bank are written and self-checked first, which can take a few minutes.
          </p>
        ) : (
          <>
            <div>
              <p className="text-sm font-medium mb-2">{kind === "sectional" ? "Subject or chapter" : kind === "mixed" ? "Topics (optional — none = the whole course)" : "Topics"}</p>
              {kind === "sectional" ? (
                <div className="flex flex-wrap gap-1.5">
                  {sectionalNodes.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      aria-pressed={picked.includes(n.id)}
                      onClick={() => setPicked(picked.includes(n.id) ? [] : [n.id])}
                      className={`h-8 px-3 rounded-lg border text-sm ${picked.includes(n.id) ? "border-accent bg-accent text-accent-fg" : "border-line hover:bg-panel-2"} ${n.level === "subject" ? "font-semibold" : ""}`}
                    >
                      {n.name}
                    </button>
                  ))}
                </div>
              ) : (
                <NodePicker nodes={nodes} value={picked} onChange={setPicked} />
              )}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-3">
              <div>
                <p className="text-sm font-medium mb-2">Questions</p>
                <Segmented label="Number of questions" value={count} onChange={setCount} options={COUNTS[kind].map((c) => [c, String(c)])} />
              </div>
              {kind === "mixed" && (
                <div>
                  <p className="text-sm font-medium mb-2">Timer</p>
                  <Segmented label="Timer" value={minutes} onChange={setMinutes} options={[[0, "Off"], [15, "15 min"], [30, "30 min"], [60, "60 min"]]} />
                </div>
              )}
            </div>
            {kind === "sectional" && <p className="text-xs text-ink-3">Timed at the exam's pace per question.</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
