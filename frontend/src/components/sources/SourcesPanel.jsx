import { useState } from "react";
import { Checkbox, ConfirmDialog, Icon, IconButton, Menu, Modal, Spinner } from "../ui";
import { sourceIcon } from "./sourceIcon";
import SourceViewer from "./SourceViewer";

/** Small one-field dialog used to name units and rename sources. */
export function NameDialog({ open, title, initial = "", placeholder, saveLabel = "Save", maxLength = 200, onClose, onSave }) {
  const [value, setValue] = useState(initial);
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-md" bodyClassName="px-6 pb-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(value.trim());
          onClose();
        }}
        className="flex flex-col gap-4"
      >
        <input className="input" value={value} placeholder={placeholder} maxLength={maxLength} onChange={(e) => setValue(e.target.value)} autoFocus />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!value.trim()}>
            {saveLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MoveSourceDialog({ source, units, onClose, onMove }) {
  const options = [...units.map((u) => [u.id, u.title]), [null, "General"]];
  return (
    <Modal open={Boolean(source)} onClose={onClose} title="Move to unit" width="max-w-md" bodyClassName="px-3 pb-4">
      <p className="px-3 pb-2 text-sm text-ink-3 truncate">{source?.title}</p>
      <div className="flex flex-col">
        {options.map(([id, title]) => {
          const current = (source?.unitId ?? null) === id;
          return (
            <button
              key={id ?? "general"}
              type="button"
              disabled={current}
              onClick={() => {
                onMove(source.id, id);
                onClose();
              }}
              className="flex items-center gap-3 px-3 h-11 rounded-xl text-left text-sm hover:bg-panel-2 disabled:opacity-100 disabled:cursor-default"
            >
              <Icon name={id ? "folder" : "inventory_2"} size={20} className="text-ink-3" />
              <span className="flex-1 truncate">{title}</span>
              {current && <span className="text-xs text-ink-3">Current</span>}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

function PaperBadge({ source }) {
  const label = ["Past paper", source.examName, source.examYear].filter(Boolean).join(" · ");
  return (
    <p className="flex items-center gap-1 text-[11px] leading-4 text-ink-3 truncate">
      <span className="shrink-0 px-1.5 rounded bg-amber-400/20 text-amber-700 dark:text-amber-300 font-semibold">{label}</span>
      {source.paperStatus === "pending" && (
        <>
          <Spinner className="w-3 h-3" /> finding questions…
        </>
      )}
      {source.paperStatus === "error" && <span className="text-danger truncate">{source.paperError ?? "analysis failed"}</span>}
    </p>
  );
}

function SourceRow({ source, hasUnits, canEdit, onOpen, onToggle, onRename, onMove, onReprocess, onRemove, onSetKind, onAnalyse }) {
  const [icon, color] = sourceIcon(source);
  const processing = source.status === "processing";
  const failed = source.status === "error";
  const paper = source.kind === "past_paper";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !processing && onOpen(source.id)}
      onKeyDown={(e) => e.key === "Enter" && !processing && onOpen(source.id)}
      title={failed ? source.error : source.title}
      className={`group flex items-center gap-2.5 pl-3 pr-1 min-h-12 py-1 rounded-xl ${processing ? "cursor-progress" : "cursor-pointer hover:bg-panel-2"}`}
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
        {processing && source.progressNote && <p className="mt-0.5 text-[11px] leading-4 text-ink-3 truncate">{source.progressNote}</p>}
        {failed && <p className="text-xs text-danger/80 truncate">{source.error}</p>}
        {paper && !processing && !failed && <PaperBadge source={source} />}
      </div>
      <Menu
        buttonClassName="w-8! h-8! opacity-0 group-hover:opacity-100 focus:opacity-100 max-lg:opacity-100"
        items={[
          canEdit && !failed && { label: "Rename source", icon: "edit", onClick: () => onRename(source) },
          canEdit && hasUnits && { label: "Move to unit", icon: "drive_file_move", onClick: () => onMove(source) },
          source.url && { label: "Open original link", icon: "open_in_new", onClick: () => window.open(source.url, "_blank", "noopener") },
          canEdit && !processing && { label: "Re-process", icon: "refresh", onClick: () => onReprocess(source.id) },
          canEdit && onSetKind && !failed && (paper
            ? { label: "Mark as course material", icon: "menu_book", onClick: () => onSetKind(source.id, "material") }
            : { label: "Mark as past paper", icon: "history_edu", onClick: () => onSetKind(source.id, "past_paper") }),
          canEdit && paper && source.status === "ready" && source.paperStatus !== "pending" && onAnalyse && { label: "Find questions again", icon: "manage_search", onClick: () => onAnalyse(source.id) },
          canEdit && { label: "Remove source", icon: "delete", danger: true, onClick: () => onRemove(source) },
        ]}
      />
      <span className="w-8 flex justify-center">
        {source.status === "ready" && <Checkbox checked={source.selected} onChange={(v) => onToggle([source.id], v)} label="Use this source" />}
      </span>
    </div>
  );
}

function UnitHeader({ title, sources, collapsed, onCollapse, onToggle, menu }) {
  const ready = sources.filter((s) => s.status === "ready");
  const selected = ready.filter((s) => s.selected).length;
  return (
    <div className="group flex items-center gap-1 pl-1 pr-1 h-10 mt-1">
      <button
        type="button"
        onClick={onCollapse}
        aria-expanded={!collapsed}
        className="flex-1 min-w-0 flex items-center gap-1.5 h-9 px-1.5 rounded-lg text-left hover:bg-panel-2"
      >
        <Icon name={collapsed ? "chevron_right" : "expand_more"} size={20} className="text-ink-3 shrink-0" />
        <span className="text-[13px] font-semibold text-ink truncate">{title}</span>
        <span className="text-xs text-ink-3 shrink-0">{sources.length}</span>
      </button>
      {menu && <Menu items={menu} buttonClassName="w-8! h-8! opacity-0 group-hover:opacity-100 focus:opacity-100 max-lg:opacity-100" label={`${title} options`} />}
      <span className="w-8 flex justify-center">
        {ready.length > 0 && (
          <Checkbox
            checked={selected === ready.length}
            indeterminate={selected > 0 && selected < ready.length}
            onChange={(v) => onToggle(ready.map((s) => s.id), v)}
            label={`Use all sources in ${title}`}
          />
        )}
      </span>
    </div>
  );
}

export default function SourcesPanel({
  sources,
  units,
  collapsed,
  onToggleCollapsed,
  onAdd,
  onToggle,
  onRename,
  onMove,
  onReprocess,
  onSetKind,
  onAnalyse,
  onRemove,
  onCreateUnit,
  onRenameUnit,
  onMoveUnit,
  onDeleteUnit,
  viewer,
  onOpen,
  onCloseViewer,
  onAsk,
  canEdit = true, // viewers of a shared course can't add or change sources and units
}) {
  const [renaming, setRenaming] = useState(null);
  const [moving, setMoving] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [unitDialog, setUnitDialog] = useState(null); // { unit? } — null closed; unit undefined = new
  const [deletingUnit, setDeletingUnit] = useState(null);
  const [closedUnits, setClosedUnits] = useState(() => new Set());

  const ready = sources.filter((s) => s.status === "ready");
  const selectedCount = ready.filter((s) => s.selected).length;
  const allSelected = ready.length > 0 && selectedCount === ready.length;
  const viewedSource = viewer && sources.find((s) => s.id === viewer.sourceId);

  const unitIds = new Set(units.map((u) => u.id));
  const general = sources.filter((s) => !s.unitId || !unitIds.has(s.unitId));
  const groups = [
    ...units.map((unit, index) => ({ key: unit.id, unit, index, sources: sources.filter((s) => s.unitId === unit.id) })),
    ...(general.length > 0 || units.length === 0 ? [{ key: "general", unit: null, sources: general }] : []),
  ];

  const toggleClosed = (key) =>
    setClosedUnits((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const rowProps = { hasUnits: units.length > 0, canEdit, onOpen, onToggle, onRename: setRenaming, onMove: setMoving, onReprocess, onRemove: setRemoving, onSetKind, onAnalyse };

  if (collapsed) {
    return (
      <section className="panel w-full items-center py-2 gap-1">
        <IconButton icon="dock_to_right" label="Expand sources" onClick={onToggleCollapsed} />
        {canEdit && <IconButton icon="add" label="Add sources" onClick={() => onAdd()} />}
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
        <SourceViewer source={viewedSource} citation={viewer.citation} onBack={onCloseViewer} onAsk={onAsk} onReprocess={canEdit ? onReprocess : undefined} />
      </section>
    );
  }

  return (
    <section className="panel w-full">
      <div className="panel-header">
        <h2 className="font-display text-base font-medium">Sources</h2>
        {onToggleCollapsed && <IconButton icon="dock_to_left" label="Collapse sources" onClick={onToggleCollapsed} />}
      </div>

      {canEdit ? (
        <div className="px-3 pt-3 pb-2 flex gap-2">
          <button type="button" className="btn-outline flex-1 h-10" onClick={() => onAdd()}>
            <Icon name="add" size={20} />
            Add sources
          </button>
          <button type="button" className="btn-outline h-10 px-3" onClick={() => setUnitDialog({})} title="Add a unit (chapter or module)">
            <Icon name="create_new_folder" size={20} />
            <span className="max-sm:hidden">Unit</span>
          </button>
        </div>
      ) : (
        <p className="mx-3 mt-3 mb-1 flex items-center gap-2 rounded-xl bg-panel-2 px-3 py-2 text-xs text-ink-3">
          <Icon name="visibility" size={16} /> You can view and chat with this shared course.
        </p>
      )}

      {sources.length === 0 && units.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 px-6 pb-10">
          <Icon name="description" size={40} className="text-ink-3" />
          <p className="text-sm font-medium text-ink-2">Saved sources will appear here</p>
          <p className="text-xs text-ink-3 leading-5">
            {canEdit
              ? "Add lecture notes, slides, readings or past papers. Group them into units (chapters or modules) to study one part of the course at a time."
              : "No sources have been added to this course yet."}
          </p>
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
            {groups.map(({ key, unit, index, sources: list }) => {
              // A course without units shows a plain list, as before.
              if (units.length === 0) return list.map((source) => <SourceRow key={source.id} source={source} {...rowProps} />);
              const closed = closedUnits.has(key);
              return (
                <div key={key}>
                  <UnitHeader
                    title={unit ? unit.title : "General"}
                    sources={list}
                    collapsed={closed}
                    onCollapse={() => toggleClosed(key)}
                    onToggle={onToggle}
                    menu={
                      canEdit &&
                      unit && [
                        { label: "Add sources here", icon: "add", onClick: () => onAdd(unit.id) },
                        { label: "Rename unit", icon: "edit", onClick: () => setUnitDialog({ unit }) },
                        index > 0 && { label: "Move up", icon: "arrow_upward", onClick: () => onMoveUnit(unit.id, -1) },
                        index < units.length - 1 && { label: "Move down", icon: "arrow_downward", onClick: () => onMoveUnit(unit.id, 1) },
                        { label: "Delete unit", icon: "delete", danger: true, onClick: () => setDeletingUnit(unit) },
                      ]
                    }
                  />
                  {!closed && (
                    <div className="pl-2">
                      {list.map((source) => (
                        <SourceRow key={source.id} source={source} {...rowProps} />
                      ))}
                      {list.length === 0 && unit && canEdit && (
                        <button type="button" onClick={() => onAdd(unit.id)} className="ml-3 mb-1 h-9 px-2 text-xs text-ink-3 hover:text-accent">
                          No sources yet — add some
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {renaming && (
        <NameDialog open title="Rename source" initial={renaming.title} onClose={() => setRenaming(null)} onSave={(title) => onRename(renaming.id, title)} />
      )}
      {unitDialog && (
        <NameDialog
          open
          title={unitDialog.unit ? "Rename unit" : "New unit"}
          initial={unitDialog.unit?.title ?? ""}
          placeholder="e.g. Unit 3: Thermodynamics"
          saveLabel={unitDialog.unit ? "Save" : "Create"}
          maxLength={120}
          onClose={() => setUnitDialog(null)}
          onSave={(title) => (unitDialog.unit ? onRenameUnit(unitDialog.unit.id, title) : onCreateUnit(title))}
        />
      )}
      <MoveSourceDialog source={moving} units={units} onClose={() => setMoving(null)} onMove={onMove} />
      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove source?"
        message={`"${removing?.title}" will be removed from this course. Existing chat answers keep their text but its citations can no longer be opened.`}
        confirmLabel="Remove"
        onConfirm={() => onRemove(removing.id)}
        onClose={() => setRemoving(null)}
      />
      <ConfirmDialog
        open={Boolean(deletingUnit)}
        title="Delete unit?"
        message={`"${deletingUnit?.title}" will be deleted. Its sources are kept and move to General.`}
        onConfirm={() => onDeleteUnit(deletingUnit.id)}
        onClose={() => setDeletingUnit(null)}
      />
    </section>
  );
}
