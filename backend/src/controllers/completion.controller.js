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
 * Enforces one-model-at-a-time RAM management:
 * Verifies that the requested model is valid and loaded before streaming.
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
  isSwitching,
  switchModel,
} from "../services/ollama.service.js";
import { isValidModelId } from "../constants/models.config.js";

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

  // ── 2. Validate requested model ─────────────────────────────────────────────
  let targetModel = requestedModel || getActiveModel();
  if (requestedModel && !isValidModelId(requestedModel)) {
    return res.status(400).json({
      success: false,
      error: `Selected model "${requestedModel}" is not available locally.`,
    });
  }

  // ── 3. Ensure target model is loaded in RAM (one-model-at-a-time) ───────────
  try {
    if (isSwitching() || targetModel !== getActiveModel()) {
      await switchModel(targetModel);
    }
  } catch (err) {
    console.error(`[completion.controller] Failed to ensure model ${targetModel}:`, err.message);
    return res.status(500).json({
      success: false,
      error: `Unable to prepare model "${targetModel}": ${err.message}`,
    });
  }

  // ── 4. Set SSE headers ──────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Vercel-AI-UI-Message-Stream", "v1");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // ── 5. Generate stable message ID for assistant turn ────────────────────────
  const messageId = crypto.randomUUID();

  // ── 6. Send stream start events ─────────────────────────────────────────────
  res.write(sseChunk({ type: "start", messageId }));
  res.write(sseChunk({ type: "start-step" }));
  res.write(sseChunk({ type: "text-start", id: "text-1" }));

  // ── 7. Stream from Ollama ───────────────────────────────────────────────────
  const ollamaMessages = toOllamaMessages(messages);

  let finishReason = "stop";
  let aborted = false;
  let inThinking = false;

  // Detect client disconnect (e.g. user closes tab or clicks stop)
  res.on("close", () => {
    if (!res.writableEnded) {
      aborted = true;
    }
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

        // 1. Handle thinking tokens (for reasoning models like qwen3)
        const thinkingDelta = chunk?.message?.thinking;
        if (thinkingDelta) {
          if (!inThinking) {
            inThinking = true;
            res.write(sseChunk({ type: "text-delta", id: "text-1", delta: "<think>\n" }));
          }
          res.write(sseChunk({ type: "text-delta", id: "text-1", delta: thinkingDelta }));
        }

        // 2. Handle actual response content
        const contentDelta = chunk?.message?.content;
        if (contentDelta) {
          if (inThinking) {
            inThinking = false;
            res.write(sseChunk({ type: "text-delta", id: "text-1", delta: "\n</think>\n\n" }));
          }
          res.write(sseChunk({ type: "text-delta", id: "text-1", delta: contentDelta }));
        }

        // 3. Handle stream completion
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

  // ── 8. Send stream end events ───────────────────────────────────────────────
  res.write(sseChunk({ type: "text-end", id: "text-1" }));
  res.write(sseChunk({ type: "finish-step" }));
  res.write(sseChunk({ type: "finish", finishReason }));
  res.write("data: [DONE]\n\n");
  res.end();

  console.log(`[CHAT] Streaming completed`);
}
