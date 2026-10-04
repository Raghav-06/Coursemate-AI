import { useEffect, useRef, useState } from "react";
import Markdown, { stripCitations } from "../Markdown";
import { ConfirmDialog, Icon, IconButton, Menu, copyText } from "../ui";

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 h-6 text-ink-3" aria-label="Thinking">
      {[0, 150, 300].map((delay) => (
        <span key={delay} className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </span>
  );
}

function AssistantMessage({ message, onOpenCitation, streaming }) {
  return (
    <div className="group animate-fade-in">
      {message.content ? <Markdown text={message.content} citations={message.citations} onOpenCitation={onOpenCitation} /> : <TypingDots />}
      {!streaming && (
        <div className="flex items-center gap-1 mt-2 -ml-2">
          <IconButton icon="content_copy" label="Copy" onClick={() => copyText(stripCitations(message.content))} className="w-8! h-8!" size={18} />
        </div>
      )}
    </div>
  );
}

function Overview({ notebook, sources, onAddSources }) {
  const readyCount = sources.filter((s) => s.status === "ready").length;
  const pending = readyCount > 0 && !notebook.summary;

  if (sources.length === 0) {
    return (
      <div className="flex flex-col items-center text-center gap-4 pt-16 pb-8">
        <span className="w-14 h-14 rounded-full bg-accent-soft text-accent-soft-fg flex items-center justify-center">
          <Icon name="upload" size={28} />
        </span>
        <h2 className="font-display text-2xl font-medium">Add a source to get started</h2>
        <button type="button" className="btn-outline" onClick={onAddSources}>
          Upload a source
        </button>
      </div>
    );
  }

  return (
    <div className="pt-6 pb-4">
      <div className="text-5xl mb-3">{notebook.emoji}</div>
      <h2 className="font-display text-2xl sm:text-[28px] leading-tight font-semibold">{notebook.title}</h2>
      <p className="text-sm text-ink-3 mt-1.5">
        {sources.length} source{sources.length === 1 ? "" : "s"}
      </p>
      <div className="mt-4">
        {pending ? (
          <div className="flex flex-col gap-2" aria-label="Writing notebook summary">
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-11/12" />
            <div className="skeleton h-4 w-4/5" />
          </div>
        ) : notebook.summary ? (
          <>
            <Markdown text={notebook.summary} />
            <div className="flex items-center gap-1 mt-3 -ml-2">
              <IconButton icon="content_copy" label="Copy summary" onClick={() => copyText(notebook.summary.replace(/\*\*/g, ""))} className="w-8! h-8!" size={18} />
            </div>
          </>
        ) : readyCount === 0 ? (
          <p className="text-sm text-ink-3">Your sources are being processed…</p>
        ) : null}
      </div>
    </div>
  );
}

function Composer({ disabled, streaming, selectedCount, placeholder, suggestions, onSend, onStop }) {
  const [value, setValue] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled || streaming) return;
    onSend(text);
    setValue("");
  };

  return (
    <div className="shrink-0 px-4 pb-4 pt-2">
      {suggestions?.length > 0 && !streaming && (
        <div className="flex gap-2 overflow-x-auto scroll-thin pb-2 max-w-3xl mx-auto">
          {suggestions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => onSend(q)}
              disabled={disabled}
              className="shrink-0 max-w-[320px] text-left px-3.5 py-2 rounded-2xl bg-panel-2 hover:bg-panel-3 text-[13px] leading-5 text-ink-2 transition-colors disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}
      <div className={`max-w-3xl mx-auto flex items-end gap-2 rounded-3xl border border-line bg-panel pl-5 pr-2 py-2 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent ${disabled ? "opacity-60" : ""}`}>
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={disabled}
          placeholder={placeholder}
          className="flex-1 resize-none bg-transparent py-2 text-[15px] leading-6 text-ink placeholder:text-ink-3 focus:outline-hidden disabled:cursor-not-allowed"
        />
        <span className="shrink-0 text-xs text-ink-3 pb-2.5 hidden sm:inline">
          {selectedCount} source{selectedCount === 1 ? "" : "s"}
        </span>
        {streaming ? (
          <button type="button" onClick={onStop} className="shrink-0 w-10 h-10 rounded-full bg-accent text-accent-fg flex items-center justify-center" title="Stop" aria-label="Stop generating">
            <Icon name="stop" filled size={20} />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={disabled || !value.trim()}
            className="shrink-0 w-10 h-10 rounded-full bg-accent text-accent-fg flex items-center justify-center disabled:bg-panel-3 disabled:text-ink-3 transition-colors"
            title="Send"
            aria-label="Send"
          >
            <Icon name="arrow_forward" size={20} />
          </button>
        )}
      </div>
      <p className="text-center text-[11px] text-ink-3 mt-2">CourseMate AI can be inaccurate; please double-check its responses.</p>
    </div>
  );
}

export default function ChatPanel({
  notebook,
  sources,
  selectedCount,
  messages,
  streaming,
  onSend,
  onStop,
  onClear,
  onOpenCitation,
  onAddSources,
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const scrollRef = useRef(null);
  const stickToBottom = useRef(true);

  const readyCount = sources.filter((s) => s.status === "ready").length;
  const disabled = selectedCount === 0;

  // Follow the stream unless the user has scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, streaming?.text]);

  useEffect(() => {
    if (streaming && !streaming.text) stickToBottom.current = true;
  }, [streaming]);

  const placeholder =
    sources.length === 0
      ? "Upload a source to get started"
      : readyCount === 0
        ? "Waiting for sources to finish processing…"
        : selectedCount === 0
          ? "Select at least one source to chat"
          : "Start typing…";

  return (
    <section className="panel w-full">
      <div className="panel-header">
        <h2 className="font-display text-base font-medium">Chat</h2>
        <div className="flex items-center">
          <Menu items={[{ label: "Delete chat history", icon: "delete", danger: true, onClick: () => setConfirmClear(true) }]} />
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 overflow-y-auto scroll-thin"
      >
        <div className="max-w-3xl mx-auto px-5 sm:px-8 pb-6">
          <Overview notebook={notebook} sources={sources} onAddSources={onAddSources} />

          <div className="flex flex-col gap-6 pt-2">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end animate-fade-in">
                  <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-accent-soft text-accent-soft-fg px-4 py-2.5 text-[15px] leading-6 whitespace-pre-wrap wrap-break-word">{m.content}</div>
                </div>
              ) : (
                <AssistantMessage key={m.id} message={m} onOpenCitation={onOpenCitation} />
              )
            )}
            {streaming && (
              <AssistantMessage message={{ content: streaming.text, citations: streaming.citations }} streaming onOpenCitation={onOpenCitation} />
            )}
          </div>
        </div>
      </div>

      <Composer
        disabled={disabled}
        streaming={Boolean(streaming)}
        selectedCount={selectedCount}
        placeholder={placeholder}
        suggestions={readyCount > 0 ? notebook.suggestedQuestions : []}
        onSend={onSend}
        onStop={onStop}
      />

      <ConfirmDialog
        open={confirmClear}
        title="Delete chat history?"
        message="All messages in this notebook's chat will be permanently deleted."
        onConfirm={onClear}
        onClose={() => setConfirmClear(false)}
      />
    </section>
  );
}
