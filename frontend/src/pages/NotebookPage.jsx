import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { navigate, useMediaQuery } from "../hooks";
import { Logo, ThemeToggle } from "../components/TopBar";
import AccountMenu from "../components/AccountMenu";
import { Icon, Spinner, toast } from "../components/ui";
import SourcesPanel from "../components/sources/SourcesPanel";
import AddSourcesDialog from "../components/sources/AddSourcesDialog";
import ChatPanel from "../components/chat/ChatPanel";

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
      aria-label="Notebook title"
      className="min-w-0 flex-1 max-w-xl bg-transparent font-display text-lg sm:text-xl font-medium text-ink rounded-lg px-2 py-1 -mx-2 hover:bg-panel-2 focus:bg-panel focus:outline-none focus:ring-2 focus:ring-accent/50 truncate"
    />
  );
}

export default function NotebookPage({ notebookId }) {
  const [notebook, setNotebook] = useState(null);
  const [sources, setSources] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const [addOpen, setAddOpen] = useState(false);
  const [viewer, setViewer] = useState(null); // { sourceId, citation? }
  const [streaming, setStreaming] = useState(null); // { question, text, citations }
  const [collapsed, setCollapsed] = useState({ sources: false });
  const [tab, setTab] = useState("chat");
  const isWide = useMediaQuery("(min-width: 1024px)");

  const overviewUntil = useRef(0);
  const abortRef = useRef(null);

  // ---- Loading & polling ----------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getNotebook(notebookId), api.listSources(notebookId), api.listMessages(notebookId)])
      .then(([nb, srcs, msgs]) => {
        if (cancelled) return;
        setNotebook(nb);
        setSources(srcs);
        setMessages(msgs);
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
  const busy = sources.some((s) => s.status === "processing") || overviewUntil.current > Date.now();

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

  const selectedReady = sources.filter((s) => s.selected && s.status === "ready");

  const sendMessage = useCallback(
    async (content) => {
      if (streaming) return;
      if (selectedReady.length === 0) {
        toast("Select at least one ready source to chat with.", "error");
        return;
      }
      setTab("chat");
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming({ question: content, text: "", citations: [] });

      try {
        await api.chat(
          notebookId,
          content,
          selectedReady.map((s) => s.id),
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
    [notebookId, selectedReady, streaming]
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

  // ---- Render -------------------------------------------------------------------

  if (loadError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 text-center p-6">
        <Icon name="error" size={40} className="text-danger" />
        <p className="text-ink-2">{loadError}</p>
        <button type="button" className="btn-primary" onClick={() => navigate("/")}>
          Back to notebooks
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
      collapsed={isWide && collapsed.sources}
      onToggleCollapsed={isWide ? () => setCollapsed((c) => ({ ...c, sources: !c.sources })) : null}
      onAdd={() => setAddOpen(true)}
      onToggle={toggleSources}
      onRename={renameSource}
      onRemove={removeSource}
      viewer={viewer}
      onOpen={(sourceId) => setViewer({ sourceId })}
      onCloseViewer={() => setViewer(null)}
      onAsk={sendMessage}
    />
  );

  const chatPanel = (
    <ChatPanel
      notebook={notebook}
      sources={sources}
      selectedCount={selectedReady.length}
      messages={messages}
      streaming={streaming}
      onSend={sendMessage}
      onStop={stopStreaming}
      onClear={clearChat}
      onOpenCitation={openCitation}
      onAddSources={() => setAddOpen(true)}
    />
  );

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-3 h-16 px-3 sm:px-4 shrink-0">
        <Logo compact />
        <span className="text-2xl leading-none">{notebook.emoji}</span>
        <EditableTitle notebook={notebook} onRename={(title) => updateNotebook({ title })} />
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </header>

      {isWide ? (
        <div className="flex-1 min-h-0 flex gap-3 px-3 pb-3">
          <div className={`${collapsed.sources ? "w-14" : "w-[clamp(260px,24vw,360px)]"} shrink-0 flex transition-[width]`}>{sourcesPanel}</div>
          <div className="flex-1 min-w-0 flex">{chatPanel}</div>
        </div>
      ) : (
        <>
          <div className="flex-1 min-h-0 flex px-2">{tab === "sources" ? sourcesPanel : chatPanel}</div>
          <nav className="shrink-0 grid grid-cols-2 h-14 border-t border-line/60">
            {[
              ["sources", "Sources", "folder_open"],
              ["chat", "Chat", "chat"],
            ].map(([key, label, icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`flex flex-col items-center justify-center gap-0.5 text-xs font-medium ${tab === key ? "text-accent" : "text-ink-3"}`}
              >
                <Icon name={icon} filled={tab === key} size={22} />
                {label}
              </button>
            ))}
          </nav>
        </>
      )}

      <AddSourcesDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        notebookId={notebookId}
        sourceCount={sources.length}
        onAdded={addedSources}
      />
    </div>
  );
}
