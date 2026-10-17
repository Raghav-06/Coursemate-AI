import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { navigate, useMediaQuery } from "../hooks";
import { Logo, ThemeToggle } from "../components/TopBar";
import AccountMenu from "../components/AccountMenu";
import { Icon, IconButton, SlideOver, Spinner, toast } from "../components/ui";
import SourcesPanel from "../components/sources/SourcesPanel";
import SourceViewer from "../components/sources/SourceViewer";
import AddSourcesDialog from "../components/sources/AddSourcesDialog";
import ChatPanel from "../components/chat/ChatPanel";
import StudyPanel from "../components/study/StudyPanel";
import PracticePanel from "../components/practice/PracticePanel";
import ProgressPanel from "../components/progress/ProgressPanel";
import ExamsPanel from "../components/exams/ExamsPanel";
import KnowledgeMapPanel from "../components/map/KnowledgeMapPanel";
import MistakesPanel from "../components/mistakes/MistakesPanel";
import CourseLanguageDialog from "../components/CourseLanguageDialog";
import ShareDialog from "../components/ShareDialog";

// Main-area tools of a course, in the sidebar. The two exam entries are
// tabs of the Exams view (revision plan | past-paper insights).
const NAV = [
  { key: "chat", label: "Chat", icon: "forum" },
  { key: "study", label: "Study", icon: "style" },
  { key: "practice", label: "Practice", icon: "quiz" },
  { key: "map", label: "Knowledge map", icon: "account_tree" },
  { key: "mistakes", label: "Mistakes", icon: "troubleshoot" },
  { key: "exams", examsTab: "plan", label: "Exam plan", icon: "event_upcoming" },
  { key: "exams", examsTab: "papers", label: "Exam insights", icon: "history_edu" },
  { key: "progress", label: "Progress", icon: "insights" },
];
const VIEWS = ["chat", "study", "practice", "progress", "exams", "map", "mistakes"];
// Mobile bottom bar: the course outline (sidebar) plus the main tools.
const MOBILE_NAV = [
  { key: "outline", label: "Units", icon: "menu_book" },
  NAV[0],
  NAV[1],
  NAV[2],
  { ...NAV[3], label: "Map" },
  { ...NAV[5], label: "Exams" },
  NAV[7],
];

// "#/notebook/<id>?view=study" opens a tool directly (e.g. from Home).
function initialView() {
  const view = window.location.hash.match(/[?&]view=(\w+)/)?.[1];
  return VIEWS.includes(view) ? view : "chat";
}

function NavItem({ item, active, badge, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-3 h-10 px-3 rounded-xl text-sm font-medium transition-colors ${
        active ? "bg-panel text-ink shadow-card" : "text-ink-2 hover:bg-panel/60 hover:text-ink"
      }`}
    >
      <Icon name={item.icon} size={20} filled={active} className={active ? "text-accent" : "text-ink-3 group-hover:text-ink-2"} />
      <span className="flex-1 text-left">{item.label}</span>
      {badge > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-accent text-accent-fg text-[11px] font-semibold leading-5 tabular-nums">{badge}</span>}
    </button>
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
      className="w-full min-w-0 bg-transparent font-display text-base font-semibold text-ink rounded-lg px-1.5 py-0.5 -mx-1.5 hover:bg-panel-2 focus:bg-panel focus:outline-hidden focus:ring-2 focus:ring-accent/50 truncate"
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
  const [drawerOpen, setDrawerOpen] = useState(false); // mobile: the sidebar as a drawer
  const [view, setView] = useState(initialView); // main area: chat | study | practice | progress | exams
  const [examsTab, setExamsTab] = useState("plan"); // plan | papers
  const [insightsTopic, setInsightsTopic] = useState(""); // past-paper questions filtered to a topic
  const [studyIntent, setStudyIntent] = useState(null); // e.g. flashcards on weak topics
  const [practiceIntent, setPracticeIntent] = useState(null); // quiz on topics, or a question to answer
  const [progressKey, setProgressKey] = useState(0); // bumps after practice so Progress reloads
  const [studyCounts, setStudyCounts] = useState({ due: 0, new: 0 });
  const [languageOpen, setLanguageOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
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
        if (nb.role !== "viewer" && (srcs.length === 0 || window.location.hash.includes("new=1"))) setAddOpen(true);
        history.replaceState(null, "", `#/notebook/${notebookId}`); // drop ?new=1 / ?view= once used
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
      toast(kind === "past_paper" ? "Marked as a past paper — finding its questions…" : kind === "syllabus" ? "Marked as the syllabus — the knowledge map will update" : "Marked as notes");
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const dismissKind = async (id) => {
    try {
      const updated = await api.updateSource(id, { dismissKindSuggestion: true });
      setSources((list) => list.map((s) => (s.id === id ? updated : s)));
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

  // Citations and sources open in the slide-over viewer.
  const openCitation = useCallback((citation) => {
    setViewer({ sourceId: citation.sourceId, citation });
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
      setDrawerOpen(false);
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
    setDrawerOpen(false);
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
  const explainTopic = (topic) => {
    setPracticeIntent({ kind: "explain", topicId: topic.id });
    showView("practice");
  };
  const clearStudyIntent = useCallback(() => setStudyIntent(null), []);
  const clearPracticeIntent = useCallback(() => setPracticeIntent(null), []);
  const bumpProgress = useCallback(() => setProgressKey((k) => k + 1), []);
  // Past-paper question → Answer writing (marks rounded to the nearest 2/5/10).
  // Starting a task of the revision plan opens the matching tool.
  const startTask = (task, exam) => {
    const unitTitle = units.find((u) => u.id === task.unitId)?.title;
    if (task.type === "read") return askAboutTopic({ name: task.topic ?? task.title, unitTitle });
    if (task.type === "flashcards") return showView("study");
    if (task.type === "quiz") {
      setPracticeIntent(
        task.topicId
          ? { kind: "quiz", topicIds: [task.topicId], count: 5 }
          : { kind: "quiz", topicIds: [], unitIds: exam?.unitIds ?? [], count: 15 }
      );
      return showView("practice");
    }
    if (task.type === "answer") {
      const marks = [2, 5, 10].includes(task.targetCount) ? task.targetCount : 5;
      setPracticeIntent({ kind: "answer", question: "", marks, topicId: task.topicId, unitIds: task.unitId ? [task.unitId] : [], origin: "typed" });
      return showView("practice");
    }
    if (task.type === "past_paper") {
      setInsightsTopic(task.topicId ?? "");
      setExamsTab("papers");
      return showView("exams");
    }
  };

  // "Practise this" on a knowledge-map node: self-checked exam questions on it.
  const practiseNode = (node) => {
    setPracticeIntent({ kind: "exam", nodeIds: [node.id] });
    showView("practice");
  };

  // A practice session started elsewhere (e.g. "Fix this" on the Mistakes dashboard).
  const playSession = (sessionId) => {
    setPracticeIntent({ kind: "session", sessionId });
    showView("practice");
  };

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

  // Owners and editors change the course's material; viewers read, chat and practise.
  const canEdit = notebook.role !== "viewer";
  const sharedBy = notebook.role !== "owner" ? notebook.owner?.name || notebook.owner?.email : null;

  const sourcesPanel = (
    <SourcesPanel
      canEdit={canEdit}
      sources={sources}
      units={units}
      onAdd={openAdd}
      onToggle={toggleSources}
      onRename={renameSource}
      onMove={moveSource}
      onReprocess={reprocessSource}
      onSetKind={setSourceKind}
      onDismissKind={dismissKind}
      onAnalyse={analysePaper}
      onRemove={removeSource}
      onCreateUnit={createUnit}
      onRenameUnit={renameUnit}
      onMoveUnit={moveUnit}
      onDeleteUnit={deleteUnit}
      activeSourceId={viewer?.sourceId}
      onOpen={(sourceId) => setViewer({ sourceId })}
    />
  );
  const viewedSource = viewer && sources.find((s) => s.id === viewer.sourceId);

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
      <ProgressPanel notebook={notebook} refreshKey={progressKey} onQuiz={quizOnTopics} onFlashcards={flashcardsOnTopics} onAsk={askAboutTopic} onExplain={explainTopic} />
    </section>
  );

  const examsPanel = (
    <section className="panel w-full">
      <ExamsPanel
        tab={examsTab}
        onTabChange={setExamsTab}
        notebook={notebook}
        units={units}
        sources={sources}
        onStartTask={startTask}
        insightsProps={{
          initialTopicId: insightsTopic,
          onOpenCitation: openCitation,
          onPractise: practiseQuestion,
          onAddPaper: canEdit ? () => openAdd(null, "past_paper") : undefined,
          sourcesKey: sources.map((s) => `${s.id}:${s.status}:${s.kind}:${s.paperStatus}`).join("|"),
        }}
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
      onAddSources={canEdit ? () => openAdd() : undefined}
    />
  );

  const mapPanel = (
    <section className="panel w-full">
      <KnowledgeMapPanel
        notebook={notebook}
        canEdit={canEdit}
        sourcesKey={sources.map((s) => `${s.id}:${s.status}:${s.kind}:${s.paperStatus}`).join("|")}
        onOpenCitation={openCitation}
        onPractise={practiseNode}
        onAsk={(node) => askAboutTopic({ name: node.name, unitTitle: node.ancestors?.at(-1)?.name })}
        onAddSources={(kind) => openAdd(null, kind)}
      />
    </section>
  );

  const mistakesPanel = (
    <section className="panel w-full">
      <MistakesPanel notebook={notebook} onOpenCitation={openCitation} onPlaySession={playSession} />
    </section>
  );

  const mainPanel = { study: studyPanel, practice: practicePanel, progress: progressPanel, exams: examsPanel, map: mapPanel, mistakes: mistakesPanel }[view] ?? chatPanel;
  const isActive = (item) => item.key === view && (!item.examsTab || item.examsTab === examsTab);
  const go = (item) => {
    if (item.examsTab) setExamsTab(item.examsTab);
    showView(item.key);
  };
  const current = NAV.find(isActive) ?? NAV[0];
  const badges = { study: studyCounts.due + studyCounts.new };

  // The course outline: tools, then units and their sources.
  const sidebar = (
    <aside className="h-full w-full flex flex-col min-h-0 bg-sidebar">
      <div className="flex items-center gap-2 h-14 px-3 shrink-0">
        <Logo />
        {!isWide && <IconButton icon="close" label="Close menu" className="ml-auto" onClick={() => setDrawerOpen(false)} />}
      </div>
      <div className="px-3 pb-3 shrink-0">
        <div className="flex items-start gap-2.5 rounded-2xl bg-panel/70 border border-line/60 p-3">
          <span className="text-2xl leading-none mt-0.5">{notebook.emoji}</span>
          <div className="min-w-0 flex-1">
            {canEdit ? (
              <EditableTitle notebook={notebook} onRename={(title) => updateNotebook({ title })} />
            ) : (
              <h1 className="font-display text-base font-semibold leading-snug text-ink line-clamp-2">{notebook.title}</h1>
            )}
            <p className="text-xs text-ink-3 truncate mt-0.5">
              {sharedBy ? `Shared by ${sharedBy} · ${notebook.role}` : `${sources.length} source${sources.length === 1 ? "" : "s"} · ${units.length} unit${units.length === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>
      </div>
      <nav className="px-2 flex flex-col gap-0.5 shrink-0" aria-label="Course tools">
        {NAV.map((item) => (
          <NavItem key={item.label} item={item} active={isActive(item)} badge={badges[item.key] ?? 0} onClick={() => go(item)} />
        ))}
      </nav>
      <div className="mt-4 mx-3 border-t border-line/70" />
      <div className="flex-1 min-h-0 flex">{sourcesPanel}</div>
    </aside>
  );

  return (
    <div className="h-full flex">
      {isWide && <div className="w-[clamp(270px,22vw,320px)] shrink-0 border-r border-line/70 flex">{sidebar}</div>}
      {!isWide && drawerOpen && (
        <div className="fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setDrawerOpen(false)} />
          <div className="relative w-[min(340px,88vw)] h-full shadow-pop animate-slide-in-left flex">{sidebar}</div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="flex items-center gap-2 h-14 px-3 sm:px-4 shrink-0">
          {!isWide && <IconButton icon="menu" label="Course menu" onClick={() => setDrawerOpen(true)} />}
          {!isWide && <span className="text-xl leading-none">{notebook.emoji}</span>}
          {isWide ? (
            <p className="min-w-0 flex items-center gap-1.5 text-sm text-ink-3">
              <span className="truncate">{notebook.title}</span>
              <Icon name="chevron_right" size={18} />
              <span className="font-medium text-ink whitespace-nowrap">{current.label}</span>
            </p>
          ) : (
            <h1 className="min-w-0 truncate font-display text-lg font-semibold text-ink">{notebook.title}</h1>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className={notebook.role === "owner" ? "btn-outline h-9 px-3 max-sm:px-2" : "btn-ghost h-9 px-2"}
              title={notebook.role === "owner" ? "Share this course" : "People in this course"}
            >
              <Icon name={notebook.role === "owner" ? "person_add" : "group"} size={18} />
              <span className="max-sm:hidden">{notebook.role === "owner" ? "Share" : notebook.memberCount}</span>
            </button>
            <IconButton icon="translate" label="Language for this course" onClick={() => setLanguageOpen(true)} />
            <ThemeToggle />
            <AccountMenu />
          </div>
        </header>

        <div className={`flex-1 min-h-0 flex ${isWide ? "px-3 pb-3" : "px-2"}`}>{mainPanel}</div>

        {!isWide && (
          <nav className="shrink-0 grid grid-cols-7 h-14 border-t border-line/60 bg-sidebar" aria-label="Course tools">
            {MOBILE_NAV.map((item) => {
              const active = item.key === "outline" ? drawerOpen : !drawerOpen && item.key === view;
              const badge = badges[item.key] ?? 0;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => (item.key === "outline" ? setDrawerOpen(true) : go(item))}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? "text-accent" : "text-ink-3"}`}
                >
                  <Icon name={item.icon} filled={active} size={22} />
                  {item.label}
                  {badge > 0 && (
                    <span className="absolute top-1.5 left-1/2 ml-2 min-w-4 h-4 px-1 rounded-full bg-accent text-accent-fg text-[10px] font-semibold leading-4 tabular-nums">{badge}</span>
                  )}
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {viewedSource && (
        <SlideOver label={viewedSource.title} onClose={() => setViewer(null)}>
          <SourceViewer
            source={viewedSource}
            citation={viewer.citation}
            onBack={() => setViewer(null)}
            onAsk={(question) => {
              setViewer(null);
              sendMessage(question);
            }}
            onReprocess={canEdit ? reprocessSource : undefined}
          />
        </SlideOver>
      )}

      <CourseLanguageDialog notebookId={notebookId} open={languageOpen} onClose={() => setLanguageOpen(false)} />
      {shareOpen && <ShareDialog notebook={notebook} open onClose={() => setShareOpen(false)} />}
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
