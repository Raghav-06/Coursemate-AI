import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { navigate } from "../hooks";
import { Logo, ThemeToggle } from "../components/TopBar";
import AccountMenu from "../components/AccountMenu";
import { useAuth } from "../auth";
import { ConfirmDialog, Icon, IconButton, Menu, Modal, Spinner, timeAgo, toast } from "../components/ui";

// Soft card tints, picked deterministically per notebook like NotebookLM's.
const TINTS = [
  "bg-blue-50 dark:bg-blue-950/40",
  "bg-emerald-50 dark:bg-emerald-950/40",
  "bg-amber-50 dark:bg-amber-950/30",
  "bg-rose-50 dark:bg-rose-950/30",
  "bg-violet-50 dark:bg-violet-950/40",
  "bg-cyan-50 dark:bg-cyan-950/40",
  "bg-lime-50 dark:bg-lime-950/30",
];

function tintFor(id) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return TINTS[Math.abs(hash) % TINTS.length];
}

function RenameDialog({ notebook, onClose, onSaved }) {
  const [title, setTitle] = useState(notebook?.title ?? "");
  useEffect(() => setTitle(notebook?.title ?? ""), [notebook]);

  const save = async (e) => {
    e.preventDefault();
    try {
      onSaved(await api.updateNotebook(notebook.id, { title }));
      onClose();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  return (
    <Modal open={Boolean(notebook)} onClose={onClose} title="Edit title" width="max-w-md" bodyClassName="px-6 pb-6">
      <form onSubmit={save} className="flex flex-col gap-4">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus maxLength={200} />
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

export default function HomePage() {
  const { user } = useAuth();
  const [notebooks, setNotebooks] = useState(null);
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem("cm-home-view") ?? "grid";
    } catch {
      return "grid";
    }
  });
  const [sort, setSort] = useState("recent");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    api.listNotebooks().then(setNotebooks, (err) => {
      setNotebooks([]);
      toast(err.message, "error");
    });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("cm-home-view", view);
    } catch {
      // ignore
    }
  }, [view]);

  const sorted = useMemo(() => {
    const list = [...(notebooks ?? [])];
    if (sort === "title") list.sort((a, b) => a.title.localeCompare(b.title));
    else list.sort((a, b) => new Date(b.updatedAt ?? b.createdAt) - new Date(a.updatedAt ?? a.createdAt));
    return list;
  }, [notebooks, sort]);

  const create = async () => {
    setCreating(true);
    try {
      const notebook = await api.createNotebook();
      navigate(`/notebook/${notebook.id}?new=1`);
    } catch (err) {
      toast(err.message, "error");
      setCreating(false);
    }
  };

  const remove = async (notebook) => {
    try {
      await api.deleteNotebook(notebook.id);
      setNotebooks((list) => list.filter((n) => n.id !== notebook.id));
      toast(`Deleted "${notebook.title}"`);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const menuFor = (nb) => [
    { label: "Edit title", icon: "edit", onClick: () => setRenaming(nb) },
    { label: "Delete", icon: "delete", danger: true, onClick: () => setDeleting(nb) },
  ];

  const meta = (nb) => `${timeAgo(nb.updatedAt ?? nb.createdAt)} · ${nb.sourceCount} source${nb.sourceCount === 1 ? "" : "s"}`;

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <header className="sticky top-0 z-20 bg-bg/90 backdrop-blur flex items-center justify-between h-16 px-4 sm:px-8">
        <Logo />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <AccountMenu />
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-8 pb-16">
        <h1 className="font-display text-3xl sm:text-[42px] leading-tight font-semibold tracking-tight mt-6 sm:mt-10 mb-8 bg-gradient-to-r from-blue-600 via-violet-500 to-rose-500 bg-clip-text text-transparent dark:from-blue-300 dark:via-violet-300 dark:to-rose-300">
          {user?.givenName ? `Welcome, ${user.givenName}` : "Welcome to CourseMate AI"}
        </h1>

        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <button type="button" className="btn-primary h-10 px-5" onClick={create} disabled={creating}>
            {creating ? <Spinner /> : <Icon name="add" size={20} />}
            Create new
          </button>
          <div className="flex items-center gap-1">
            <div className="flex rounded-full border border-line p-0.5">
              <IconButton icon="grid_view" label="Grid view" onClick={() => setView("grid")} className={`!w-8 !h-8 ${view === "grid" ? "!bg-accent-soft !text-accent-soft-fg" : ""}`} size={18} />
              <IconButton icon="view_list" label="List view" onClick={() => setView("list")} className={`!w-8 !h-8 ${view === "list" ? "!bg-accent-soft !text-accent-soft-fg" : ""}`} size={18} />
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-9 rounded-full border border-line bg-bg px-3 text-sm text-ink-2 focus:outline-none focus:border-accent" aria-label="Sort notebooks">
              <option value="recent">Most recent</option>
              <option value="title">Title</option>
            </select>
          </div>
        </div>

        {notebooks === null ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-52 rounded-2xl" />
            ))}
          </div>
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <button
              type="button"
              onClick={create}
              disabled={creating}
              className="h-52 rounded-2xl border border-line bg-panel hover:bg-panel-2 flex flex-col items-center justify-center gap-3 transition-colors"
            >
              <span className="w-14 h-14 rounded-full bg-accent-soft text-accent-soft-fg flex items-center justify-center">
                <Icon name="add" size={30} />
              </span>
              <span className="font-display text-base font-medium">Create new notebook</span>
            </button>
            {sorted.map((nb) => (
              <div
                key={nb.id}
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/notebook/${nb.id}`)}
                onKeyDown={(e) => e.key === "Enter" && navigate(`/notebook/${nb.id}`)}
                className={`group relative h-52 rounded-2xl p-5 flex flex-col cursor-pointer hover:shadow-pop transition-shadow ${tintFor(nb.id)}`}
              >
                <div className="flex items-start justify-between">
                  <span className="text-[40px] leading-none">{nb.emoji}</span>
                  <Menu items={menuFor(nb)} buttonClassName="-mr-2 -mt-2 opacity-70 group-hover:opacity-100" />
                </div>
                <h2 className="mt-auto font-display text-lg font-semibold leading-snug line-clamp-3 text-ink">{nb.title}</h2>
                <p className="mt-2 text-xs text-ink-3">{meta(nb)}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-line bg-panel overflow-hidden">
            <div className="grid grid-cols-[1fr_auto_auto_40px] gap-4 px-4 py-2.5 text-xs font-medium text-ink-3 border-b border-line">
              <span>Title</span>
              <span className="w-20 text-right">Sources</span>
              <span className="w-28 hidden sm:block">Updated</span>
              <span />
            </div>
            {sorted.length === 0 && <p className="px-4 py-6 text-sm text-ink-3">No notebooks yet.</p>}
            {sorted.map((nb) => (
              <div
                key={nb.id}
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/notebook/${nb.id}`)}
                onKeyDown={(e) => e.key === "Enter" && navigate(`/notebook/${nb.id}`)}
                className="grid grid-cols-[1fr_auto_auto_40px] gap-4 items-center px-4 py-2 hover:bg-panel-2 cursor-pointer border-b border-line/50 last:border-0"
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span className="text-xl">{nb.emoji}</span>
                  <span className="truncate text-sm font-medium">{nb.title}</span>
                </span>
                <span className="w-20 text-right text-sm text-ink-2">{nb.sourceCount}</span>
                <span className="w-28 text-sm text-ink-3 hidden sm:block">{timeAgo(nb.updatedAt ?? nb.createdAt)}</span>
                <Menu items={menuFor(nb)} />
              </div>
            ))}
          </div>
        )}
      </main>

      <RenameDialog
        notebook={renaming}
        onClose={() => setRenaming(null)}
        onSaved={(updated) => setNotebooks((list) => list.map((n) => (n.id === updated.id ? { ...n, ...updated } : n)))}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete notebook?"
        message={`"${deleting?.title}" and all of its sources and chat history will be permanently deleted.`}
        onConfirm={() => remove(deleting)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
