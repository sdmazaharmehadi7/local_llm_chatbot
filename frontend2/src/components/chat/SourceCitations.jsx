import { useState } from "react";
import { Globe, FileText } from "lucide-react";
import { extractSources, TOOL_ERROR_MESSAGES } from "./sourceUtils.js";

export { extractSources, TOOL_ERROR_MESSAGES };

export default function SourceCitations({ sources }) {
  if (!sources?.length) {
    return null;
  }

  // Defensive deduplication before rendering: ensure ONE pill per document resource
  const uniqueSources = [];
  const seenKeys = new Set();
  for (const s of sources) {
    const sKey = s.key || s.documentId || (s.isDocument ? (s.filename || s.title).toLowerCase() : s.url || s.title);
    if (!seenKeys.has(sKey)) {
      seenKeys.add(sKey);
      uniqueSources.push({ ...s, reactKey: sKey });
    }
  }

  const [expanded, setExpanded] = useState(false);
  const visibleSources = expanded ? uniqueSources : uniqueSources.slice(0, 5);
  const hasMore = uniqueSources.length > 5;

  return (
    <div className="border-theme-border/30 mt-4 border-t pt-3">
      <div className="text-theme-text-muted mb-2 flex items-center gap-1.5 text-xs font-medium">
        <Globe className="h-3 w-3" />
        Sources
      </div>
      <div className="flex flex-wrap gap-2">
        {visibleSources.map((source) => (
          <a
            key={source.reactKey}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.title || source.snippet}
            className="bg-theme-surface/60 border-theme-border/40 hover:bg-theme-surface hover:border-theme-border text-theme-text-muted hover:text-theme-text ease-snappy group inline-flex max-w-[280px] items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors duration-75">
            {source.isDocument ? (
              <FileText className="h-3.5 w-3.5 flex-shrink-0 text-theme-primary" />
            ) : (
              <img
                src={`https://www.google.com/s2/favicons?domain=${source.domain}&sz=16`}
                alt=""
                className="h-3.5 w-3.5 flex-shrink-0 rounded-sm"
                loading="lazy"
                onError={(e) => {
                  e.target.style.display = "none";
                }}
              />
            )}
            <span className="truncate">{source.filename || source.title}</span>
            {source.pageBadge && (
              <span className="bg-theme-surface/90 border border-theme-border/60 text-theme-text-muted rounded px-1 text-[10px] font-medium flex-shrink-0">
                {source.pageBadge}
              </span>
            )}
          </a>
        ))}
        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-theme-text-muted hover:text-theme-text text-xs font-medium">
            {expanded ? "Show less" : `+${uniqueSources.length - 5} more`}
          </button>
        )}
      </div>
    </div>
  );
}
