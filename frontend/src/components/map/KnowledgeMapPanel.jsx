import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { Icon, IconButton, Segmented, SlideOver, Spinner } from "../ui";
import ExamProfileDialog from "./ExamProfileDialog";
import { timeAgo, toast } from "../uiUtils";
import { MASTERY, weightBand } from "./mapUtils";

// The course knowledge map: subject → chapter → topic → subtopic, coloured by
// your mastery, with exam weight badges, a prerequisite graph and a detail
// panel per node.

const POLL_MS = 4000;
const LEVEL_LABEL = { subject: "Subject", chapter: "Chapter", topic: "Topic", subtopic: "Subtopic" };
const pct = (v) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

function WeightBadge({ weight, source }) {
  const band = weightBand(weight);
  if (!band) return null;
  return (
    <span className="inline-flex items-end gap-0.5 h-3.5" title={`${band.label}${source === "past_papers" ? " (from past papers)" : " (estimated)"}`} aria-label={band.label}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`w-1 rounded-sm ${i <= band.bars ? "bg-accent" : "bg-panel-3"}`} style={{ height: `${4 + i * 3}px` }} />
      ))}
    </span>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
      {Object.entries(MASTERY).map(([key, m]) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span className={`w-2.5 h-2.5 rounded-full ${m.dot}`} /> {m.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <WeightBadge weight={1} /> exam weight
      </span>
    </div>
  );
}

// ---- Tree ----------------------------------------------------------------------------

function TreeNode({ node, childrenOf, depth, open, onToggle, onSelect, selectedId }) {
  const kids = childrenOf.get(node.id) ?? [];
  const isOpen = open.has(node.id);
  const m = MASTERY[node.mastery.status];
  return (
    <li>
      <div
        className={`group flex items-center gap-2 min-h-10 pr-2 rounded-xl ${selectedId === node.id ? "bg-accent-soft" : "hover:bg-panel-2"}`}
        style={{ paddingLeft: `${4 + depth * 18}px` }}
      >
        {kids.length ? (
          <IconButton icon={isOpen ? "expand_more" : "chevron_right"} label={isOpen ? "Collapse" : "Expand"} className="w-7! h-7! shrink-0" size={18} onClick={() => onToggle(node.id)} />
        ) : (
          <span className="w-7 shrink-0" />
        )}
        <button type="button" onClick={() => onSelect(node.id)} className="flex-1 min-w-0 flex items-center gap-2.5 py-1.5 text-left">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${m.dot}`} title={m.label} />
          <span className={`min-w-0 truncate ${node.level === "subject" ? "font-display font-semibold" : node.level === "chapter" ? "text-sm font-semibold" : "text-sm"}`}>{node.name}</span>
          {node.syllabusRef && <span className="shrink-0 text-[11px] text-ink-3 max-sm:hidden">{node.syllabusRef}</span>}
          <WeightBadge weight={node.weight} source={node.weightSource} />
          {node.paperQuestions > 0 && (
            <span className="shrink-0 text-[11px] px-1.5 rounded bg-amber-400/20 text-amber-700 dark:text-amber-300 font-semibold" title="Past-paper questions on this">
              {node.paperQuestions} PYQ
            </span>
          )}
        </button>
        <span className={`shrink-0 text-xs tabular-nums ${m.text}`}>{node.mastery.attempts ? pct(node.mastery.score) : ""}</span>
      </div>
      {isOpen && kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <TreeNode key={k.id} node={k} childrenOf={childrenOf} depth={depth + 1} open={open} onToggle={onToggle} onSelect={onSelect} selectedId={selectedId} />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---- Prerequisite graph (layered, left to right) -----------------------------------------

const COL = 230;
const ROW = 58;
const BOX_W = 190;
const BOX_H = 40;

function PrereqGraph({ nodes, edges, onSelect }) {
  const layout = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const linked = [...new Set(edges.flatMap((e) => [e.from, e.to]))].filter((id) => byId.has(id));
    const incoming = new Map(linked.map((id) => [id, edges.filter((e) => e.to === id).map((e) => e.from)]));
    const layer = new Map();
    const depthOf = (id, seen = new Set()) => {
      if (layer.has(id)) return layer.get(id);
      if (seen.has(id)) return 0;
      seen.add(id);
      const d = Math.max(-1, ...(incoming.get(id) ?? []).map((p) => depthOf(p, seen))) + 1;
      layer.set(id, d);
      return d;
    };
    linked.forEach((id) => depthOf(id));
    const columns = [];
    for (const id of linked) (columns[layer.get(id)] ??= []).push(byId.get(id));
    const pos = new Map();
    columns.forEach((col, x) => col.forEach((n, y) => pos.set(n.id, { x: 16 + x * COL, y: 16 + y * ROW })));
    return { columns, pos, linked };
  }, [nodes, edges]);

  if (!layout.linked.length) return <p className="text-sm text-ink-3 py-6 text-center">No prerequisite links between topics yet.</p>;
  const width = 32 + (layout.columns.length - 1) * COL + BOX_W;
  const height = 32 + (Math.max(...layout.columns.map((c) => c.length)) - 1) * ROW + BOX_H;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return (
    <div className="overflow-x-auto scroll-thin -mx-1 px-1">
      <p className="text-xs text-ink-3 mb-2">Arrows point from what to learn first to what builds on it.</p>
      <svg width={width} height={height} role="img" aria-label="Prerequisite links between topics" className="block">
        <defs>
          <marker id="km-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="rgb(var(--ink-3))" />
          </marker>
        </defs>
        {edges.map((e) => {
          const a = layout.pos.get(e.from);
          const b = layout.pos.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + BOX_W;
          const y1 = a.y + BOX_H / 2;
          const x2 = b.x - 2;
          const y2 = b.y + BOX_H / 2;
          const mid = (x1 + x2) / 2;
          return <path key={`${e.from}-${e.to}`} d={`M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} fill="none" stroke="rgb(var(--ink-3))" strokeOpacity="0.6" strokeWidth="1.5" markerEnd="url(#km-arrow)" />;
        })}
        {[...layout.pos.entries()].map(([id, p]) => {
          const n = byId.get(id);
          const m = MASTERY[n.mastery.status];
          return (
            <g key={id} transform={`translate(${p.x} ${p.y})`} className="cursor-pointer" onClick={() => onSelect(id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onSelect(id)}>
              <rect width={BOX_W} height={BOX_H} rx="10" fill={m.fill} stroke="rgb(var(--line))" />
              <text x="12" y={BOX_H / 2 + 4} fontSize="13" fill="rgb(var(--ink))">
                {n.name.length > 24 ? `${n.name.slice(0, 23)}…` : n.name}
              </text>
              <title>{`${n.name} — ${m.label}`}</title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---- Node detail ----------------------------------------------------------------------

function History({ history }) {
  if (!history.length) return <p className="text-sm text-ink-3">No practice on this yet.</p>;
  const recent = [...history].reverse().slice(-24);
  return (
    <div>
      <div className="flex items-end gap-1 h-16" aria-label="Recent scores, oldest to newest">
        {recent.map((h, i) => (
          <span
            key={i}
            title={`${Math.round(h.score * 100)}% · ${h.kind} · ${timeAgo(h.createdAt)}`}
            className={`flex-1 max-w-3 rounded-t ${h.score >= 0.75 ? "bg-success" : h.score >= 0.5 ? "bg-gold" : "bg-danger"}`}
            style={{ height: `${Math.max(8, h.score * 100)}%` }}
          />
        ))}
      </div>
      <p className="text-xs text-ink-3 mt-1">Last {recent.length} answers, oldest → newest</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h3>
      {children}
    </section>
  );
}

function LinkList({ items, onSelect }) {
  return items.length ? (
      <div className="flex flex-wrap gap-1.5">
        {items.map((p) => (
          <button key={p.id} type="button" className="h-8 px-3 rounded-lg border border-line text-sm hover:bg-panel-2" onClick={() => onSelect(p.id)}>
            {p.name}
          </button>
        ))}
      </div>
    ) : (
      <p className="text-sm text-ink-3">None</p>
    );
}


function NodeDetail({ notebookId, nodeId, onClose, onSelect, onOpenCitation, onPractise, onAsk }) {
  // The last loaded node ({ key, node } or { key, error }); shown only while it's the selected one.
  const key = `${notebookId}:${nodeId}`;
  const [loaded, setLoaded] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.mapNode(notebookId, nodeId).then(
      (n) => !cancelled && setLoaded({ key, node: n }),
      (err) => !cancelled && setLoaded({ key, error: err.message })
    );
    return () => {
      cancelled = true;
    };
  }, [notebookId, nodeId, key]);
  const node = loaded?.key === key ? loaded.node ?? null : null;
  const error = loaded?.key === key ? loaded.error ?? null : null;

  const m = node && MASTERY[node.mastery.status];
  const band = node && weightBand(node.weight);
  return (
    <SlideOver label={node?.name ?? "Knowledge map node"} onClose={onClose}>
      <div className="flex items-center gap-2 h-14 px-4 border-b border-line/60 shrink-0">
        <IconButton icon="close" label="Close" onClick={onClose} />
        <p className="min-w-0 truncate text-sm text-ink-3">{node ? node.ancestors.map((a) => a.name).join(" › ") || LEVEL_LABEL[node.level] : ""}</p>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin p-5 flex flex-col gap-6">
        {error && <p className="text-sm text-danger">{error}</p>}
        {!node && !error && <Spinner className="w-5 h-5 text-ink-3" />}
        {node && (
          <>
            <div>
              <p className="text-xs text-ink-3">
                {LEVEL_LABEL[node.level]}
                {node.syllabusRef ? ` · ${node.syllabusRef}` : ""}
              </p>
              <h2 className="font-display text-2xl font-semibold leading-tight mt-0.5">{node.name}</h2>
              {node.description && <p className="text-sm text-ink-2 mt-2">{node.description}</p>}
              <div className="flex flex-wrap items-center gap-2 mt-3 text-sm">
                <span className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-panel-2 font-medium ${m.text}`}>
                  <span className={`w-2.5 h-2.5 rounded-full ${m.dot}`} /> {m.label}
                  {node.mastery.attempts ? ` · ${pct(node.mastery.score)}` : ""}
                </span>
                {band && (
                  <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-panel-2 text-ink-2">
                    <WeightBadge weight={node.weight} source={node.weightSource} /> {band.label}
                    {node.weightSource === "past_papers" ? " (past papers)" : ""}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mt-4">
                <button type="button" className="btn-primary" onClick={() => onPractise(node)}>
                  <Icon name="exercise" size={18} /> Practise this
                </button>
                <button type="button" className="btn-outline" onClick={() => onAsk(node)}>
                  <Icon name="chat" size={18} /> Ask in chat
                </button>
              </div>
            </div>

            <Section title="Your mastery">
              <p className="text-sm text-ink-2">
                {node.mastery.attempts
                  ? `${node.mastery.attempts} answer${node.mastery.attempts === 1 ? "" : "s"} · ${pct(node.mastery.accuracy)} correct · last practised ${timeAgo(node.mastery.lastPractisedAt)}`
                  : "Not practised yet."}
              </p>
              <History history={node.history} />
            </Section>

            <Section title="Learn first">
              <LinkList items={node.prerequisites} onSelect={onSelect} />
            </Section>
            {node.dependants.length > 0 && (
              <Section title="Builds towards">
                <LinkList items={node.dependants} onSelect={onSelect} />
              </Section>
            )}

            <Section title="In your sources">
              {node.citations.length ? (
                <ul className="flex flex-col gap-2">
                  {node.citations.map((c) => (
                    <li key={`${c.sourceId}-${c.number}`}>
                      <button type="button" className="w-full text-left p-3 rounded-xl border border-line hover:bg-panel-2" onClick={() => onOpenCitation(c)}>
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-2">
                          <Icon name="description" size={15} />
                          <span className="truncate">{c.sourceTitle}</span>
                          {c.location && <span className="shrink-0 px-1.5 rounded bg-accent-soft text-accent-soft-fg">{c.location}</span>}
                        </p>
                        <p className="text-sm text-ink line-clamp-3 mt-1">{c.text}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-3">No passages found in the notes.</p>
              )}
            </Section>

            <Section title={`Past-paper questions (${node.pastPaperQuestions.length})`}>
              {node.pastPaperQuestions.length ? (
                <ul className="flex flex-col gap-2">
                  {node.pastPaperQuestions.map((q) => (
                    <li key={q.id} className="p-3 rounded-xl bg-panel-2 text-sm">
                      <p className="text-xs text-ink-3 mb-1">{[q.examName ?? q.sourceTitle, q.year, q.marks ? `${q.marks} marks` : null].filter(Boolean).join(" · ")}</p>
                      <p className="whitespace-pre-line">{q.text}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-3">None placed here yet.</p>
              )}
            </Section>
          </>
        )}
      </div>
    </SlideOver>
  );
}

// ---- Panel ------------------------------------------------------------------------------

export default function KnowledgeMapPanel({ notebook, canEdit, sourcesKey, onOpenCitation, onPractise, onAsk, onAddSources, onProfileChange }) {
  const [map, setMap] = useState(null);
  const [error, setError] = useState(null);
  const [view, setView] = useState("tree");
  const [opened, setOpened] = useState(null); // null until the first toggle: subjects and chapters open
  const [selected, setSelected] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState(null);

  const load = useCallback(() => api.knowledgeMap(notebook.id).then(setMap, (err) => setError(err.message)), [notebook.id]);
  useEffect(() => {
    load();
  }, [load, sourcesKey]);
  useEffect(() => {
    api.getExamProfile(notebook.id).then(setProfile, () => {});
  }, [notebook.id]);
  useEffect(() => {
    if (map?.status !== "pending") return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [map?.status, load]);

  const childrenOf = useMemo(() => {
    const m = new Map();
    for (const n of map?.nodes ?? []) {
      if (!m.has(n.parentId)) m.set(n.parentId, []);
      m.get(n.parentId).push(n);
    }
    return m;
  }, [map]);
  // Subjects and chapters start open.
  const defaultOpen = useMemo(() => new Set((map?.nodes ?? []).filter((n) => n.level === "subject" || n.level === "chapter").map((n) => n.id)), [map]);
  const open = opened ?? defaultOpen;

  const toggle = (id) => setOpened((s) => {
    const next = new Set(s ?? defaultOpen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const rebuild = async () => {
    try {
      await api.rebuildKnowledgeMap(notebook.id);
      setMap((m) => ({ ...m, status: "pending" }));
    } catch (err) {
      toast(err.message, "error");
    }
  };
  const counts = useMemo(() => {
    const c = { not_started: 0, weak: 0, ok: 0, strong: 0 };
    for (const n of map?.nodes ?? []) if (n.level === "topic") c[n.mastery.status] += 1;
    return c;
  }, [map]);

  const roots = childrenOf.get(null) ?? [];
  const empty = map && map.nodes.length === 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex flex-wrap items-center gap-3 px-4 sm:px-6 pt-4 pb-3 border-b border-line/60">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-semibold">Knowledge map</h2>
          <p className="text-xs text-ink-3 truncate">
            {profile?.profile ? `${profile.profile.name}${profile.profile.subjects.length ? ` · ${profile.profile.subjects.join(", ")}` : ""}` : "No exam chosen"}
            {map?.builtAt ? ` · built ${timeAgo(map.builtAt)}` : ""}
          </p>
        </div>
        {canEdit && (
          <button type="button" className="btn-outline h-9" onClick={() => setProfileOpen(true)}>
            <Icon name="school" size={18} /> {profile?.examType ? "Change exam" : "Choose exam"}
          </button>
        )}
        {canEdit && map && map.sourceCount > 0 && (
          <button type="button" className="btn-ghost h-9" onClick={rebuild} disabled={map.status === "pending"} title="Rebuild the map from the syllabus, notes and past papers">
            {map.status === "pending" ? <Spinner /> : <Icon name="refresh" size={18} />} <span className="max-sm:hidden">Rebuild</span>
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-3 sm:px-6 py-4 flex flex-col gap-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        {!map && !error && (
          <div className="flex justify-center py-10 text-ink-3">
            <Spinner className="w-6 h-6" />
          </div>
        )}
        {map?.status === "error" && <p className="rounded-xl bg-danger/10 text-danger text-sm px-3 py-2">The map couldn't be built: {map.error}</p>}
        {map?.status === "pending" && (
          <p className="flex items-center gap-2 rounded-xl bg-accent-soft text-accent-soft-fg text-sm px-3 py-2">
            <Spinner /> {empty ? "Building the knowledge map from your syllabus, notes and past papers…" : "Updating the map from your latest sources…"}
          </p>
        )}
        {empty && map.status !== "pending" && (
          <div className="flex flex-col items-center text-center gap-3 py-10 max-w-md mx-auto">
            <span className="w-14 h-14 rounded-2xl bg-accent-soft text-accent flex items-center justify-center">
              <Icon name="account_tree" size={30} />
            </span>
            <h3 className="font-display text-lg font-semibold">Map out what the exam covers</h3>
            <p className="text-sm text-ink-2">
              Add the <b>syllabus</b> (plus your notes and past papers) and CourseMate builds a map of subjects, chapters and topics — with what to learn first and how often each topic is examined — then colours it by how well you know each part.
            </p>
            {canEdit ? (
              <div className="flex flex-wrap justify-center gap-2">
                {onAddSources && (
                  <button type="button" className="btn-primary" onClick={() => onAddSources("syllabus")}>
                    <Icon name="upload_file" size={18} /> Add the syllabus
                  </button>
                )}
                {map.sourceCount > 0 && (
                  <button type="button" className="btn-outline" onClick={rebuild}>
                    <Icon name="account_tree" size={18} /> Build from current sources
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-ink-3">The course's owner or an editor can add the syllabus.</p>
            )}
          </div>
        )}
        {map && !empty && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                label="Map view"
                value={view}
                onChange={setView}
                options={[
                  ["tree", "Tree"],
                  ["prereqs", "Prerequisites"],
                ]}
              />
              <p className="text-xs text-ink-3 tabular-nums">
                Topics: {counts.strong} strong · {counts.ok} OK · {counts.weak} weak · {counts.not_started} not started
              </p>
            </div>
            <Legend />
            {view === "tree" ? (
              <ul className="flex flex-col">
                {roots.map((n) => (
                  <TreeNode key={n.id} node={n} childrenOf={childrenOf} depth={0} open={open} onToggle={toggle} onSelect={setSelected} selectedId={selected} />
                ))}
              </ul>
            ) : (
              <PrereqGraph nodes={map.nodes} edges={map.edges} onSelect={setSelected} />
            )}
          </>
        )}
      </div>

      {selected && (
        <NodeDetail
          notebookId={notebook.id}
          nodeId={selected}
          onClose={() => setSelected(null)}
          onSelect={setSelected}
          onOpenCitation={(c) => {
            setSelected(null);
            onOpenCitation(c);
          }}
          onPractise={(node) => {
            setSelected(null);
            onPractise(node);
          }}
          onAsk={(node) => {
            setSelected(null);
            onAsk(node);
          }}
        />
      )}
      {canEdit && (
        <ExamProfileDialog
          notebookId={notebook.id}
          open={profileOpen}
          current={profile}
          onClose={() => setProfileOpen(false)}
          onSaved={(p) => {
            setProfile(p);
            onProfileChange?.(p);
            load();
          }}
        />
      )}
    </div>
  );
}
