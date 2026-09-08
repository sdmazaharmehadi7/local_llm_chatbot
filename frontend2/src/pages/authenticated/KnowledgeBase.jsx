import { useState, useEffect, useRef, useCallback } from "react";
import {
  BookOpen,
  Upload,
  Trash2,
  FileText,
  CheckCircle2,
  Clock,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Search,
  X,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import Modal from "@/components/ui/Modal";
import {
  getKnowledgeBaseDocuments,
  uploadKnowledgeBaseDocument,
  deleteKnowledgeBaseDocument,
} from "@/services/knowledgeBase.service";

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatDate(dateStr) {
  if (!dateStr) return "Unknown";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

const StatusBadge = ({ status, statusMessage, chunkCount }) => {
  switch (status) {
    case "indexed":
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-theme-green/10 px-2.5 py-0.5 text-xs font-medium text-theme-green"
          title={`Indexed into ${chunkCount || 0} chunks in vector database`}>
          <CheckCircle2 size={13} />
          Indexed {chunkCount > 0 ? `(${chunkCount} chunks)` : ""}
        </span>
      );
    case "processing":
    case "uploaded":
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-theme-blue/10 px-2.5 py-0.5 text-xs font-medium text-theme-blue"
          title="Extracting text and generating embeddings...">
          <RefreshCw size={13} className="animate-spin" />
          Processing...
        </span>
      );
    case "processing_ocr_required":
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-theme-yellow/15 px-2.5 py-0.5 text-xs font-medium text-theme-yellow"
          title={statusMessage || "Scanned document or image-only PDF requires OCR"}>
          <AlertTriangle size={13} />
          OCR Required
        </span>
      );
    case "failed":
    default:
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-theme-red/10 px-2.5 py-0.5 text-xs font-medium text-theme-red"
          title={statusMessage || "Indexing failed"}>
          <AlertCircle size={13} />
          Failed
        </span>
      );
  }
};

const KnowledgeBase = () => {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const fetchDocs = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const docs = await getKnowledgeBaseDocuments();
      setDocuments(docs);
    } catch (err) {
      if (!isBackground) {
        toast.error("Failed to load Knowledge Base documents");
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // Auto-poll if any document is currently in processing state
  useEffect(() => {
    const hasProcessing = documents.some(
      (d) => d.status === "processing" || d.status === "uploaded"
    );

    if (!hasProcessing) return;

    const interval = setInterval(() => {
      fetchDocs(true);
    }, 3000);

    return () => clearInterval(interval);
  }, [documents, fetchDocs]);

  const handleFileUpload = async (file) => {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      toast.error("Only PDF documents are supported for the Knowledge Base.");
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      toast.error("File size exceeds 50 MB limit.");
      return;
    }

    try {
      setUploading(true);
      const res = await uploadKnowledgeBaseDocument(file);
      toast.success(`"${file.name}" uploaded. Indexing started...`);
      fetchDocs(true);
    } catch (err) {
      toast.error(err.message || "Failed to upload document");
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      setIsDeleting(true);
      await deleteKnowledgeBaseDocument(deleteConfirm.id);
      toast.success(`"${deleteConfirm.filename}" deleted from Knowledge Base`);
      setDocuments((prev) => prev.filter((d) => d.id !== deleteConfirm.id));
      setDeleteConfirm(null);
    } catch (err) {
      toast.error(err.message || "Failed to delete document");
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredDocs = documents.filter((doc) =>
    (doc.filename || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="bg-theme-canvas min-h-screen p-6 md:p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-theme-primary/10 text-theme-primary flex h-10 w-10 items-center justify-center rounded-xl">
              <BookOpen size={22} />
            </div>
            <div>
              <h1 className="text-theme-text text-xl font-bold tracking-tight">
                Knowledge Base
              </h1>
              <p className="text-theme-text-muted text-xs">
                Persistent organizational documents accessible via RAG in authorized chats
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input
              type="file"
              ref={fileInputRef}
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
            />

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="bg-theme-primary hover:bg-theme-primary/90 flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:shadow">
              {uploading ? (
                <RefreshCw size={16} className="animate-spin" />
              ) : (
                <Plus size={16} />
              )}
              <span>{uploading ? "Uploading..." : "Upload Document"}</span>
            </button>
          </div>
        </div>

        {/* Drag & Drop Upload Banner */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleFileDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-theme-border/60 bg-theme-surface/40 hover:bg-theme-surface/70 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed py-8 transition-colors ${
            dragOver ? "border-theme-primary bg-theme-primary/5" : ""
          }`}>
          <div className="bg-theme-surface border-theme-border/60 mb-2 flex h-10 w-10 items-center justify-center rounded-full border shadow-xs">
            <Upload size={18} className="text-theme-text-muted" />
          </div>
          <p className="text-theme-text text-sm font-medium">
            Click to upload or drag and drop
          </p>
          <p className="text-theme-text-muted text-xs">PDF documents up to 50 MB</p>
        </div>

        {/* Search & Filter Bar */}
        {documents.length > 0 && (
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search
                size={16}
                className="text-theme-text-muted absolute top-1/2 left-3 -translate-y-1/2"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Knowledge Base..."
                className="border-theme-border bg-theme-surface text-theme-text placeholder-theme-text-muted focus:border-theme-primary w-full rounded-xl border py-2 pr-8 pl-9 text-sm outline-none transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="text-theme-text-muted hover:text-theme-text absolute top-1/2 right-2.5 -translate-y-1/2">
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="text-theme-text-muted text-xs">
              {filteredDocs.length} {filteredDocs.length === 1 ? "document" : "documents"}
            </div>
          </div>
        )}

        {/* Document List */}
        {loading ? (
          <div className="bg-theme-surface border-theme-border flex items-center justify-center rounded-2xl border p-12">
            <RefreshCw size={20} className="text-theme-text-muted animate-spin" />
          </div>
        ) : filteredDocs.length === 0 ? (
          <div className="bg-theme-surface border-theme-border rounded-2xl border py-12 text-center">
            <FileText size={36} className="text-theme-text-muted/40 mx-auto mb-3" />
            <h3 className="text-theme-text text-sm font-medium">
              {searchQuery ? "No matching documents" : "No Knowledge Base documents yet"}
            </h3>
            <p className="text-theme-text-muted mt-1 text-xs">
              {searchQuery
                ? "Try a different search term"
                : "Upload company manuals, safety SOPs, or compliance procedures to get started."}
            </p>
          </div>
        ) : (
          <div className="bg-theme-surface border-theme-border overflow-hidden rounded-2xl border shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-theme-border/60 bg-theme-surface-strong/30 text-theme-text-muted border-b text-xs font-semibold uppercase tracking-wider">
                  <tr>
                    <th className="px-5 py-3.5">Document</th>
                    <th className="px-5 py-3.5">Size</th>
                    <th className="px-5 py-3.5">Uploaded</th>
                    <th className="px-5 py-3.5">Status</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-theme-border/40 divide-y">
                  {filteredDocs.map((doc) => (
                    <tr
                      key={doc.id}
                      className="hover:bg-theme-surface-strong/20 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="bg-theme-red/10 text-theme-red flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg">
                            <FileText size={16} />
                          </div>
                          <div className="min-w-0">
                            <span className="text-theme-text block truncate font-medium">
                              {doc.filename}
                            </span>
                            {doc.statusMessage && (
                              <span className="text-theme-yellow mt-0.5 block truncate text-xs">
                                {doc.statusMessage}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="text-theme-text-muted px-5 py-3.5 whitespace-nowrap text-xs">
                        {formatBytes(doc.size)}
                      </td>
                      <td className="text-theme-text-muted px-5 py-3.5 whitespace-nowrap text-xs">
                        {formatDate(doc.createdAt)}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <StatusBadge
                          status={doc.status}
                          statusMessage={doc.statusMessage}
                          chunkCount={doc.chunkCount}
                        />
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap">
                        <button
                          onClick={() => setDeleteConfirm(doc)}
                          className="text-theme-text-muted hover:text-theme-red hover:bg-theme-red/10 rounded-lg p-1.5 transition-colors"
                          title="Delete Document">
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        <Modal
          isOpen={Boolean(deleteConfirm)}
          onClose={() => !isDeleting && setDeleteConfirm(null)}
          title="Delete Knowledge Base Document">
          <div className="space-y-4">
            <p className="text-theme-text-muted text-sm">
              Are you sure you want to delete{" "}
              <span className="text-theme-text font-semibold">
                "{deleteConfirm?.filename}"
              </span>
              ? All associated vector embeddings in Qdrant and the original file will be permanently removed.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirm(null)}
                disabled={isDeleting}
                className="border-theme-border text-theme-text hover:bg-theme-surface rounded-xl border px-4 py-2 text-sm font-medium transition-colors">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="bg-theme-red hover:bg-theme-red/90 rounded-xl px-4 py-2 text-sm font-medium text-white transition-colors">
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
};

export default KnowledgeBase;
