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
      default: "image",
    },
    path: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
    versionKey: false,
  }
);

const File = mongoose.models.File || mongoose.model("File", FileSchema);
export default File;
