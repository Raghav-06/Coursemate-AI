import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { navigate, useMediaQuery } from "../hooks";
import { Logo, ThemeToggle } from "../components/TopBar";
import AccountMenu from "../components/AccountMenu";
import { Icon, Spinner, toast } from "../components/ui";
import SourcesPanel from "../components/sources/SourcesPanel";
import AddSourcesDialog from "../components/sources/AddSourcesDialog";
import ChatPanel from "../components/chat/ChatPanel";
import StudyPanel from "../components/study/StudyPanel";
import PracticePanel from "../components/practice/PracticePanel";
import ProgressPanel from "../components/progress/ProgressPanel";
import ExamInsightsPanel from "../components/insights/ExamInsightsPanel";

// Main-area tools of a course.
const VIEWS = [
  ["chat", "Chat", "chat"],
  ["study", "Study", "style"],
  ["practice", "Practice", "quiz"],
  ["progress", "Progress", "insights"],
  ["insights", "Exam insights", "history_edu", "Exams"],
];

function ViewTabs({ view, onChange, badges }) {
  return (
    <nav className="flex items-center gap-1 rounded-full bg-panel-2 p-1" aria-label="Course tools">
      {VIEWS.map(([key, label, icon]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-current={view === key ? "page" : undefined}
          className={`flex items-center gap-1.5 h-8 px-3.5 rounded-full text-sm font-medium transition-colors ${
            view === key ? "bg-panel text-ink shadow-sm" : "text-ink-2 hover:text-ink"
          }`}
        >
          <Icon name={icon} size={18} filled={view === key} />
          {label}
          {badges[key] > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-accent text-accent-fg text-[11px] font-semibold leading-5 tabular-nums">{badges[key]}</span>}
        </button>
      ))}
    </nav>
  );
}

const POLL_MS = 2000;
const OVERVIEW_WAIT_MS = 45_000;

function EditableTitle({ notebook, onRename }) {
  const [value, setValue] = useState(notebook.title);
  useEffect(() => setValue(notebook.title), [notebook.title]);

  const commit = () => {
    const title = value.trim();
    if (title && title !== notebook.title) onRename(title);
    else setValue(notebook.title);
  };

  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setValue(notebook.title);
          e.currentTarget.blur();
        }
      }}
      aria-label="Course title"
      className="min-w-0 flex-1 max-w-xl bg-transparent font-display text-lg sm:text-xl font-medium text-ink rounded-lg px-2 py-1 -mx-2 hover:bg-panel-2 focus:bg-panel focus:outline-hidden focus:ring-2 focus:ring-accent/50 truncate"
    />
  );
}

export default function NotebookPage({ notebookId }) {
  const [notebook, setNotebook] = useState(null);
  const [sources, setSources] = useState([]);
  const [units, setUnits] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const [addOpen, setAddOpen] = useState(false);
  const [addUnitId, setAddUnitId] = useState(null); // unit preselected in Add sources
  const [addKind, setAddKind] = useState("material"); // material | past_paper preselected in Add sources
  const [includePapers, setIncludePapers] = useState(false); // chat also retrieves from past papers
  const [scope, setScope] = useState([]); // chat scope: unit ids ("general" = no unit); [] = whole course
  const [viewer, setViewer] = useState(null); // { sourceId, citation? }
  const [streaming, setStreaming] = useState(null); // { question, text, citations }
  const [collapsed, setCollapsed] = useState({ sources: false });
  const [tab, setTab] = useState("chat"); // mobile: "sources" | "chat" (the main area)
  const [view, setView] = useState("chat"); // main area: chat | study | practice | progress
  const [studyIntent, setStudyIntent] = useState(null); // e.g. flashcards on weak topics
  const [practiceIntent, setPracticeIntent] = useState(null); // quiz on topics, or a question to answer
  const [progressKey, setProgressKey] = useState(0); // bumps after practice so Progress reloads
  const [studyCounts, setStudyCounts] = useState({ due: 0, new: 0 });
  const isWide = useMediaQuery("(min-width: 1024px)");

  const overviewUntil = useRef(0);
  const abortRef = useRef(null);

  // ---- Loading & polling ----------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getNotebook(notebookId), api.listSources(notebookId), api.listMessages(notebookId), api.listUnits(notebookId)])
      .then(([nb, srcs, msgs, unitList]) => {
        if (cancelled) return;
        setNotebook(nb);
        setSources(srcs);
        setMessages(msgs);
        setUnits(unitList);
        api.listDecks(notebookId).then(
          (r) => !cancelled && setStudyCounts({ due: r.dueCount, new: r.newCount }),
          () => {}
        );
        if (srcs.length === 0 || window.location.hash.includes("new=1")) setAddOpen(true);
        history.replaceState(null, "", `#/notebook/${notebookId}`);
        if (srcs.some((s) => s.status === "ready") && !nb.summary) {
          overviewUntil.current = Date.now() + OVERVIEW_WAIT_MS;
          api.refreshOverview(notebookId).catch(() => {});
        }
      })
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [notebookId]);

  const loaded = Boolean(notebook);
  const busy = sources.some((s) => s.status === "processing" || s.paperStatus === "pending") || overviewUntil.current > Date.now();

  useEffect(() => {
    if (!loaded || !busy) return;
    const timer = setInterval(async () => {
      try {
        const [nb, srcs] = await Promise.all([api.getNotebook(notebookId), api.listSources(notebookId)]);
        setSources((prev) => {
          const newlyReady = srcs.some((s) => s.status === "ready" && prev.find((p) => p.id === s.id)?.status === "processing");
          if (newlyReady) overviewUntil.current = Date.now() + OVERVIEW_WAIT_MS;
          for (const s of srcs) {
            const before = prev.find((p) => p.id === s.id);
            if (before?.status === "processing" && s.status === "error") toast(`Couldn't add "${s.title}": ${s.error}`, "error");
            if (before?.status === "processing" && s.status === "ready" && s.error) toast(`"${s.title}": ${s.error}`, "error");
          }
          return srcs;
        });
        setNotebook((prev) => {
          if (prev && (nb.summary !== prev.summary || nb.title !== prev.title)) overviewUntil.current = 0;
          return nb;
        });
      } catch {
        // transient — try again next tick
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [loaded, busy, notebookId]);

  // ---- Notebook ---------------------------------------------------------------

  const updateNotebook = useCallback(
    async (patch) => {
      try {
        setNotebook(await api.updateNotebook(notebookId, patch));
      } catch (err) {
        toast(err.message, "error");
      }
    },
    [notebookId]
  );

  // ---- Sources ----------------------------------------------------------------

  const addedSources = (created) => {
    setSources((list) => [...list, ...[].concat(created)]);
    setAddOpen(false);
  };

  const openAdd = (unitId = null, kind = "material") => {
    setAddUnitId(unitId);
    setAddKind(kind);
    setAddOpen(true);
  };

  const setSourceKind = async (id, kind) => {
    try {
      const updated = await api.updateSource(id, { kind });
      setSources((list) => list.map((s) => (s.id === id ? updated : s)));
      toast(kind === "past_paper" ? "Marked as a past paper — finding its questions…" : "Marked as course material");
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const analysePaper = async (id) => {
    try {
      const updated = await api.analysePaper(id);
      setSources((list) => list.map((s) => (s.id === id ? updated : s)));
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const reprocessSource = async (id) => {
    try {
      const updated = await api.reprocessSource(id);
      setSources((list) => list.map((s) => (s.id === id ? updated : s)));
      toast("Re-processing the source…");
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const moveSource = async (id, unitId) => {
    try {
      const updated = await api.updateSource(id, { unitId });
      setSources((list) => list.map((s) => (s.id === id ? updated : s)));
    } catch (err) {
      toast(err.message, "error");
    }
  };

  // ---- Units ------------------------------------------------------------------

  const createUnit = async (title) => {
    try {
      const unit = await api.createUnit(notebookId, title);
      setUnits((list) => [...list, unit]);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const renameUnit = async (unitId, title) => {
    try {
      const unit = await api.renameUnit(notebookId, unitId, title);
      setUnits((list) => list.map((u) => (u.id === unitId ? unit : u)));
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const moveUnit = async (unitId, delta) => {
    const ids = units.map((u) => u.id);
    const from = ids.indexOf(unitId);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setUnits(ids.map((id) => units.find((u) => u.id === id)));
    try {
      setUnits(await api.reorderUnits(notebookId, ids));
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const deleteUnit = async (unitId) => {
    try {
      await api.deleteUnit(notebookId, unitId);
      setUnits((list) => list.filter((u) => u.id !== unitId));
      setSources((list) => list.map((s) => (s.unitId === unitId ? { ...s, unitId: null } : s)));
      setScope((list) => list.filter((id) => id !== unitId));
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const toggleSources = async (ids, selected) => {
    setSources((list) => list.map((s) => (ids.includes(s.id) ? { ...s, selected } : s)));
    try {
      await Promise.all(ids.map((id) => api.updateSource(id, { selected })));
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const renameSource = async (id, title) => {
    try {
      const updated = await api.updateSource(id, { title });
      setSources((list) => list.map((s) => (s.id === id ? updated : s)));
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const removeSource = async (id) => {
    try {
      await api.deleteSource(id);
      setSources((list) => list.filter((s) => s.id !== id));
      if (viewer?.sourceId === id) setViewer(null);
      overviewUntil.current = Date.now() + OVERVIEW_WAIT_MS;
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const openCitation = useCallback((citation) => {
    setViewer({ sourceId: citation.sourceId, citation });
    setCollapsed((c) => ({ ...c, sources: false }));
    setTab("sources");
  }, []);

  // ---- Chat -------------------------------------------------------------------

  // Sources the chat will use: ticked, ready, and inside the chosen units.
  const unitIdSet = new Set(units.map((u) => u.id));
  const scopeIds = scope.filter((id) => id === "general" || unitIdSet.has(id));
  const inScope = (s) => scopeIds.length === 0 || scopeIds.includes(s.unitId && unitIdSet.has(s.unitId) ? s.unitId : "general");
  const selectedReady = sources.filter((s) => s.selected && s.status === "ready" && inScope(s) && (includePapers || s.kind !== "past_paper"));

  const sendMessage = useCallback(
    async (content) => {
      if (streaming) return;
      if (selectedReady.length === 0) {
        toast(scopeIds.length ? "No selected, ready sources in the chosen units." : "Select at least one ready source to chat with.", "error");
        return;
      }
      setTab("chat");
      setView("chat");
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming({ question: content, text: "", citations: [] });

      try {
        await api.chat(
          notebookId,
          { content, sourceIds: selectedReady.map((s) => s.id), ...(scopeIds.length ? { unitIds: scopeIds } : {}), ...(includePapers ? { includePastPapers: true } : {}) },
          (event) => {
            if (event.type === "user") setMessages((list) => [...list, event.message]);
            if (event.type === "citations") setStreaming((s) => s && { ...s, citations: event.citations });
            if (event.type === "delta") setStreaming((s) => s && { ...s, text: s.text + event.text });
            if (event.type === "done") {
              setMessages((list) => [...list, event.message]);
              setStreaming(null);
            }
            if (event.type === "error") toast(event.message, "error");
          },
          controller.signal
        );
      } catch (err) {
        toast(err.message, "error");
      } finally {
        setStreaming(null);
        abortRef.current = null;
      }
    },
    [notebookId, selectedReady, scopeIds, includePapers, streaming]
  );

  const stopStreaming = () => abortRef.current?.abort();

  const clearChat = async () => {
    try {
      await api.clearMessages(notebookId);
      setMessages([]);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  // ---- Progress → practice --------------------------------------------------------

  const showView = (next) => {
    setTab("chat");
    setView(next);
  };
  const quizOnTopics = (topics) => {
    setPracticeIntent({ kind: "quiz", topicIds: topics.slice(0, 5).map((t) => t.id), count: topics.length > 1 ? 10 : 5 });
    showView("practice");
  };
  const flashcardsOnTopics = (topics) => {
    setStudyIntent({ kind: "generate", topicIds: topics.slice(0, 5).map((t) => t.id) });
    showView("study");
  };
  const askAboutTopic = (topic) => sendMessage(`Explain "${topic.name}" from ${topic.unitTitle ?? "this course"} simply, with the key points I need for the exam.`);
  const clearStudyIntent = useCallback(() => setStudyIntent(null), []);
  const clearPracticeIntent = useCallback(() => setPracticeIntent(null), []);
  const bumpProgress = useCallback(() => setProgressKey((k) => k + 1), []);
  // Past-paper question → Answer writing (marks rounded to the nearest 2/5/10).
  const practiseQuestion = (q) => {
    const marks = q.marks === null ? 5 : q.marks <= 3 ? 2 : q.marks <= 7 ? 5 : 10;
    setPracticeIntent({ kind: "answer", question: q.text.slice(0, 1000), marks, topicId: q.topicId, unitIds: q.unitId ? [q.unitId] : [], origin: "past_paper" });
    showView("practice");
  };

  // ---- Render -------------------------------------------------------------------

  if (loadError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-center p-6">
        <Icon name="error" size={40} className="text-danger" />
        <p className="text-ink-2">{loadError}</p>
        <button type="button" className="btn-primary" onClick={() => navigate("/")}>
          Back to courses
        </button>
      </div>
    );
  }

  if (!notebook) {
    return (
      <div className="h-full flex items-center justify-center text-ink-3">
        <Spinner className="w-6 h-6" />
      </div>
    );
  }

  const sourcesPanel = (
    <SourcesPanel
      sources={sources}
      units={units}
      collapsed={isWide && collapsed.sources}
      onToggleCollapsed={isWide ? () => setCollapsed((c) => ({ ...c, sources: !c.sources })) : null}
      onAdd={openAdd}
      onToggle={toggleSources}
      onRename={renameSource}
      onMove={moveSource}
      onReprocess={reprocessSource}
      onSetKind={setSourceKind}
      onAnalyse={analysePaper}
      onRemove={removeSource}
      onCreateUnit={createUnit}
      onRenameUnit={renameUnit}
      onMoveUnit={moveUnit}
      onDeleteUnit={deleteUnit}
      viewer={viewer}
      onOpen={(sourceId) => setViewer({ sourceId })}
      onCloseViewer={() => setViewer(null)}
      onAsk={sendMessage}
    />
  );

  const studyPanel = (
    <section className="panel w-full">
      <StudyPanel
        notebook={notebook}
        units={units}
        sources={sources}
        onOpenCitation={openCitation}
        onCounts={setStudyCounts}
        intent={studyIntent}
        onIntentUsed={clearStudyIntent}
      />
    </section>
  );

  const practicePanel = (
    <section className="panel w-full">
      <PracticePanel
        notebook={notebook}
        units={units}
        sources={sources}
        onOpenCitation={openCitation}
        intent={practiceIntent}
        onIntentUsed={clearPracticeIntent}
        onActivity={bumpProgress}
      />
    </section>
  );

  const progressPanel = (
    <section className="panel w-full">
      <ProgressPanel notebook={notebook} refreshKey={progressKey} onQuiz={quizOnTopics} onFlashcards={flashcardsOnTopics} onAsk={askAboutTopic} />
    </section>
  );

  const insightsPanel = (
    <section className="panel w-full">
      <ExamInsightsPanel
        notebook={notebook}
        units={units}
        onOpenCitation={openCitation}
        onPractise={practiseQuestion}
        onAddPaper={() => openAdd(null, "past_paper")}
        sourcesKey={sources.map((s) => `${s.id}:${s.status}:${s.kind}:${s.paperStatus}`).join("|")}
      />
    </section>
  );

  const chatPanel = (
    <ChatPanel
      notebook={notebook}
      sources={sources}
      units={units}
      scope={scopeIds}
      onScopeChange={setScope}
      includePapers={includePapers}
      onIncludePapersChange={setIncludePapers}
      selectedCount={selectedReady.length}
      messages={messages}
      streaming={streaming}
      onSend={sendMessage}
      onStop={stopStreaming}
      onClear={clearChat}
      onOpenCitation={openCitation}
      onAddSources={() => openAdd()}
    />
  );

  const mainPanel = { study: studyPanel, practice: practicePanel, progress: progressPanel, insights: insightsPanel }[view] ?? chatPanel;

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-3 h-16 px-3 sm:px-4 shrink-0">
        <Logo compact />
        <span className="text-2xl leading-none">{notebook.emoji}</span>
        <EditableTitle notebook={notebook} onRename={(title) => updateNotebook({ title })} />
        {isWide && <ViewTabs view={view} onChange={setView} badges={{ study: studyCounts.due + studyCounts.new }} />}
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </header>

      {isWide ? (
        <div className="flex-1 min-h-0 flex gap-3 px-3 pb-3">
          <div className={`${collapsed.sources ? "w-14" : "w-[clamp(260px,24vw,360px)]"} shrink-0 flex transition-[width]`}>{sourcesPanel}</div>
          <div className="flex-1 min-w-0 flex">{mainPanel}</div>
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0 flex px-2">{tab === "sources" ? sourcesPanel : mainPanel}</div>
          <nav className="shrink-0 grid grid-cols-6 h-14 border-t border-line/60">
            {[["sources", "Sources", "folder_open"], ...VIEWS].map(([key, label, icon, shortLabel]) => {
              const active = key === "sources" ? tab === "sources" : tab !== "sources" && view === key;
              const badge = key === "study" ? studyCounts.due + studyCounts.new : 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    if (key === "sources") return setTab("sources");
                    showView(key);
                  }}
                  className={`relative flex flex-col items-center justify-center gap-0.5 text-xs font-medium ${active ? "text-accent" : "text-ink-3"}`}
                >
                  <Icon name={icon} filled={active} size={22} />
                  {shortLabel ?? label}
                  {badge > 0 && (
                    <span className="absolute top-1.5 left-1/2 ml-2 min-w-4 h-4 px-1 rounded-full bg-accent text-accent-fg text-[10px] font-semibold leading-4 tabular-nums">{badge}</span>
                  )}
                </button>
              );
            })}
          </nav>
        </>
      )}

      <AddSourcesDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        notebookId={notebookId}
        sourceCount={sources.length}
        units={units}
        defaultUnitId={addUnitId}
        defaultKind={addKind}
        onAdded={addedSources}
      />
    </div>
  );
}
