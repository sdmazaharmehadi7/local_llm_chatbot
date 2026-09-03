/**
 * Chats Routes
 *
 * Handles /api/chats/* endpoints.
 *
 * Routes:
 *   POST /api/chats/:id/completion  — AI SDK v6 streaming completion
 *                                     (consumed by useChatStream.js / @ai-sdk/react)
 */

import { Router } from "express";
import { postCompletion } from "../controllers/completion.controller.js";

const router = Router();

// POST /api/chats/:id/completion
// Called by the frontend's DefaultChatTransport in useChatStream.js
router.post("/:id/completion", postCompletion);

export default router;
