/**
 * File Model
 *
 * Stores file metadata for uploaded attachments (e.g. images, PDFs, documents).
 * The actual binary file is stored on disk in the uploads directory,
 * keeping MongoDB documents lightweight.
 */

import mongoose from "mongoose";

const FileSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toString(),
    },
    userId: {
      type: String,
      required: true,
      index: true,
    },
    filename: {
      type: String,
      required: true,
    },
    originalName: {
      type: String,
      default: null,
    },
    mimeType: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      required: true,
    },
    category: {
      type: String,
      default: "file",
    },
    path: {
      type: String,
      required: true,
    },
    storagePath: {
      type: String,
      default: null,
    },
    chatId: {
      type: String,
      default: null,
      index: true,
    },
    scope: {
      type: String,
      enum: ["chat", "knowledge_base"],
      default: "chat",
      index: true,
    },
    status: {
      type: String,
      enum: ["uploaded", "processing", "indexed", "failed"],
      default: "uploaded",
    },
    chunkCount: {
      type: Number,
      default: 0,
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
        ret.originalName = ret.originalName || ret.filename;
        ret.storagePath = ret.storagePath || ret.path;
        return ret;
      },
    },
  }
);

// Compound index for fast chat-scoped lookups
FileSchema.index({ chatId: 1, scope: 1, userId: 1 });

const File = mongoose.models.File || mongoose.model("File", FileSchema);
export default File;
