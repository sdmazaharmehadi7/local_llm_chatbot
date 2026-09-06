/**
 * Chats Routes
 *
 * Handles /api/chats/* endpoints.
 *
 * Routes:
 *   POST   /api/chats/:id/completion              — AI SDK v6 streaming completion
 *   GET    /api/chats                             — List all chats
 *   POST   /api/chats                             — Create a chat
 *   GET    /api/chats/:id                         — Get single chat
 *   PATCH  /api/chats/:id                         — Update chat
 *   DELETE /api/chats/:id                         — Delete chat
 *   GET    /api/chats/:id/messages                — Get messages for chat
 *   POST   /api/chats/:id/messages                — Add message to chat
 *   DELETE /api/chats/:id/messages/:messageId     — Delete message from chat
 *   POST   /api/chats/:id/pin                     — Pin chat
 *   DELETE /api/chats/:id/pin                     — Unpin chat
 *   POST   /api/chats/:id/archive                 — Archive chat
 *   DELETE /api/chats/:id/archive                 — Unarchive chat
 */

import { Router } from "express";
import { postCompletion } from "../controllers/completion.controller.js";

const router = Router();

// In-memory persistence for chats and messages
const chatsStore = new Map([
  [
    "welcome-chat",
    {
      id: "welcome-chat",
      title: "Welcome to Local Chat",
      folder_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      pinned_at: null,
      archived_at: null,
    },
  ],
]);

const messagesStore = new Map([
  [
    "welcome-chat",
    [
      {
        id: "msg-welcome-1",
        chat_id: "welcome-chat",
        role: "assistant",
        content:
          "Welcome to Local Chat! Select a local model from the dropdown above and start chatting.",
        parts: [
          {
            type: "text",
            text:
              "Welcome to Local Chat! Select a local model from the dropdown above and start chatting.",
          },
        ],
        created_at: new Date().toISOString(),
      },
    ],
  ],
]);

// POST /api/chats/:id/completion
// Called by the frontend's DefaultChatTransport in useChatStream.js
router.post("/:id/completion", postCompletion);

// GET /api/chats — list all chats
router.get("/", (_req, res) => {
  const chats = Array.from(chatsStore.values()).sort(
    (a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)
  );
  res.json({ success: true, chats });
});

// POST /api/chats — create a chat
router.post("/", (req, res) => {
  const { id, title, folder_id } = req.body || {};
  const chatId = id || `chat-${Date.now()}`;
  const newChat = {
    id: chatId,
    title: title || "New Chat",
    folder_id: folder_id || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    pinned_at: null,
    archived_at: null,
  };
  chatsStore.set(chatId, newChat);
  if (!messagesStore.has(chatId)) {
    messagesStore.set(chatId, []);
  }
  res.json({ success: true, chat: newChat, ...newChat });
});

// GET /api/chats/:id — get a single chat
router.get("/:id", (req, res) => {
  const { id } = req.params;
  let chat = chatsStore.get(id);
  if (!chat) {
    chat = {
      id,
      title: "New Chat",
      folder_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      pinned_at: null,
      archived_at: null,
    };
    chatsStore.set(id, chat);
  }
  res.json({ success: true, chat, ...chat });
});

// PATCH /api/chats/:id — update a chat
router.patch("/:id", (req, res) => {
  const { id } = req.params;
  let chat = chatsStore.get(id);
  if (!chat) {
    chat = {
      id,
      title: "New Chat",
      folder_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      pinned_at: null,
      archived_at: null,
    };
  }
  const updated = {
    ...chat,
    ...req.body,
    updated_at: new Date().toISOString(),
  };
  chatsStore.set(id, updated);
  res.json({ success: true, chat: updated, ...updated });
});

// DELETE /api/chats/:id — delete a chat
router.delete("/:id", (req, res) => {
  const { id } = req.params;
  chatsStore.delete(id);
  messagesStore.delete(id);
  res.json({ success: true });
});

// GET /api/chats/:id/messages — get messages for a chat
router.get("/:id/messages", (req, res) => {
  const { id } = req.params;
  const messages = messagesStore.get(id) || [];
  res.json({ success: true, messages });
});

// POST /api/chats/:id/messages — add message to a chat
router.post("/:id/messages", (req, res) => {
  const { id: chatId } = req.params;
  const { id, role, content, parts, fileIds, model, metadata, createdAt } = req.body || {};
  const messageId = id || `msg-${Date.now()}`;
  const newMsg = {
    id: messageId,
    chat_id: chatId,
    role: role || "user",
    content: content || "",
    parts: parts || [{ type: "text", text: content || "" }],
    file_ids: fileIds || [],
    model: model || null,
    metadata: metadata || null,
    created_at: createdAt
      ? typeof createdAt === "number"
        ? new Date(createdAt).toISOString()
        : createdAt
      : new Date().toISOString(),
  };

  if (!messagesStore.has(chatId)) {
    messagesStore.set(chatId, []);
  }
  const msgs = messagesStore.get(chatId);
  const existingIdx = msgs.findIndex((m) => m.id === messageId);
  if (existingIdx >= 0) {
    msgs[existingIdx] = newMsg;
  } else {
    msgs.push(newMsg);
  }

  // Update chat timestamp and title if first user message
  const chat = chatsStore.get(chatId);
  if (chat) {
    chat.updated_at = new Date().toISOString();
    if (chat.title === "New Chat" && role === "user" && content) {
      chat.title = content.slice(0, 30);
    }
  } else {
    chatsStore.set(chatId, {
      id: chatId,
      title: role === "user" && content ? content.slice(0, 30) : "New Chat",
      folder_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      pinned_at: null,
      archived_at: null,
    });
  }

  res.json({ success: true, message: newMsg, ...newMsg });
});

// DELETE /api/chats/:id/messages/:messageId — delete a single message
router.delete("/:id/messages/:messageId", (req, res) => {
  const { id: chatId, messageId } = req.params;
  const msgs = messagesStore.get(chatId) || [];
  messagesStore.set(
    chatId,
    msgs.filter((m) => m.id !== messageId)
  );
  res.json({ success: true });
});

// POST /api/chats/:id/pin
router.post("/:id/pin", (req, res) => {
  const { id } = req.params;
  const chat = chatsStore.get(id);
  if (chat) chat.pinned_at = new Date().toISOString();
  res.json({ success: true, chat });
});

// DELETE /api/chats/:id/pin
router.delete("/:id/pin", (req, res) => {
  const { id } = req.params;
  const chat = chatsStore.get(id);
  if (chat) chat.pinned_at = null;
  res.json({ success: true, chat });
});

// POST /api/chats/:id/archive
router.post("/:id/archive", (req, res) => {
  const { id } = req.params;
  const chat = chatsStore.get(id);
  if (chat) chat.archived_at = new Date().toISOString();
  res.json({ success: true, chat });
});

// DELETE /api/chats/:id/archive
router.delete("/:id/archive", (req, res) => {
  const { id } = req.params;
  const chat = chatsStore.get(id);
  if (chat) chat.archived_at = null;
  res.json({ success: true, chat });
});

export default router;
