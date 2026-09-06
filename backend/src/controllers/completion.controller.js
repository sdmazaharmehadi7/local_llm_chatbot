/**
 * Completion Controller
 *
 * Handles POST /api/chats/:id/completion
 *
 * Accepts the request format sent by @ai-sdk/react DefaultChatTransport:
 *   {
 *     model: string,
 *     systemPromptId: string,
 *     messages: Array<{ id, role, content, fileIds }>,
 *     webSearch: boolean,
 *     memoryEnabled: boolean
 *   }
 *
 * Supports dual LLM providers:
 *   - 'gemini': Cloud completions via Gemini API (@google/genai)
 *   - 'ollama': Local completions via Ollama (enforcing 1-model-in-RAM)
 *
 * Returns an SSE stream in the AI SDK v6 UI Message Stream protocol:
 *   data: {"type":"start","messageId":"<uuid>"}\n\n
 *   data: {"type":"start-step"}\n\n
 *   data: {"type":"text-start","id":"text-1"}\n\n
 *   data: {"type":"text-delta","id":"text-1","delta":"..."}\n\n
 *   ...
 *   data: {"type":"text-end","id":"text-1"}\n\n
 *   data: {"type":"finish-step"}\n\n
 *   data: {"type":"finish","finishReason":"stop"}\n\n
 *   data: [DONE]\n\n
 */

import {
  streamChatFromOllama,
  getActiveModel,
  switchModel,
  isOllamaReachable,
  getInstalledModels,
} from "../services/ollama.service.js";
import { streamChatFromGemini } from "../services/gemini.service.js";
import { isValidModelId } from "../constants/models.config.js";
import { ragPipeline, RAG_CONFIG } from "../rag/index.js";
import { query } from "../db/index.js";

/** Serialize one UI-message-stream chunk as an SSE data line. */
function sseChunk(part) {
  return `data: ${JSON.stringify(part)}\n\n`;
}

/**
 * Convert frontend messages to standard format [{ role, content }].
 */
function toStandardMessages(messages) {
  return messages.map(({ role, content }) => ({
    role,
    content: content || "",
  }));
}

/**
 * POST /api/chats/:id/completion
 */
export async function postCompletion(req, res) {
  const { id: chatId } = req.params;
  const { messages, model: requestedModel } = req.body;

  // ── 1. Validate request ─────────────────────────────────────────────────────
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      success: false,
      error: "Request must include a non-empty 'messages' array.",
    });
  }

  const activeProvider = (
    process.env.LLM_PROVIDER ||
    RAG_CONFIG.llmProvider ||
    "ollama"
  ).toLowerCase();

  const isGeminiProvider =
    activeProvider === "gemini" ||
    (requestedModel && requestedModel.startsWith("gemini-"));

  let targetModel;
  if (isGeminiProvider) {
    targetModel =
      requestedModel && requestedModel.startsWith("gemini-")
        ? requestedModel
        : process.env.GEMINI_MODEL || "gemini-3.6-flash";
  } else {
    targetModel = requestedModel || getActiveModel();
  }

  // ── 2. Handle Ollama-specific validations if using Ollama provider ─────────
  if (!isGeminiProvider) {
    const reachable = await isOllamaReachable();
    if (!reachable) {
      return res.status(503).json({
        success: false,
        error: "Ollama is not running. Please start Ollama manually.",
      });
    }

    if (!isValidModelId(targetModel)) {
      return res.status(400).json({
        success: false,
        error: "Selected model is not available locally.",
      });
    }

    const installedModels = await getInstalledModels();
    const isInstalled = installedModels.some(
      (name) => name === targetModel || name.startsWith(targetModel.split(":")[0])
    );
    if (installedModels.length > 0 && !isInstalled) {
      return res.status(400).json({
        success: false,
        error: "Selected model is not available locally.",
      });
    }

    try {
      await switchModel(targetModel);
    } catch (err) {
      console.error(`[completion.controller] Failed to ensure model ${targetModel}:`, err.message);
      const isConnErr =
        err.message.includes("reach Ollama") ||
        err.message.includes("fetch failed") ||
        err.message.includes("not running");
      return res.status(isConnErr ? 503 : 400).json({
        success: false,
        error: isConnErr
          ? "Ollama is not running. Please start Ollama manually."
          : "Selected model is not available locally.",
      });
    }
  }

  // ── 3. Set SSE headers ──────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Vercel-AI-UI-Message-Stream", "v1");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // ── 4. Send stream start events ─────────────────────────────────────────────
  const messageId = crypto.randomUUID();
  res.write(sseChunk({ type: "start", messageId }));
  res.write(sseChunk({ type: "start-step" }));
  res.write(sseChunk({ type: "text-start", id: "text-1" }));

  // ── 5. RAG Retrieval & Context Augmentation ─────────────────────────────────
  let chatMessages = toStandardMessages(messages);

  try {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    if (lastUserMsg && lastUserMsg.content) {
      const userQuestion = lastUserMsg.content;
      const { context, chunks } = await ragPipeline.retrieveContext(userQuestion);
      if (context) {
        chatMessages = ragPipeline.augmentMessages(chatMessages, context);
      }

      // ── RAG Debug Logging (Requested Verification) ──────────────────────────
      console.log("\n=======================================================");
      console.log("             🔍 [RAG DEBUG VERIFICATION]              ");
      console.log("=======================================================");
      console.log(`1. User Question:`);
      console.log(`   "${userQuestion}"\n`);
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
      const systemMsg = chatMessages.find((m) => m.role === "system");
      if (systemMsg) {
        console.log(`   [Augmented System Prompt]:\n${systemMsg.content}\n`);
      } else {
        console.log("   (No system context augmented — sending raw prompt)\n");
      }
      console.log(`   [User Message]: "${userQuestion}"`);
      console.log("=======================================================\n");
    }
  } catch (ragErr) {
    console.warn("[completion.controller] RAG retrieval notice:", ragErr.message);
  }

  let finishReason = "stop";
  let aborted = false;
  let accumulatedContent = "";

  res.on("close", () => {
    if (!res.writableEnded) {
      aborted = true;
    }
  });

  console.log(`[CHAT] Provider: ${isGeminiProvider ? "gemini" : "ollama"} | Model: ${targetModel}`);
  console.log(`[CHAT] Streaming started`);

  // ── 6. Stream Execution ─────────────────────────────────────────────────────
  if (isGeminiProvider) {
    // ── Gemini Streaming ─────────────
    try {
      const responseStream = await streamChatFromGemini(
        chatMessages,
        null,
        targetModel
      );

      for await (const chunk of responseStream) {
        if (aborted) break;
        const textDelta = chunk.text;
        if (textDelta) {
          accumulatedContent += textDelta;
          res.write(sseChunk({ type: "text-delta", id: "text-1", delta: textDelta }));
        }
      }
    } catch (err) {
      if (!aborted) {
        console.error(`[completion.controller] Gemini stream error:`, err.message);
        res.write(sseChunk({ type: "error", errorText: err.message }));
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
  } else {
    // ── Ollama Streaming ─────────────
    let inThinking = false;
    try {
      const { stream: ollamaStream } = await streamChatFromOllama(
        chatMessages,
        null,
        targetModel
      );

      const reader = ollamaStream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        if (aborted) {
          reader.cancel().catch(() => {});
          break;
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (aborted) break;
          const trimmed = line.trim();
          if (!trimmed) continue;

          let chunk;
          try {
            chunk = JSON.parse(trimmed);
          } catch {
            continue;
          }

          const thinkingDelta = chunk?.message?.thinking;
          if (thinkingDelta) {
            if (!inThinking) {
              inThinking = true;
              res.write(sseChunk({ type: "text-delta", id: "text-1", delta: "<think>\n" }));
            }
            res.write(sseChunk({ type: "text-delta", id: "text-1", delta: thinkingDelta }));
          }

          const contentDelta = chunk?.message?.content;
          if (contentDelta) {
            accumulatedContent += contentDelta;
            if (inThinking) {
              inThinking = false;
              res.write(sseChunk({ type: "text-delta", id: "text-1", delta: "\n</think>\n\n" }));
            }
            res.write(sseChunk({ type: "text-delta", id: "text-1", delta: contentDelta }));
          }

          if (chunk?.done === true) {
            if (inThinking) {
              inThinking = false;
              res.write(sseChunk({ type: "text-delta", id: "text-1", delta: "\n</think>\n\n" }));
            }
            const doneReason = chunk?.done_reason || "stop";
            finishReason = doneReason === "stop" ? "stop" : "other";
          }
        }
      }

      if (buffer.trim() && !aborted) {
        try {
          const chunk = JSON.parse(buffer.trim());
          const contentDelta = chunk?.message?.content;
          if (contentDelta) {
            accumulatedContent += contentDelta;
            if (inThinking) {
              inThinking = false;
              res.write(sseChunk({ type: "text-delta", id: "text-1", delta: "\n</think>\n\n" }));
            }
            res.write(sseChunk({ type: "text-delta", id: "text-1", delta: contentDelta }));
          }
        } catch {
          // Ignore incomplete final fragment
        }
      }
    } catch (err) {
      if (!aborted) {
        console.error(`[completion.controller] Ollama stream error:`, err.message);
        res.write(sseChunk({ type: "error", errorText: err.message }));
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    if (inThinking) {
      res.write(sseChunk({ type: "text-delta", id: "text-1", delta: "\n</think>\n\n" }));
    }
  }

  // ── 7. Send stream end events ───────────────────────────────────────────────
  res.write(sseChunk({ type: "text-end", id: "text-1" }));
  res.write(sseChunk({ type: "finish-step" }));
  res.write(sseChunk({ type: "finish", finishReason }));
  res.write("data: [DONE]\n\n");
  res.end();

  // ── 8. Asynchronously persist turn to PostgreSQL (Neon) ─────────────────────
  if (!aborted && accumulatedContent && chatId) {
    (async () => {
      try {
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        const titleSnippet = lastUser?.content ? lastUser.content.slice(0, 50) : "Chat";

        await query(
          `INSERT INTO chats (id, user_id, title, created_at, updated_at)
           VALUES ($1, 'user-local-admin', $2, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
          [chatId, titleSnippet]
        );

        if (lastUser) {
          const userMsgId = lastUser.id || `msg-${Date.now()}-u`;
          await query(
            `INSERT INTO messages (id, chat_id, role, content, parts, created_at)
             VALUES ($1, $2, 'user', $3, $4, NOW())
             ON CONFLICT (id) DO NOTHING`,
            [userMsgId, chatId, lastUser.content || "", JSON.stringify(lastUser.parts || [])]
          );
        }

        await query(
          `INSERT INTO messages (id, chat_id, role, content, parts, created_at)
           VALUES ($1, $2, 'assistant', $3, $4, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [
            messageId,
            chatId,
            accumulatedContent,
            JSON.stringify([{ type: "text", text: accumulatedContent }]),
          ]
        );
      } catch (dbErr) {
        console.warn("[completion.controller] Notice saving chat turn to DB:", dbErr.message);
      }
    })();
  }

  console.log(`[CHAT] Streaming completed`);
}
