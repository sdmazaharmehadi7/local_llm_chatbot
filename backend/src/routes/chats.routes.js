/**
 * Chats Routes
 *
 * Handles /api/chats/* endpoints using MongoDB as the persistent source of truth.
 *
 * Routes:
 *   POST   /api/chats/:id/completion              — AI SDK v6 streaming completion
 *   GET    /api/chats                             — List all chats for current user
 *   POST   /api/chats                             — Create a chat document in MongoDB
 *   GET    /api/chats/:id                         — Get single chat
 *   PATCH  /api/chats/:id                         — Update chat (title, selectedModel, etc.)
 *   DELETE /api/chats/:id                         — Delete chat and its messages
 *   GET    /api/chats/:id/messages                — Get messages for chat
 *   POST   /api/chats/:id/messages                — Add / upsert message to chat
 *   DELETE /api/chats/:id/messages/:messageId     — Delete message from chat
 *   POST   /api/chats/:id/pin                     — Pin chat
 *   DELETE /api/chats/:id/pin                     — Unpin chat
 *   POST   /api/chats/:id/archive                 — Archive chat
 *   DELETE /api/chats/:id/archive                 — Unarchive chat
 */

import { Router } from "express";
import mongoose from "mongoose";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import File from "../models/File.js";
import { deletePointsByChatId } from "../services/qdrant.service.js";
import { postCompletion } from "../controllers/completion.controller.js";

const router = Router();

// POST /api/chats/:id/completion — streaming completion
router.post("/:id/completion", postCompletion);

// GET /api/chats — list all chats for current user, sorted by updatedAt desc
router.get("/", async (req, res) => {
  try {
    const userId = req.userId;
    const chats = await Chat.find({ userId }).sort({ updatedAt: -1 });
    res.json({ success: true, chats });
  } catch (err) {
    console.error("[chats.routes] Failed to list chats:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch chats." });
  }
});

// POST /api/chats — create a new chat document in MongoDB
router.post("/", async (req, res) => {
  try {
    const userId = req.userId;
    const { id, title, selectedModel, folderId, folder_id } = req.body || {};

    const chatId = id || new mongoose.Types.ObjectId().toString();

    const newChat = await Chat.create({
      _id: chatId,
      userId,
      title: title || "New Chat",
      selectedModel: selectedModel || "qwen3:8b",
      folderId: folderId || folder_id || null,
      pinnedAt: null,
      archivedAt: null,
    });

    res.json({ success: true, chat: newChat, ...newChat.toJSON() });
  } catch (err) {
    console.error("[chats.routes] Failed to create chat:", err.message);
    res.status(500).json({ success: false, error: "Failed to create chat." });
  }
});

// GET /api/chats/:id — get a single chat
router.get("/:id", async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    let chat = await Chat.findOne({ _id: id, userId });
    if (!chat) {
      // If requested chat does not exist yet for this user, create it automatically
      chat = await Chat.create({
        _id: id,
        userId,
        title: "New Chat",
        selectedModel: "qwen3:8b",
      });
    } else {
      // If chat has documents, ensure selectedModel is qwen3:8b
      const hasDocs = await File.exists({ chatId: id, scope: "chat", category: { $ne: "image" } });
      if (hasDocs && chat.selectedModel !== "qwen3:8b") {
        chat.selectedModel = "qwen3:8b";
        await chat.save().catch(() => {});
      }
    }

    res.json({ success: true, chat, ...chat.toJSON() });
  } catch (err) {
    console.error(`[chats.routes] Failed to get chat ${req.params.id}:`, err.message);
    res.status(500).json({ success: false, error: "Failed to get chat." });
  }
});

// PATCH /api/chats/:id — update a chat (e.g. title, selectedModel, folderId)
router.patch("/:id", async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const { title, selectedModel, folderId, folder_id, pinnedAt, archivedAt } = req.body || {};

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (selectedModel !== undefined) updates.selectedModel = selectedModel;
    if (folderId !== undefined || folder_id !== undefined) {
      updates.folderId = folderId !== undefined ? folderId : folder_id;
    }
    if (pinnedAt !== undefined) updates.pinnedAt = pinnedAt;
    if (archivedAt !== undefined) updates.archivedAt = archivedAt;
    updates.updatedAt = new Date();

    const chat = await Chat.findOneAndUpdate(
      { _id: id, userId },
      { $set: updates },
      { returnDocument: "after", upsert: true }
    );

    res.json({ success: true, chat, ...chat.toJSON() });
  } catch (err) {
    console.error(`[chats.routes] Failed to update chat ${req.params.id}:`, err.message);
    res.status(500).json({ success: false, error: "Failed to update chat." });
  }
});

// DELETE /api/chats/:id — delete a chat and all its messages, files, and Qdrant RAG points
router.delete("/:id", async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    await Chat.deleteOne({ _id: id, userId });
    await Message.deleteMany({ chatId: id });
    await File.deleteMany({ chatId: id });

    // Clean up vectors from Qdrant local_chat_documents collection
    deletePointsByChatId(id).catch((delErr) => {
      console.warn(`[chats.routes] Failed to delete Qdrant points for chat ${id}:`, delErr.message);
    });

    res.json({ success: true });
  } catch (err) {
    console.error(`[chats.routes] Failed to delete chat ${req.params.id}:`, err.message);
    res.status(500).json({ success: false, error: "Failed to delete chat." });
  }
});

// GET /api/chats/:id/messages — get all messages for a chat from MongoDB
router.get("/:id/messages", async (req, res) => {
  try {
    const { id } = req.params;
    const messages = await Message.find({ chatId: id }).sort({ createdAt: 1 });
    res.json({ success: true, messages });
  } catch (err) {
    console.error(`[chats.routes] Failed to get messages for ${req.params.id}:`, err.message);
    res.status(500).json({ success: false, error: "Failed to fetch messages." });
  }
});

// POST /api/chats/:id/messages — add or upsert a message to a chat
router.post("/:id/messages", async (req, res) => {
  try {
    const userId = req.userId;
    const { id: chatId } = req.params;
    const { id, role, content, parts, fileIds, model, metadata, createdAt } = req.body || {};

    const messageId = id || new mongoose.Types.ObjectId().toString();
    const messageCreatedAt = createdAt ? new Date(createdAt) : new Date();

    const messageDoc = await Message.findOneAndUpdate(
      { _id: messageId, chatId },
      {
        $set: {
          chatId,
          role: role || "user",
          content: content || "",
          parts: parts || [{ type: "text", text: content || "" }],
          fileIds: fileIds || [],
          model: model || null,
          metadata: metadata || null,
          createdAt: messageCreatedAt,
        },
      },
      { upsert: true, returnDocument: "after" }
    );

    // Update parent chat's updatedAt and title if first user message
    const chat = await Chat.findOne({ _id: chatId, userId });
    if (chat) {
      chat.updatedAt = new Date();
      if (chat.title === "New Chat" && role === "user" && content && content.trim()) {
        chat.title = content.trim().slice(0, 30);
      }
      await chat.save();
    } else {
      await Chat.create({
        _id: chatId,
        userId,
        title: role === "user" && content ? content.trim().slice(0, 30) : "New Chat",
        selectedModel: model || "qwen3:8b",
      });
    }

    res.json({ success: true, message: messageDoc, ...messageDoc.toJSON() });
  } catch (err) {
    console.error(`[chats.routes] Failed to save message for ${req.params.id}:`, err.message);
    res.status(500).json({ success: false, error: "Failed to save message." });
  }
});

// DELETE /api/chats/:id/messages/:messageId — delete a single message
router.delete("/:id/messages/:messageId", async (req, res) => {
  try {
    const { id: chatId, messageId } = req.params;
    await Message.deleteOne({ _id: messageId, chatId });
    res.json({ success: true });
  } catch (err) {
    console.error(`[chats.routes] Failed to delete message ${req.params.messageId}:`, err.message);
    res.status(500).json({ success: false, error: "Failed to delete message." });
  }
});

// POST /api/chats/:id/pin
router.post("/:id/pin", async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const chat = await Chat.findOneAndUpdate(
      { _id: id, userId },
      { $set: { pinnedAt: new Date() } },
      { returnDocument: "after" }
    );
    res.json({ success: true, chat });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to pin chat." });
  }
});

// DELETE /api/chats/:id/pin
router.delete("/:id/pin", async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const chat = await Chat.findOneAndUpdate(
      { _id: id, userId },
      { $set: { pinnedAt: null } },
      { returnDocument: "after" }
    );
    res.json({ success: true, chat });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to unpin chat." });
  }
});

// POST /api/chats/:id/archive
router.post("/:id/archive", async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const chat = await Chat.findOneAndUpdate(
      { _id: id, userId },
      { $set: { archivedAt: new Date() } },
      { returnDocument: "after" }
    );
    res.json({ success: true, chat });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to archive chat." });
  }
});

// DELETE /api/chats/:id/archive
router.delete("/:id/archive", async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;
    const chat = await Chat.findOneAndUpdate(
      { _id: id, userId },
      { $set: { archivedAt: null } },
      { returnDocument: "after" }
    );
    res.json({ success: true, chat });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to unarchive chat." });
  }
});

export default router;
