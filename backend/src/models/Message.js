/**
 * Message Model
 *
 * Stores individual messages within a chat.
 *
 * Schema:
 *   _id:       string identifier
 *   chatId:    associated Chat document _id
 *   role:      'user' | 'assistant' | 'system'
 *   content:   message text content
 *   model:     model identifier used for generating assistant message (or active model)
 *   parts:     UI message stream parts (e.g. [{ type: 'text', text: content }])
 *   metadata:  optional tool invocations or auxiliary metadata
 *   createdAt: timestamp
 *
 * Index:
 *   chatId + createdAt (ascending)
 */

import mongoose from "mongoose";

const MessageSchema = new mongoose.Schema(
  {
    _id: {
      type: String,
      default: () => new mongoose.Types.ObjectId().toString(),
    },
    chatId: {
      type: String,
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["user", "assistant", "system"],
      required: true,
    },
    content: {
      type: String,
      default: "",
    },
    model: {
      type: String,
      default: null,
    },
    parts: {
      type: Array,
      default: [],
    },
    fileIds: {
      type: [String],
      default: [],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id;
        if (!ret.parts || ret.parts.length === 0) {
          ret.parts = [{ type: "text", text: ret.content || "" }];
        }
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

// Compound index for retrieval of a chat's history ordered by creation time
MessageSchema.index({ chatId: 1, createdAt: 1 });

export const Message = mongoose.models.Message || mongoose.model("Message", MessageSchema);
export default Message;
