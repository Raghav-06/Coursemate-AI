import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { Icon, Menu, Modal, Spinner } from "../ui";
import CitationLink from "../study/CitationLink";
import { toast } from "../uiUtils";

const POLL_MS = 4000;

function RankBar({ value, max }) {
  return (
    <div className="h-2 rounded-full bg-panel-3 overflow-hidden">
      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(6, (value / Math.max(1, max)) * 100)}%` }} />
    </div>
  );
}

const statLine = (g) =>
  [`${g.count} question${g.count === 1 ? "" : "s"}`, g.totalMarks ? `${g.totalMarks} marks` : null, g.years.length ? g.years.join(", ") : null].filter(Boolean).join(" · ");

function PaperChip({ paper, onAnalyse }) {
  const pending = paper.status === "processing" || paper.paperStatus === "pending";
  return (
    <div className="flex items-center gap-2 pl-3 pr-1 h-10 rounded-xl border border-line bg-panel text-sm max-w-full" title={paper.paperError ?? paper.title}>
      <Icon name="history_edu" size={18} className="text-amber-500 shrink-0" />
      <span className="truncate font-medium">{[paper.examName, paper.examYear].filter(Boolean).join(" ") || paper.title}</span>
      {pending ? (
        <Spinner className="w-3.5 h-3.5 text-ink-3 shrink-0" />
      ) : paper.paperStatus === "error" ? (
        <Icon name="error" size={16} className="text-danger shrink-0" />
      ) : (
        <span className="text-xs text-ink-3 shrink-0 tabular-nums">{paper.questionCount} Q</span>
      )}
      <Menu
        buttonClassName="w-8! h-8!"
        label={`${paper.title} options`}
        items={[!pending && paper.status === "ready" && { label: "Find questions again", icon: "manage_search", onClick: () => onAnalyse(paper.id) }].filter(Boolean)}
      />
    </div>
  );
}

function TopicDialog({ question, topics, units, onClose, onSave }) {
  const [value, setValue] = useState(question?.topicId ?? "");
  const groups = [...units.map((u) => ({ id: u.id, title: u.title })), { id: null, title: "General" }]
    .map((g) => ({ ...g, topics: topics.filter((t) => (t.unitId ?? null) === g.id) }))
    .filter((g) => g.topics.length);
  return (
    <Modal
      open={Boolean(question)}
      onClose={onClose}
      title="Change topic"
      width="max-w-md"
      bodyClassName="px-6 pb-2"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={() => onSave(value || null)}>
            Save
          </button>
        </>
      }
    >
      <p className="text-sm text-ink-2 mb-3 line-clamp-3">{question?.text}</p>
      <select className="input" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Topic">
        <option value="">Not mapped</option>
        {groups.map((g) => (
          <optgroup key={g.id ?? "general"} label={g.title}>
            {g.topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </Modal>
  );
}

function QuestionCard({ question, unitTitle, onOpenCitation, onPractise, onChangeTopic }) {
  return (
    <div className="flex flex-col gap-2.5 p-4 rounded-2xl border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {question.number && <span className="font-semibold text-ink">{/^q/i.test(question.number) ? question.number : `Q${question.number}`}</span>}
        {question.marks !== null && <span className="px-2 py-0.5 rounded-full bg-accent-soft text-accent-soft-fg font-semibold tabular-nums">{question.marks} marks</span>}
        {question.year && <span className="px-2 py-0.5 rounded-full bg-panel-3 text-ink-2 tabular-nums">{question.year}</span>}
        <span className="text-ink-3 truncate">{[question.examName ?? question.sourceTitle, question.section].filter(Boolean).join(" · ")}</span>
        <span className="ml-auto" />
        {onChangeTopic && <Menu buttonClassName="w-8! h-8!" items={[{ label: "Change topic", icon: "sell", onClick: () => onChangeTopic(question) }]} />}
      </div>
      <p className="text-sm leading-6 whitespace-pre-wrap">{question.text}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {question.topic ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-panel-2 text-xs text-ink-2">
            <Icon name="sell" size={14} /> {question.topic}
            {unitTitle && <span className="text-ink-3">· {unitTitle}</span>}
          </span>
        ) : (
          <span className="px-2 py-1 rounded-lg bg-panel-2 text-xs text-ink-3">No matching topic{unitTitle ? ` · ${unitTitle}` : ""}</span>
        )}
      </div>
      {question.citations.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-3">Answer in:</span>
          {question.citations.slice(0, 2).map((c) => (
            <CitationLink key={`${c.sourceId}-${c.chunk}`} citation={c} onOpen={onOpenCitation} />
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <button type="button" className="btn-outline h-8 px-3 text-xs" onClick={() => onPractise(question)}>
          <Icon name="edit_note" size={16} /> Practise this question
        </button>
      </div>
    </div>
  );
}

/**
 * Exam insights: what past papers ask about. Topics and units ranked by
 * frequency, marks and years; every question with where its answer is in the
 * course material, filterable by unit / topic / year.
 */
export default function ExamInsightsPanel({ notebook, units, onOpenCitation, onPractise, onAddPaper, sourcesKey, initialTopicId = "" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ unitId: "", topicId: initialTopicId ?? "", year: "" });
  const [questions, setQuestions] = useState(null);
  const [topics, setTopics] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = useCallback(
    () =>
      api.examInsights(notebook.id).then(
        (d) => {
          setData(d);
          setError(null);
        },
        (err) => setError(err.message)
      ),
    [notebook.id]
  );

  const loadQuestions = useCallback(
    () => api.pastPaperQuestions(notebook.id, filters).then(setQuestions, (err) => toast(err.message, "error")),
    [notebook.id, filters]
  );

  useEffect(() => {
    load();
  }, [load, sourcesKey]);

  useEffect(() => {
    loadQuestions();
  }, [loadQuestions, data]);

  useEffect(() => {
    api.getTopics(notebook.id).then((groups) => setTopics(groups.flatMap((g) => g.topics)), () => {});
  }, [notebook.id, data]);

  const pending = data?.papers.some((p) => p.status === "processing" || p.paperStatus === "pending");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, load]);

  const analyse = async (sourceId) => {
    try {
      await api.analysePaper(sourceId);
      toast("Finding the questions again…");
      load();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const saveTopic = async (topicId) => {
    const question = editing;
    setEditing(null);
    try {
      await api.updatePastPaperQuestion(notebook.id, question.id, { topicId });
      load();
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const unitTitle = (id) => (id ? units.find((u) => u.id === id)?.title : null);
  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const filtered = filters.unitId || filters.topicId || filters.year;
  const maxTopic = Math.max(1, ...(data?.topics ?? []).map((t) => t.count));
  const maxUnit = Math.max(1, ...(data?.units ?? []).map((u) => u.count));

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-xl font-semibold mr-auto">Past-paper insights</h2>
          {onAddPaper && (
            <button type="button" className="btn-outline h-9 px-4 text-sm" onClick={onAddPaper}>
              <Icon name="add" size={18} /> Add past paper
            </button>
          )}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        {!data && !error && (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-14 rounded-2xl" />
            ))}
          </div>
        )}

        {data && data.papers.length === 0 && (
          <div className="flex flex-col items-center text-center gap-3 py-10 px-6 rounded-3xl border border-dashed border-line">
            <Icon name="history_edu" size={36} className="text-ink-3" />
            <p className="text-sm font-medium text-ink-2">No past papers yet</p>
            <p className="text-xs text-ink-3 max-w-sm leading-5">
              Add previous years' exam papers. CourseMate pulls out every question, maps it to your units and topics, and shows what gets asked most — and where the
              answers are in your notes.
            </p>
            {onAddPaper && (
              <button type="button" className="btn-primary" onClick={onAddPaper}>
                <Icon name="upload_file" size={18} /> Add past papers
              </button>
            )}
          </div>
        )}

        {data && data.papers.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2">
              {data.papers.map((p) => (
                <PaperChip key={p.id} paper={p} onAnalyse={analyse} />
              ))}
            </div>

            {data.totalQuestions === 0 ? (
              <p className="text-sm text-ink-3">{pending ? "Finding the questions in your papers…" : "No questions found yet."}</p>
            ) : (
              <>
                <section className="flex flex-col gap-3">
                  <div className="flex items-baseline gap-2">
                    <h3 className="font-display text-base font-semibold">Most examined topics</h3>
                    <span className="text-xs text-ink-3">
                      {data.totalQuestions} questions{data.unmapped ? ` · ${data.unmapped} without a topic` : ""}
                    </span>
                  </div>
                  {data.topics.length === 0 && <p className="text-sm text-ink-3">No questions matched a topic yet.</p>}
                  <ol className="flex flex-col gap-1">
                    {data.topics.slice(0, 12).map((t, i) => (
                      <li key={t.topicId}>
                        <button
                          type="button"
                          onClick={() => setFilters({ unitId: "", year: "", topicId: filters.topicId === t.topicId ? "" : t.topicId })}
                          className={`w-full grid grid-cols-[1.5rem_1fr_6rem] sm:grid-cols-[1.5rem_1fr_9rem] items-center gap-3 px-3 py-2 rounded-xl text-left ${
                            filters.topicId === t.topicId ? "bg-accent-soft" : "hover:bg-panel-2"
                          }`}
                        >
                          <span className="text-xs font-semibold text-ink-3 tabular-nums">{i + 1}</span>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium truncate">{t.name}</span>
                            <span className="block text-xs text-ink-3 truncate">
                              {t.unitTitle} · {statLine(t)}
                            </span>
                          </span>
                          <RankBar value={t.count} max={maxTopic} />
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>

                <section className="flex flex-col gap-2">
                  <h3 className="font-display text-base font-semibold">By unit</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {data.units.map((u) => (
                      <button
                        key={u.unitId ?? "general"}
                        type="button"
                        onClick={() => setFilters({ topicId: "", year: "", unitId: filters.unitId === (u.unitId ?? "general") ? "" : u.unitId ?? "general" })}
                        className={`flex flex-col gap-1.5 p-3 rounded-2xl border text-left ${filters.unitId === (u.unitId ?? "general") ? "border-accent bg-accent-soft" : "border-line hover:bg-panel-2"}`}
                      >
                        <span className="text-sm font-medium truncate">{u.title}</span>
                        <RankBar value={u.count} max={maxUnit} />
                        <span className="text-xs text-ink-3 truncate">{statLine(u)}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-base font-semibold mr-auto">Questions</h3>
                    <select className="input w-auto! py-1.5! text-sm" value={filters.unitId} onChange={(e) => setFilter("unitId", e.target.value)} aria-label="Filter by unit">
                      <option value="">All units</option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.title}
                        </option>
                      ))}
                      <option value="general">General / unplaced</option>
                    </select>
                    <select className="input w-auto! max-w-[200px] py-1.5! text-sm" value={filters.topicId} onChange={(e) => setFilter("topicId", e.target.value)} aria-label="Filter by topic">
                      <option value="">All topics</option>
                      {data.topics.map((t) => (
                        <option key={t.topicId} value={t.topicId}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <select className="input w-auto! py-1.5! text-sm" value={filters.year} onChange={(e) => setFilter("year", e.target.value)} aria-label="Filter by year">
                      <option value="">All years</option>
                      {data.years.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                    {filtered && (
                      <button type="button" className="btn-ghost h-9 px-3 text-sm" onClick={() => setFilters({ unitId: "", topicId: "", year: "" })}>
                        Clear
                      </button>
                    )}
                  </div>
                  {!questions && <Spinner className="w-5 h-5 text-ink-3" />}
                  {questions?.length === 0 && <p className="text-sm text-ink-3">No questions match these filters.</p>}
                  {questions?.map((q) => (
                    <QuestionCard key={q.id} question={q} unitTitle={unitTitle(q.unitId)} onOpenCitation={onOpenCitation} onPractise={onPractise} onChangeTopic={notebook.role !== "viewer" ? setEditing : undefined} />
                  ))}
                </section>
              </>
            )}
          </>
        )}
      </div>
      {editing && <TopicDialog question={editing} topics={topics} units={units} onClose={() => setEditing(null)} onSave={saveTopic} />}
    </div>
  );
}
