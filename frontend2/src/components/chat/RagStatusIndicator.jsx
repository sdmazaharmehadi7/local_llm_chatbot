import { memo } from "react";
import { Loader2, FileSearch, BookOpen } from "lucide-react";

/**
 * Small ChatGPT-style status indicator for RAG retrieval.
 *
 * Appears during:
 * - "Searching PDF for context..." (with small spinner)
 * - "Reading relevant sections from PDF..." (with small spinner)
 *
 * Automatically disappears when generation begins or for general questions.
 */
const RagStatusIndicator = memo(({ state, text }) => {
  if (!state || state === "GENERATING" || state === "GENERAL" || state === "COMPLETED") {
    return null;
  }

  const label =
    text ||
    (state === "RAG_READING"
      ? "Reading relevant sections from PDF..."
      : "Searching PDF for context...");

  const Icon = state === "RAG_READING" ? BookOpen : FileSearch;

  return (
    <div className="my-2.5 inline-flex items-center gap-2 rounded-full border border-theme-border/60 bg-theme-surface/80 px-3 py-1 text-xs font-medium text-theme-text shadow-xs backdrop-blur-xs transition-all">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-theme-primary" />
      <Icon className="h-3.5 w-3.5 text-theme-primary/80" />
      <span>{label}</span>
    </div>
  );
});

RagStatusIndicator.displayName = "RagStatusIndicator";

export default RagStatusIndicator;
