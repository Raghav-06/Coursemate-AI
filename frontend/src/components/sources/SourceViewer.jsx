import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import Markdown from "../Markdown";
import { Icon, IconButton, Spinner } from "../ui";
import { sourceIcon } from "./sourceIcon";

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

export default function SourceViewer({ source, citation, onBack, onAsk }) {
  const [text, setText] = useState(null);
  const [error, setError] = useState(null);
  const [guideOpen, setGuideOpen] = useState(!citation);
  const markRef = useRef(null);
  const [icon, color] = sourceIcon(source);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(null);
    api.getSourceContent(source.id).then(
      (r) => !cancelled && setText(r.text),
      (err) => !cancelled && setError(err.message)
    );
    return () => {
      cancelled = true;
    };
  }, [source.id]);

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
              {source.wordCount && <p className="mt-4 text-xs text-ink-3">{source.wordCount.toLocaleString()} words</p>}
            </div>
          )}
        </div>

        <div className="px-5 pb-8 pt-1">
          {error && <p className="text-sm text-danger">{error}</p>}
          {text === null && !error && (
            <div className="flex justify-center py-10 text-ink-3">
              <Spinner className="w-5 h-5" />
            </div>
          )}
          {text !== null && (
            <div className="text-[13.5px] leading-6 text-ink-2 whitespace-pre-wrap wrap-break-word font-[450]">
              {range ? (
                <>
                  {text.slice(0, range[0])}
                  <mark ref={markRef} className="bg-mark text-ink rounded-sm px-0.5">
                    {text.slice(range[0], range[1])}
                  </mark>
                  {text.slice(range[1])}
                </>
              ) : (
                text || "This source has no text."
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
