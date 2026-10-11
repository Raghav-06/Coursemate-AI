import { Icon } from "../ui";

/**
 * Small "source · p. 12" link for generated study items (cards, questions…);
 * opens the cited passage in the source viewer. `citation`:
 * { sourceId, sourceTitle, location?, text? }.
 */
export default function CitationLink({ citation, onOpen, className = "" }) {
  if (!citation?.sourceId) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.(citation);
      }}
      className={`inline-flex items-center gap-1.5 max-w-full px-2 py-1 rounded-lg bg-panel-2 hover:bg-accent-soft hover:text-accent-soft-fg text-xs text-ink-2 transition-colors ${className}`}
      title="Open the cited passage"
    >
      <Icon name="description" size={14} />
      <span className="truncate">{citation.sourceTitle ?? "Source"}</span>
      {citation.location && <span className="shrink-0 font-semibold">· {citation.location}</span>}
    </button>
  );
}

