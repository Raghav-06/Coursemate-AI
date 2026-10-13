import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import Markdown from "../Markdown";
import { Icon, IconButton, Spinner } from "../ui";
import { mediaKind, sourceIcon } from "./sourceIcon";

// "12:34" / "1:02:03" → seconds (null for page or slide labels).
function timestampSeconds(label) {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(label ?? "");
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

// Where the cited passage sits in the full text: the stored offsets when
// they still match, else a text search (older sources have no offsets).
function locate(text, citation) {
  if (!citation) return null;
  const { start, end, text: passage } = citation;
  if (start != null && end != null && text.slice(start, end) === passage) return [start, end];
  const at = text.indexOf(passage);
  if (at !== -1) return [at, at + passage.length];
  const probe = passage.slice(0, 120);
  const approx = text.indexOf(probe);
  return approx === -1 ? null : [approx, Math.min(text.length, approx + passage.length)];
}

// Splits the text at page/slide starts (rendered as markers) and around the
// highlighted range.
function SourceText({ text, locations, range, markRef, onSeek }) {
  const cuts = new Set([0, text.length]);
  const starts = new Map();
  for (const l of locations ?? []) {
    if (l.start >= 0 && l.start < text.length) {
      cuts.add(l.start);
      starts.set(l.start, l.label);
    }
  }
  if (range) range.forEach((p) => cuts.add(p));
  const points = [...cuts].sort((a, b) => a - b);
  const parts = [];
  let marked = false;
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    if (starts.has(a)) {
      const label = starts.get(a);
      const seconds = onSeek ? timestampSeconds(label) : null;
      parts.push(
        <span key={`loc-${a}`} className="flex items-center gap-2 mt-4 mb-1 select-none" aria-label={label}>
          {seconds !== null ? (
            <button
              type="button"
              onClick={() => onSeek(seconds)}
              title={`Play from ${label}`}
              className="inline-flex items-center gap-0.5 pl-1 pr-2 py-0.5 rounded-md bg-panel-3 text-ink-3 text-[11px] font-semibold tabular-nums hover:bg-accent-soft hover:text-accent-soft-fg"
            >
              <Icon name="play_arrow" size={14} />
              {label}
            </button>
          ) : (
            <span className="px-2 py-0.5 rounded-md bg-panel-3 text-ink-3 text-[11px] font-semibold not-italic">{label}</span>
          )}
          <span className="flex-1 border-t border-line/70" />
        </span>
      );
    }
    const piece = text.slice(a, b);
    if (range && a >= range[0] && b <= range[1]) {
      parts.push(
        <mark key={a} ref={marked ? undefined : markRef} className="bg-mark text-ink rounded-sm px-0.5">
          {piece}
        </mark>
      );
      marked = true;
    } else {
      parts.push(<span key={a}>{piece}</span>);
    }
  }
  return <>{parts}</>;
}

// The uploaded photo (next to its extracted text) or recording (with a
// player the transcript's timestamps can seek).
function MediaPane({ source, kind, mediaRef, startAt }) {
  const [failed, setFailed] = useState(false);
  const url = api.sourceOriginalUrl(source.id);

  // Seek to the cited moment once the recording's metadata is in (no autoplay).
  const seekToStart = (e) => {
    if (startAt != null) e.currentTarget.currentTime = startAt;
  };

  if (failed) {
    return (
      <p className="flex items-center gap-2 rounded-xl bg-panel-2 px-3 py-2 text-xs text-ink-3">
        <Icon name="hide_image" size={16} /> The original {kind === "image" ? "image" : "recording"} isn't available.
      </p>
    );
  }
  if (kind === "image") {
    return (
      <a href={url} target="_blank" rel="noopener" title="Open the full-size image" className="block">
        <img src={url} alt={`Uploaded image: ${source.title}`} loading="lazy" onError={() => setFailed(true)} className="w-full max-h-[70vh] object-contain rounded-xl border border-line bg-panel-2" />
      </a>
    );
  }
  if (kind === "video") {
    return (
      <video ref={mediaRef} src={url} controls preload="metadata" playsInline onLoadedMetadata={seekToStart} onError={() => setFailed(true)} className="w-full max-h-[40vh] rounded-xl bg-black">
        <track kind="captions" />
      </video>
    );
  }
  return <audio ref={mediaRef} src={url} controls preload="metadata" onLoadedMetadata={seekToStart} onError={() => setFailed(true)} className="w-full" />;
}

export default function SourceViewer({ source, citation, onBack, onAsk, onReprocess }) {
  const [text, setText] = useState(null);
  const [locations, setLocations] = useState(null);
  const [error, setError] = useState(null);
  const [guideOpen, setGuideOpen] = useState(!citation);
  const markRef = useRef(null);
  const mediaRef = useRef(null);
  const [icon, color] = sourceIcon(source);
  const media = source.status === "ready" || source.status === "processing" ? mediaKind(source) : null;
  const citedSeconds = timestampSeconds(citation?.location);

  const seek = (seconds) => {
    const player = mediaRef.current;
    if (!player) return;
    player.currentTime = seconds;
    player.play().catch(() => {});
  };

  // A new citation into the same recording moves the player there.
  useEffect(() => {
    if (citedSeconds !== null && mediaRef.current && mediaRef.current.readyState > 0) mediaRef.current.currentTime = citedSeconds;
  }, [citedSeconds]);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    api.getSourceContent(source.id).then(
      (r) => {
        if (cancelled) return;
        setText(r.text);
        setLocations(r.locations);
      },
      (err) => !cancelled && setError(err.message)
    );
    return () => {
      cancelled = true;
    };
  }, [source.id, source.status]);

  // PDFs, slide decks and links to PDFs can carry page/slide numbers.
  const paged = /^(pdf|pptx)$/.test(source.fileType ?? "") || /\.pdf($|\?)|arxiv\.org/i.test(source.url ?? "");

  useEffect(() => setGuideOpen(!citation), [citation]);

  const range = useMemo(() => (text ? locate(text, citation) : null), [text, citation]);

  useLayoutEffect(() => {
    markRef.current?.scrollIntoView({ block: "center" });
  }, [range]);

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="panel-header gap-1 px-2!">
        <IconButton icon="arrow_back" label="Back to sources" onClick={onBack} />
        <Icon name={icon} className={`${color} shrink-0`} size={20} />
        <h2 className="flex-1 min-w-0 truncate text-sm font-medium px-1" title={source.title}>
          {source.title}
        </h2>
        {citation?.location && <span className="shrink-0 px-2 py-0.5 rounded-md bg-accent-soft text-accent-soft-fg text-[11px] font-semibold">{citation.location}</span>}
        {source.url && <IconButton icon="open_in_new" label="Open original" onClick={() => window.open(source.url, "_blank", "noopener")} />}
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="m-3 rounded-2xl bg-panel-2">
          <button type="button" onClick={() => setGuideOpen((o) => !o)} className="w-full flex items-center gap-2 px-4 h-11 text-sm font-medium text-ink">
            <Icon name="auto_awesome" size={18} className="text-accent" />
            Source guide
            <Icon name={guideOpen ? "expand_less" : "expand_more"} size={20} className="ml-auto text-ink-3" />
          </button>
          {guideOpen && (
            <div className="px-4 pb-4 animate-fade-in">
              {source.guide ? (
                <>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3 mb-1.5">Summary</h3>
                  <Markdown text={source.guide.summary} className="text-sm! leading-6!" />
                  {source.guide.topics?.length > 0 && (
                    <>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3 mt-4 mb-2">Key topics</h3>
                      <div className="flex flex-wrap gap-2">
                        {source.guide.topics.map((topic) => (
                          <button
                            key={topic}
                            type="button"
                            onClick={() => onAsk(`Discuss what "${source.title}" says about ${topic}.`)}
                            className="px-3 py-1 rounded-lg border border-line text-xs text-ink-2 hover:bg-accent-soft hover:text-accent-soft-fg hover:border-transparent transition-colors"
                          >
                            {topic}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="text-sm text-ink-3">The guide for this source is being written, or couldn't be generated.</p>
              )}
              {source.wordCount && (
                <p className="mt-4 text-xs text-ink-3">
                  {source.wordCount.toLocaleString()} words
                  {locations?.length
                    ? timestampSeconds(locations[0].label) !== null
                      ? ` · transcript with ${locations.length} timestamps`
                      : ` · ${locations.length} ${/^Slide/.test(locations[0].label) ? "slides" : "pages"}`
                    : ""}
                  {media === "image" ? " · read from the image by AI" : ""}
                </p>
              )}
              {text !== null && !locations && paged && source.status === "ready" && onReprocess && (
                <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                  No page numbers for this source yet.
                  <button type="button" className="font-medium text-accent hover:underline" onClick={() => onReprocess(source.id)}>
                    Re-process
                  </button>
                </p>
              )}
              {source.status === "processing" && <p className="mt-3 text-xs text-ink-3">Re-processing…</p>}
            </div>
          )}
        </div>

        {media && media !== "image" && (
          <div className="sticky top-0 z-10 px-3 pb-2 pt-1 bg-panel">
            <MediaPane key={source.id} source={source} kind={media} mediaRef={mediaRef} startAt={citedSeconds} />
          </div>
        )}

        <div className={`px-5 pb-8 pt-1 ${media === "image" ? "@container" : ""}`}>
          <div className={media === "image" ? "grid gap-4 @xl:grid-cols-2 @xl:items-start" : ""}>
            {media === "image" && (
              <div className="@xl:sticky @xl:top-2">
                <MediaPane key={source.id} source={source} kind="image" />
              </div>
            )}
            <div className="min-w-0">
              {error && <p className="text-sm text-danger">{error}</p>}
              {text === null && !error && (
                <div className="flex justify-center py-10 text-ink-3">
                  <Spinner className="w-5 h-5" />
                </div>
              )}
              {text !== null && (
                <div className="text-[13.5px] leading-6 text-ink-2 whitespace-pre-wrap wrap-break-word font-[450]">
                  {text ? (
                    <SourceText text={text} locations={locations} range={range} markRef={markRef} onSeek={media === "audio" || media === "video" ? seek : undefined} />
                  ) : (
                    "This source has no text."
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
