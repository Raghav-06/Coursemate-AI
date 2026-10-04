import { memo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Turns "[2]", "[1][3]" and "[1, 3]" into links the renderer below turns
// into citation chips — only for numbers that match a real citation.
function linkCitations(text, numbers) {
  if (!numbers.size) return text;
  return text.replace(/\[(\d+(?:\s*,\s*\d+)*)\](?!\()/g, (match, list) => {
    const nums = list.split(",").map((n) => Number(n.trim()));
    if (!nums.every((n) => numbers.has(n))) return match;
    return nums.map((n) => `[${n}](#cite-${n})`).join("");
  });
}

function CitationChip({ citation, onOpen }) {
  const [anchor, setAnchor] = useState(null);
  const timer = useRef(null);

  const show = (e) => {
    clearTimeout(timer.current);
    const rect = e.currentTarget.getBoundingClientRect();
    setAnchor(rect);
  };
  const hide = () => {
    timer.current = setTimeout(() => setAnchor(null), 120);
  };

  const width = 360;
  const left = anchor ? Math.min(Math.max(8, anchor.left + anchor.width / 2 - width / 2), window.innerWidth - width - 8) : 0;
  const below = anchor && anchor.top < 260;

  return (
    <>
      <button
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => onOpen?.(citation)}
        className="inline-flex items-center justify-center align-[2px] min-w-[20px] h-5 px-1 mx-0.5 rounded-full text-[11px] font-semibold leading-none bg-panel-3 text-ink-2 hover:bg-accent hover:text-accent-fg transition-colors no-underline"
        aria-label={`Citation ${citation.number}: ${citation.sourceTitle}`}
      >
        {citation.number}
      </button>
      {anchor &&
        createPortal(
          <div
            onMouseEnter={() => clearTimeout(timer.current)}
            onMouseLeave={hide}
            style={{
              position: "fixed",
              left,
              width,
              ...(below ? { top: anchor.bottom + 8 } : { bottom: window.innerHeight - anchor.top + 8 }),
            }}
            className="z-80 p-4 rounded-2xl bg-panel-2 border border-line shadow-pop animate-fade-in"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-ink-2 mb-2">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                description
              </span>
              <span className="truncate">{citation.sourceTitle}</span>
            </div>
            <p className="text-[13px] leading-5 text-ink line-clamp-10 whitespace-pre-line">{citation.text}</p>
            {onOpen && (
              <button type="button" className="mt-2 text-xs font-medium text-accent hover:underline" onClick={() => onOpen(citation)}>
                Open in source
              </button>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

function Markdown({ text, citations = [], onOpenCitation, className = "" }) {
  const byNumber = new Map(citations.map((c) => [c.number, c]));
  const source = linkCitations(text ?? "", new Set(byNumber.keys()));

  return (
    <div className={`prose-cm ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            const match = href?.match(/^#cite-(\d+)$/);
            if (match && byNumber.has(Number(match[1]))) {
              return <CitationChip citation={byNumber.get(Number(match[1]))} onOpen={onOpenCitation} />;
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

export default memo(Markdown);

// Plain text of an answer for copy/export: drop citation markers.
export function stripCitations(text) {
  return (text ?? "").replace(/\s?\[\d+(?:\s*,\s*\d+)*\](?!\()/g, "");
}
