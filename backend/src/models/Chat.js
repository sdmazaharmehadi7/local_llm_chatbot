/**
 * Chat Model
 *
 * Stores conversation threads with metadata and active model.
 *
 * Schema:
 *   _id:           string identifier
 *   userId:        owning user identifier
 *   title:         conversation title
 *   selectedModel: currently selected model (e.g., 'gemini-3.6-flash', 'qwen3:8b')
 *   createdAt:     timestamp
 *   updatedAt:     timestamp
 *   folderId:      optional folder grouping
 *   pinnedAt:      optional pin timestamp
 *   archivedAt:    optional archive timestamp
 *
 * Index:
 *   userId + updatedAt (descending)
 */

import mongoose from "mongoose";

const ChatSchema = new mongoose.Schema(
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
    title: {
      type: String,
      default: "New Chat",
      trim: true,
    },
    selectedModel: {
      type: String,
      default: "qwen3:8b",
    },
    folderId: {
      type: String,
      default: null,
    },
    pinnedAt: {
      type: Date,
      default: null,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        return ret;
      },
    },
  }
);

// Compound index for user chat listing sorted by updatedAt desc
ChatSchema.index({ userId: 1, updatedAt: -1 });

export const Chat = mongoose.models.Chat || mongoose.model("Chat", ChatSchema);
export default Chat;
