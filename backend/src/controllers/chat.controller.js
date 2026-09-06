/**
 * Chat Controller
 *
 * Handles HTTP request/response logic for legacy chat endpoints.
 * Supports both Gemini and Ollama providers based on LLM_PROVIDER.
 */

import { sendChatToOllama } from "../services/ollama.service.js";
import { sendChatToGemini } from "../services/gemini.service.js";
import { ragPipeline, RAG_CONFIG } from "../rag/index.js";

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

  // Build conversation history
  let conversation;
  if (Array.isArray(messages) && messages.length > 0) {
    conversation = messages;
    if (message) {
      conversation = [...messages, { role: "user", content: message }];
    }
  } else {
    conversation = [{ role: "user", content: message }];
  }

  const activeProvider = (
    process.env.LLM_PROVIDER ||
    RAG_CONFIG.llmProvider ||
    "ollama"
  ).toLowerCase();

  try {
    const userQuery = message || conversation[conversation.length - 1]?.content;
    if (userQuery) {
      const { context, chunks } = await ragPipeline.retrieveContext(userQuery);
      if (context) {
        conversation = ragPipeline.augmentMessages(conversation, context);
      }

      // ── RAG Debug Logging (Requested Verification) ──────────────────────────
      console.log("\n=======================================================");
      console.log("             🔍 [RAG DEBUG VERIFICATION]              ");
      console.log("=======================================================");
      console.log(`1. User Question:`);
      console.log(`   "${userQuery}"\n`);
      console.log(`2. Number of Chunks Retrieved: ${chunks ? chunks.length : 0}\n`);

      if (chunks && chunks.length > 0) {
        console.log("3 & 4. Retrieved Chunks Details & Similarity Scores:");
        chunks.forEach((chunk, idx) => {
          console.log(`   ───────────────────────────────────────────────────`);
          console.log(`   [Chunk #${idx + 1}]`);
          console.log(`   • Source Document: ${chunk.metadata?.filename || chunk.metadata?.source || chunk.metadata?.documentId || `Document ${idx + 1}`}`);
          console.log(`   • Similarity Score: ${chunk.score !== undefined ? chunk.score.toFixed(4) : "N/A"}`);
          console.log(`   • Chunk Text:\n"${chunk.text}"`);
        });
        console.log(`   ───────────────────────────────────────────────────\n`);
      } else {
        console.log("3 & 4. Retrieved Chunks: 0 chunks met the similarity threshold.\n");
      }

      console.log("5. Final Prompt / Context Sent to the LLM:");
      const systemMsg = conversation.find((m) => m.role === "system");
      if (systemMsg) {
        console.log(`   [Augmented System Prompt]:\n${systemMsg.content}\n`);
      } else {
        console.log("   (No system context augmented — sending raw prompt)\n");
      }
      console.log(`   [User Message]: "${userQuery}"`);
      console.log("=======================================================\n");
    }

    let reply;
    if (activeProvider === "gemini") {
      reply = await sendChatToGemini(conversation);
    } else {
      reply = await sendChatToOllama(conversation);
    }

    return res.json({ success: true, message: reply });
  } catch (err) {
    console.error(`[chat.controller] ${activeProvider} error:`, err.message);

    const isConnectionError =
      err.message.includes("not running") ||
      err.message.includes("Could not reach") ||
      err.message.includes("timed out");

    return res.status(isConnectionError ? 503 : 500).json({
      success: false,
      error: err.message,
    });
  }
}
