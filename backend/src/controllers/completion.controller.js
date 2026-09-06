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
 * Routing:
 *  - If model is a cloud model (e.g., gemini-3.6-flash) → streams via Gemini service
 *  - Otherwise → streams via Ollama with one-model-at-a-time RAM management
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
import { isValidModelId, isCloudModelId } from "../constants/models.config.js";

/** Serialize one UI-message-stream chunk as an SSE data line. */
function sseChunk(part) {
  return `data: ${JSON.stringify(part)}\n\n`;
}

/**
 * Convert frontend messages to Ollama format.
 * Frontend sends: [{ id, role, content, fileIds }]
 * Ollama expects: [{ role, content }]
 */
function toOllamaMessages(messages) {
  return messages.map(({ role, content }) => ({
    role,
    content: content || "",
  }));
}

/**
 * Set SSE response headers and flush.
 */
function beginSseStream(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Vercel-AI-UI-Message-Stream", "v1");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

// ── Gemini streaming ─────────────────────────────────────────────────────────

/**
 * Stream chat through Gemini 3.6 Flash.
 */
async function streamGeminiCompletion(res, messages, chatId) {
  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({
      success: false,
      error: "Gemini is not configured. Add GEMINI_API_KEY to backend/.env",
    });
  }

  beginSseStream(res);

  const messageId = crypto.randomUUID();
  res.write(sseChunk({ type: "start", messageId }));
  res.write(sseChunk({ type: "start-step" }));
  res.write(sseChunk({ type: "text-start", id: "text-1" }));

  let aborted = false;
  let finishReason = "stop";

  res.on("close", () => {
    if (!res.writableEnded) aborted = true;
  });

  console.log(`[CHAT] Using model: gemini-3.6-flash`);
  console.log(`[CHAT] Streaming started (Gemini)`);

  try {
    for await (const delta of streamChatFromGemini(messages)) {
      if (aborted) break;
      if (delta) {
        res.write(sseChunk({ type: "text-delta", id: "text-1", delta }));
      }
    }
  } catch (err) {
    if (!aborted) {
      console.error(`[completion.controller] Gemini stream error for chat ${chatId}:`, err.message);
      res.write(sseChunk({ type: "error", errorText: err.message }));
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  res.write(sseChunk({ type: "text-end", id: "text-1" }));
  res.write(sseChunk({ type: "finish-step" }));
  res.write(sseChunk({ type: "finish", finishReason }));
  res.write("data: [DONE]\n\n");
  res.end();

  console.log(`[CHAT] Streaming completed (Gemini)`);
}

// ── Ollama streaming ──────────────────────────────────────────────────────────

/**
 * Stream chat through local Ollama model.
 */
async function streamOllamaCompletion(res, messages, targetModel, chatId) {
  // Check Ollama reachability
  const reachable = await isOllamaReachable();
  if (!reachable) {
    return res.status(503).json({
      success: false,
      error: "Ollama is not running. Please start Ollama manually.",
    });
  }

  // Validate model
  if (!isValidModelId(targetModel)) {
    return res.status(400).json({
      success: false,
      error: "Selected model is not available locally.",
    });
  }

  // Check if model exists locally in Ollama
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

  // Lazy Load: Ensure ONLY target model is loaded in RAM
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

  beginSseStream(res);

  const messageId = crypto.randomUUID();
  res.write(sseChunk({ type: "start", messageId }));
  res.write(sseChunk({ type: "start-step" }));
  res.write(sseChunk({ type: "text-start", id: "text-1" }));

  const ollamaMessages = toOllamaMessages(messages);
  let finishReason = "stop";
  let aborted = false;
  let inThinking = false;

  res.on("close", () => {
    if (!res.writableEnded) aborted = true;
  });

  console.log(`[CHAT] Using model: ${targetModel}`);
  console.log(`[CHAT] Streaming started`);

  try {
    const { stream: ollamaStream } = await streamChatFromOllama(
      ollamaMessages,
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

        // Handle thinking tokens (reasoning models like qwen3)
        const thinkingDelta = chunk?.message?.thinking;
        if (thinkingDelta) {
          if (!inThinking) {
            inThinking = true;
            res.write(sseChunk({ type: "text-delta", id: "text-1", delta: "<think>\n" }));
          }
          res.write(sseChunk({ type: "text-delta", id: "text-1", delta: thinkingDelta }));
        }

        // Handle actual response content
        const contentDelta = chunk?.message?.content;
        if (contentDelta) {
          if (inThinking) {
            inThinking = false;
            res.write(sseChunk({ type: "text-delta", id: "text-1", delta: "\n</think>\n\n" }));
          }
          res.write(sseChunk({ type: "text-delta", id: "text-1", delta: contentDelta }));
        }

        // Handle stream completion
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

    // Flush any remaining buffer line
    if (buffer.trim() && !aborted) {
      try {
        const chunk = JSON.parse(buffer.trim());
        const contentDelta = chunk?.message?.content;
        if (contentDelta) {
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
      console.error(`[completion.controller] Stream error for chat ${chatId}:`, err.message);
      res.write(sseChunk({ type: "error", errorText: err.message }));
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }

  // Close thinking block if still open
  if (inThinking) {
    res.write(sseChunk({ type: "text-delta", id: "text-1", delta: "\n</think>\n\n" }));
  }

  res.write(sseChunk({ type: "text-end", id: "text-1" }));
  res.write(sseChunk({ type: "finish-step" }));
  res.write(sseChunk({ type: "finish", finishReason }));
  res.write("data: [DONE]\n\n");
  res.end();

  console.log(`[CHAT] Streaming completed`);
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * POST /api/chats/:id/completion
 */
export async function postCompletion(req, res) {
  const { id: chatId } = req.params;
  const { messages, model: requestedModel } = req.body;

  // Validate request
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      success: false,
      error: "Request must include a non-empty 'messages' array.",
    });
  }

  const targetModel = requestedModel || getActiveModel();

  // Route to Gemini if cloud model requested
  if (isCloudModelId(targetModel)) {
    return streamGeminiCompletion(res, messages, chatId);
  }

  // Otherwise route to Ollama
  return streamOllamaCompletion(res, messages, targetModel, chatId);
}
