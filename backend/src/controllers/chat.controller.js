/**
 * Chat Controller
 *
 * Handles HTTP request/response logic for chat endpoints.
 * Delegates all Ollama communication to OllamaService.
 */

import { sendChatToOllama } from "../services/ollama.service.js";

/**
 * POST /api/chat
 *
 * Request body:
 *   { message: string }         — simple single-turn
 *   { messages: Array }         — optional multi-turn history
 *
 * Response:
 *   { success: true, message: string }
 */
export async function postChat(req, res) {
  const { message, messages } = req.body;

  // Validate: need at least a message or a messages array
  if (!message && (!Array.isArray(messages) || messages.length === 0)) {
    return res.status(400).json({
      success: false,
      error: "Request must include a 'message' string or a 'messages' array.",
    });
  }

  if (message && typeof message !== "string") {
    return res.status(400).json({
      success: false,
      error: "'message' must be a string.",
    });
  }

  // Build conversation history for Ollama
  let conversation;
  if (Array.isArray(messages) && messages.length > 0) {
    // Multi-turn: use provided history, append latest user message if given
    conversation = messages;
    if (message) {
      conversation = [...messages, { role: "user", content: message }];
    }
  } else {
    // Single-turn
    conversation = [{ role: "user", content: message }];
  }

  try {
    const reply = await sendChatToOllama(conversation);
    return res.json({ success: true, message: reply });
  } catch (err) {
    console.error("[chat.controller] Ollama error:", err.message);

    // Distinguish between connectivity errors and model errors
    const isConnectionError =
      err.message.includes("Could not reach Ollama") ||
      err.message.includes("timed out");

    return res.status(isConnectionError ? 503 : 500).json({
      success: false,
      error: err.message,
    });
  }
}
