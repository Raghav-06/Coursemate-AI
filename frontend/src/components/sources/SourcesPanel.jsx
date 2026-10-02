import { useState } from "react";
import { Checkbox, ConfirmDialog, Icon, IconButton, Menu, Modal, Spinner } from "../ui";
import { sourceIcon } from "./sourceIcon";
import SourceViewer from "./SourceViewer";

function RenameSourceDialog({ source, onClose, onSave }) {
  const [title, setTitle] = useState(source?.title ?? "");
  return (
    <Modal open={Boolean(source)} onClose={onClose} title="Rename source" width="max-w-md" bodyClassName="px-6 pb-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(title.trim());
          onClose();
        }}
        className="flex flex-col gap-4"
      >
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!title.trim()}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SourceRow({ source, onOpen, onToggle, onRename, onRemove }) {
  const [icon, color] = sourceIcon(source);
  const processing = source.status === "processing";
  const failed = source.status === "error";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !processing && onOpen(source.id)}
      onKeyDown={(e) => e.key === "Enter" && !processing && onOpen(source.id)}
      title={failed ? source.error : source.title}
      className={`group flex items-center gap-2.5 pl-3 pr-1 h-12 rounded-xl ${processing ? "cursor-progress" : "cursor-pointer hover:bg-panel-2"}`}
    >
      {processing ? (
        <Spinner className="w-5 h-5 text-accent shrink-0" />
      ) : failed ? (
        <Icon name="error" className="text-danger shrink-0" size={22} />
      ) : (
        <Icon name={icon} className={`${color} shrink-0`} size={22} />
      )}
      <div className="min-w-0 flex-1">
        <p className={`text-sm truncate ${failed ? "text-danger" : "text-ink"}`}>{source.title}</p>
        {processing && (
          <div className="mt-1 h-1 rounded-full bg-panel-3 overflow-hidden">
            <div className="h-full bg-accent transition-all duration-500" style={{ width: `${Math.max(5, source.progress ?? 0)}%` }} />
          </div>
        )}
        {failed && <p className="text-xs text-danger/80 truncate">{source.error}</p>}
      </div>
      <Menu
        buttonClassName="!w-8 !h-8 opacity-0 group-hover:opacity-100 focus:opacity-100"
        items={[
          !failed && { label: "Rename source", icon: "edit", onClick: () => onRename(source) },
          source.url && { label: "Open original link", icon: "open_in_new", onClick: () => window.open(source.url, "_blank", "noopener") },
          { label: "Remove source", icon: "delete", danger: true, onClick: () => onRemove(source) },
        ]}
      />
      <span className="w-8 flex justify-center">
        {source.status === "ready" && <Checkbox checked={source.selected} onChange={(v) => onToggle([source.id], v)} label="Use this source" />}
      </span>
    </div>
  );
}

export default function SourcesPanel({ sources, collapsed, onToggleCollapsed, onAdd, onToggle, onRename, onRemove, viewer, onOpen, onCloseViewer, onAsk }) {
  const [renaming, setRenaming] = useState(null);
  const [removing, setRemoving] = useState(null);

  const ready = sources.filter((s) => s.status === "ready");
  const selectedCount = ready.filter((s) => s.selected).length;
  const allSelected = ready.length > 0 && selectedCount === ready.length;
  const viewedSource = viewer && sources.find((s) => s.id === viewer.sourceId);

  if (collapsed) {
    return (
      <section className="panel w-full items-center py-2 gap-1">
        <IconButton icon="dock_to_right" label="Expand sources" onClick={onToggleCollapsed} />
        <IconButton icon="add" label="Add sources" onClick={onAdd} />
        <div className="flex flex-col items-center gap-1 mt-1 overflow-y-auto scroll-thin">
          {sources.map((s) => {
            const [icon, color] = sourceIcon(s);
            return <IconButton key={s.id} icon={icon} label={s.title} className={color} onClick={() => (onToggleCollapsed(), onOpen(s.id))} />;
          })}
        </div>
      </section>
    );
  }

  if (viewedSource) {
    return (
      <section className="panel w-full">
        <SourceViewer source={viewedSource} citation={viewer.citation} onBack={onCloseViewer} onAsk={onAsk} />
      </section>
    );
  }

  return (
    <section className="panel w-full">
      <div className="panel-header">
        <h2 className="font-display text-base font-medium">Sources</h2>
        {onToggleCollapsed && <IconButton icon="dock_to_left" label="Collapse sources" onClick={onToggleCollapsed} />}
      </div>

      <div className="px-3 pt-3 pb-2">
        <button type="button" className="btn-outline w-full h-10" onClick={onAdd}>
          <Icon name="add" size={20} />
          Add sources
        </button>
      </div>

      {sources.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 px-6 pb-10">
          <Icon name="description" size={40} className="text-ink-3" />
          <p className="text-sm font-medium text-ink-2">Saved sources will appear here</p>
          <p className="text-xs text-ink-3 leading-5">Click Add sources above to add PDFs, websites, text, slides, or documents. Or discover papers on arXiv.</p>
        </div>
      ) : (
        <>
          {ready.length > 0 && (
            <label className="flex items-center justify-between gap-2 pl-4 pr-[13px] h-10 text-sm text-ink-2 cursor-pointer">
              Select all sources
              <Checkbox
                checked={allSelected}
                indeterminate={selectedCount > 0 && !allSelected}
                onChange={(v) => onToggle(ready.map((s) => s.id), v)}
                label="Select all sources"
              />
            </label>
          )}
          <div className="flex-1 overflow-y-auto scroll-thin px-1 pb-3">
            {sources.map((source) => (
              <SourceRow key={source.id} source={source} onOpen={onOpen} onToggle={onToggle} onRename={setRenaming} onRemove={setRemoving} />
            ))}
          </div>
        </>
      )}

      {renaming && <RenameSourceDialog source={renaming} onClose={() => setRenaming(null)} onSave={(title) => onRename(renaming.id, title)} />}
      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove source?"
        message={`"${removing?.title}" will be removed from this notebook. Existing chat answers keep their text but its citations can no longer be opened.`}
        confirmLabel="Remove"
        onConfirm={() => onRemove(removing.id)}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}
