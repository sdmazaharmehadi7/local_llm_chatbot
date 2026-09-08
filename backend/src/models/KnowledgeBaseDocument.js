/**
 * KnowledgeBaseDocument Model
 *
 * Stores metadata and indexing status for persistent Knowledge Base documents.
 * Binary files are saved to disk under uploads/knowledge-base/, keeping MongoDB lean.
 * Embeddings and chunk payloads are strictly stored in Qdrant.
 */

import mongoose from "mongoose";

const KnowledgeBaseDocumentSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toString(),
    },
    filename: {
      type: String,
      required: true,
      trim: true,
    },
    originalFileReference: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
      default: "application/pdf",
    },
    size: {
      type: Number,
      required: true,
    },
    scope: {
      type: String,
      default: "knowledge_base",
      immutable: true,
      index: true,
    },
    workspaceId: {
      type: String,
      default: "default",
      index: true,
    },
    userId: {
      type: String,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ["uploaded", "processing", "indexed", "failed", "processing_ocr_required"],
      default: "uploaded",
      index: true,
    },
    statusMessage: {
      type: String,
      default: null,
    },
    chunkCount: {
      type: Number,
      default: 0,
    },
    documentVersion: {
      type: Number,
      default: 1,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        return ret;
      },
    },
  }
);

// Compound index for fast workspace-scoped lookups and isolation
KnowledgeBaseDocumentSchema.index({ workspaceId: 1, scope: 1, status: 1 });

const KnowledgeBaseDocument =
  mongoose.models.KnowledgeBaseDocument ||
  mongoose.model("KnowledgeBaseDocument", KnowledgeBaseDocumentSchema);

export default KnowledgeBaseDocument;
