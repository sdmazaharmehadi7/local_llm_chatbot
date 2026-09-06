import { FILE_CATEGORIES } from "@/shared";
import { X, File } from "lucide-react";
import { API_BASE } from "@/lib/api";

const CATEGORY_LABELS = {
  [FILE_CATEGORIES.IMAGE]: "Image",
  [FILE_CATEGORIES.PDF]: "PDF",
  [FILE_CATEGORIES.TEXT_LIKE]: "Text",
  [FILE_CATEGORIES.OFFICE_MODERN]: "Office",
};

export function FilePreviewList({ files, onRemove }) {
  if (!files || files.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {files.map((file) => {
        const isImage =
          file.category === FILE_CATEGORIES.IMAGE ||
          file.category === "image" ||
          file.mimeType?.startsWith("image/");
        const imageUrl = file.url
          ? file.url.startsWith("http")
            ? file.url
            : `${API_BASE}${file.url}`
          : null;

        if (isImage) {
          return (
            <div
              key={file.id}
              className="group relative flex items-center gap-2 rounded-xl border border-theme-border bg-theme-surface p-1.5 shadow-sm transition hover:border-theme-primary/40">
              <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-theme-surface-strong">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={file.filename}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-theme-muted">
                    <File size={18} />
                  </div>
                )}
              </div>
              <div className="flex flex-col pr-6">
                <span className="max-w-[160px] truncate text-xs font-medium text-theme-text">
                  {file.filename}
                </span>
                <span className="text-[11px] text-theme-text-muted">
                  {file.sizeFormatted || "Image"}
                </span>
              </div>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(file.id)}
                  aria-label={`Remove ${file.filename || "file"}`}
                  className="absolute right-1.5 top-1.5 rounded-full bg-theme-surface-strong p-1 text-theme-text-muted transition hover:bg-theme-red/20 hover:text-theme-red">
                  <X size={12} />
                </button>
              )}
            </div>
          );
        }

        return (
          <div
            key={file.id}
            className="bg-theme-surface text-theme-text flex items-center gap-2 rounded-lg px-3 py-2 text-sm">
            <File size={16} />
            <span className="max-w-[200px] truncate">{file.filename}</span>
            <span className="bg-theme-surface-strong text-theme-text-muted rounded px-1.5 py-0.5 text-[10px] font-medium">
              {CATEGORY_LABELS[file.category] ?? "File"}
            </span>
            <span className="text-theme-text-muted text-xs">{file.sizeFormatted}</span>
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(file.id)}
                aria-label={`Remove ${file.filename || "file"}`}
                className="hover:text-theme-red ml-1 transition-colors">
                <X size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
