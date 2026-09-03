/**
 * Chat Routes
 *
 * Defines HTTP routes for the chat API.
 * Route handling delegates to chat.controller.js.
 *
 * Routes:
 *   POST /api/chat   — send a message to Ollama
 */

import { Router } from "express";
import { postChat } from "../controllers/chat.controller.js";

const router = Router();

router.post("/", postChat);

export default router;
