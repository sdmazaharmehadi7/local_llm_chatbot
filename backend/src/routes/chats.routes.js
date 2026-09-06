/**
 * Chats Routes
 *
 * Handles /api/chats/* endpoints for chat history, messages, and streaming completions.
 */

import { Router } from "express";
import {
  getChats,
  getChat,
  createChat,
  updateChat,
  deleteChat,
  getMessages,
  createMessage,
  deleteMessage,
  pinChat,
  unpinChat,
  archiveChat,
  unarchiveChat,
} from "../controllers/chats.controller.js";
import { postCompletion } from "../controllers/completion.controller.js";

const router = Router();

// Streaming completion (consumed by useChatStream.js / @ai-sdk/react)
router.post("/:id/completion", postCompletion);

// Chat collection
router.get("/", getChats);
router.post("/", createChat);

// Individual chat operations
router.get("/:id", getChat);
router.patch("/:id", updateChat);
router.delete("/:id", deleteChat);

// Pin & Archive
router.post("/:id/pin", pinChat);
router.delete("/:id/pin", unpinChat);
router.post("/:id/archive", archiveChat);
router.delete("/:id/archive", unarchiveChat);

// Messages inside chat
router.get("/:id/messages", getMessages);
router.post("/:id/messages", createMessage);
router.delete("/:id/messages/:messageId", deleteMessage);

export default router;
