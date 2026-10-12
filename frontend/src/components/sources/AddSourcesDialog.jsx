import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { Icon, IconButton, Modal, Segmented, Spinner, toast } from "../ui";

const ACCEPTED = [".pdf", ".docx", ".pptx", ".txt", ".md", ".csv"];
const MAX_BYTES = 200 * 1024 * 1024;
const MAX_SOURCES = 50;

function OptionCard({ icon, title, subtitle, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-2 p-4 rounded-2xl border border-line hover:bg-panel-2 text-left transition-colors"
    >
      <span className="w-9 h-9 rounded-full bg-accent-soft text-accent-soft-fg flex items-center justify-center">
        <Icon name={icon} size={20} />
      </span>
      <span className="text-sm font-medium text-ink">{title}</span>
      <span className="text-xs text-ink-3 leading-5">{subtitle}</span>
    </button>
  );
}

function UploadHome({ onFiles, uploading, setMode }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-ink-2 leading-6">
        Sources let CourseMate AI base its responses on the information that matters most to you. (Examples: lecture notes, course
        readings, research papers, textbook chapters, slide decks, etc.)
      </p>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!uploading) onFiles([...e.dataTransfer.files]);
        }}
        className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragging ? "border-accent bg-accent-soft/40" : "border-line"
        }`}
      >
        <span className="w-12 h-12 rounded-full bg-accent-soft text-accent-soft-fg flex items-center justify-center">
          {uploading ? <Spinner className="w-5 h-5" /> : <Icon name="upload" size={26} />}
        </span>
        <p className="font-display text-base font-medium">Upload sources</p>
        <p className="text-sm text-ink-2">
          Drag & drop or{" "}
          <button type="button" className="text-accent font-medium hover:underline" onClick={() => inputRef.current?.click()} disabled={uploading}>
            choose files
          </button>{" "}
          to upload
        </p>
        <p className="text-xs text-ink-3">Supported file types: PDF, DOCX, PPTX, TXT, Markdown, CSV</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED.join(",")}
          className="hidden"
          onChange={(e) => {
            onFiles([...e.target.files]);
            e.target.value = "";
          }}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <OptionCard icon="link" title="Link" subtitle="Websites and online PDFs" onClick={() => setMode("link")} />
        <OptionCard icon="content_paste" title="Paste text" subtitle="Copied text from anywhere" onClick={() => setMode("text")} />
        <OptionCard icon="travel_explore" title="Discover" subtitle="Find research papers on arXiv" onClick={() => setMode("discover")} />
      </div>
    </div>
  );
}

function LinkForm({ onSubmit, busy }) {
  const [value, setValue] = useState("");
  const urls = value.split(/\s+/).filter(Boolean);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(urls);
      }}
    >
      <p className="text-sm text-ink-2">Paste one or more URLs (separated by spaces or new lines) to add them as sources.</p>
      <textarea className="input min-h-[120px] resize-y font-mono text-[13px]" placeholder="https://…" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      <ul className="text-xs text-ink-3 list-disc pl-5 space-y-1">
        <li>Only the visible text of a web page is imported. Pages behind a login or built entirely in JavaScript may not work.</li>
        <li>Links to PDFs and plain-text files are downloaded and read in full.</li>
      </ul>
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={busy || urls.length === 0}>
          {busy && <Spinner />} Insert
        </button>
      </div>
    </form>
  );
}

function TextForm({ onSubmit, busy }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(title, text);
      }}
    >
      <p className="text-sm text-ink-2">Paste your copied text below to upload it as a source.</p>
      <input className="input" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="input min-h-[220px] resize-y" placeholder="Paste text here*" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={busy || !text.trim()}>
          {busy && <Spinner />} Insert
        </button>
      </div>
    </form>
  );
}

function Discover({ onAdd, busy, remaining }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(new Set());

  const search = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setPicked(new Set());
    try {
      setResults(await api.searchArxiv(query.trim()));
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setSearching(false);
    }
  };

  const toggle = (i) =>
    setPicked((set) => {
      const next = new Set(set);
      if (next.has(i)) next.delete(i);
      else if (next.size < remaining) next.add(i);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={search} className="flex gap-2">
        <input className="input" placeholder="What are you interested in? e.g. transformer attention" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        <button type="submit" className="btn-primary shrink-0" disabled={searching || !query.trim()}>
          {searching ? <Spinner /> : <Icon name="search" size={18} />} Search
        </button>
      </form>
      {results?.length === 0 && <p className="text-sm text-ink-3">No papers found. Try different keywords.</p>}
      {results?.length > 0 && (
        <>
          <div className="flex flex-col gap-2 max-h-[45vh] overflow-y-auto scroll-thin pr-1">
            {results.map((paper, i) => (
              <label key={paper.link ?? i} className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${picked.has(i) ? "border-accent bg-accent-soft/30" : "border-line hover:bg-panel-2"}`}>
                <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} className="mt-1 w-4 h-4 shrink-0 accent-[rgb(var(--accent))]" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">{paper.title}</span>
                  <span className="block text-xs text-ink-3 mt-0.5 truncate">
                    {paper.authors.slice(0, 4).join(", ")}
                    {paper.authors.length > 4 ? " et al." : ""} · {paper.published?.slice(0, 4)}
                  </span>
                  <span className="block text-xs text-ink-2 mt-1 line-clamp-2">{paper.summary}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex justify-end">
            <button type="button" className="btn-primary" disabled={busy || picked.size === 0} onClick={() => onAdd([...picked].map((i) => results[i]))}>
              {busy && <Spinner />} Import {picked.size || ""} paper{picked.size === 1 ? "" : "s"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const TITLES = { home: "Add sources", link: "Website or PDF link", text: "Paste copied text", discover: "Discover sources" };

function UnitPicker({ units, value, onChange }) {
  return (
    <label className="flex items-center gap-3 mb-4 text-sm text-ink-2">
      <Icon name="folder" size={20} className="text-ink-3" />
      Add to
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className="input w-auto! flex-1 min-w-0 py-1.5!" aria-label="Unit for the new sources">
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.title}
          </option>
        ))}
        <option value="">General (no unit)</option>
      </select>
    </label>
  );
}

const THIS_YEAR = new Date().getFullYear();

/** Course material or a past exam paper (with optional exam name and year). */
function KindPicker({ value, onChange }) {
  const paper = value.kind === "past_paper";
  return (
    <div className="flex flex-col gap-2 mb-4">
      <div className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
        <Icon name="category" size={20} className="text-ink-3" />
        <span>These are</span>
        <Segmented
          label="Kind of source"
          value={value.kind}
          onChange={(kind) => onChange({ ...value, kind })}
          options={[
            ["material", "Course material"],
            ["past_paper", "Past exam papers"],
          ]}
        />
      </div>
      {paper && (
        <div className="flex flex-wrap items-center gap-2 pl-8">
          <input
            className="input flex-1 min-w-[160px] py-1.5!"
            placeholder="Exam name (optional), e.g. End-semester"
            maxLength={120}
            value={value.examName}
            onChange={(e) => onChange({ ...value, examName: e.target.value })}
            aria-label="Exam name"
          />
          <input
            className="input w-28! py-1.5!"
            type="number"
            inputMode="numeric"
            min={1950}
            max={THIS_YEAR + 1}
            placeholder="Year"
            value={value.examYear}
            onChange={(e) => onChange({ ...value, examYear: e.target.value })}
            aria-label="Exam year"
          />
          <p className="basis-full text-xs text-ink-3">
            Past papers are kept out of chat answers by default. CourseMate pulls out their questions and maps them to your units and topics in Exam insights.
          </p>
        </div>
      )}
    </div>
  );
}

const NO_KIND = { kind: "material", examName: "", examYear: "" };

export default function AddSourcesDialog({ open, onClose, notebookId, sourceCount, units = [], defaultUnitId = null, defaultKind = "material", onAdded }) {
  const [mode, setMode] = useState("home");
  const [busy, setBusy] = useState(false);
  const [unitId, setUnitId] = useState(defaultUnitId);
  const [kind, setKind] = useState(NO_KIND);
  const remaining = MAX_SOURCES - sourceCount;

  useEffect(() => {
    if (open) {
      setMode("home");
      setUnitId(defaultUnitId);
      setKind({ ...NO_KIND, kind: defaultKind });
    }
  }, [open, defaultUnitId, defaultKind]);

  // Fields sent with new sources; a year outside 1950..next year is dropped.
  const year = Number(kind.examYear);
  const kindFields =
    kind.kind === "past_paper"
      ? { kind: "past_paper", examName: kind.examName.trim() || undefined, examYear: Number.isInteger(year) && year >= 1950 && year <= THIS_YEAR + 1 ? year : undefined }
      : {};

  const run = async (fn) => {
    setBusy(true);
    try {
      onAdded(await fn());
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = (files) => {
    const valid = [];
    for (const file of files) {
      const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
      if (!ACCEPTED.includes(ext)) toast(`"${file.name}" isn't a supported file type.`, "error");
      else if (file.size > MAX_BYTES) toast(`"${file.name}" is larger than 200MB.`, "error");
      else valid.push(file);
    }
    if (valid.length === 0) return;
    if (valid.length > remaining) {
      toast(`You can add ${remaining} more source${remaining === 1 ? "" : "s"} to this course.`, "error");
      return;
    }
    run(() => api.uploadFiles(notebookId, valid, unitId, kindFields));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-2xl"
      title={
        <span className="flex items-center gap-1">
          {mode !== "home" && <IconButton icon="arrow_back" label="Back" onClick={() => setMode("home")} className="-ml-2" />}
          {TITLES[mode]}
        </span>
      }
      bodyClassName="px-6 pb-4"
      footer={
        <div className="w-full flex items-center gap-3 text-xs text-ink-3">
          <Icon name="folder_open" size={18} />
          Source limit
          <div className="flex-1 h-1.5 rounded-full bg-panel-3 overflow-hidden">
            <div className="h-full bg-accent" style={{ width: `${(sourceCount / MAX_SOURCES) * 100}%` }} />
          </div>
          <span className="tabular-nums">
            {sourceCount} / {MAX_SOURCES}
          </span>
        </div>
      }
    >
      {remaining <= 0 ? (
        <p className="text-sm text-ink-2 py-6 text-center">This course has reached the {MAX_SOURCES}-source limit. Remove a source to add another.</p>
      ) : (
        <>
          {units.length > 0 && <UnitPicker units={units} value={unitId} onChange={setUnitId} />}
          {mode !== "discover" && <KindPicker value={kind} onChange={setKind} />}
          {mode === "home" ? (
            <UploadHome onFiles={uploadFiles} uploading={busy} setMode={setMode} />
          ) : mode === "link" ? (
            <LinkForm busy={busy} onSubmit={(urls) => run(() => api.addUrls(notebookId, urls, unitId, kindFields))} />
          ) : mode === "text" ? (
            <TextForm busy={busy} onSubmit={(title, text) => run(() => api.addText(notebookId, title, text, unitId, kindFields))} />
          ) : (
            <Discover
              busy={busy}
              remaining={remaining}
              onAdd={(papers) => run(async () => (await Promise.all(papers.map((p) => api.addUrl(notebookId, p.pdfLink ?? p.link, p.title, unitId)))).flat())}
            />
          )}
        </>
      )}
    </Modal>
  );
}
