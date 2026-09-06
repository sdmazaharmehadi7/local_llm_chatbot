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
 * Multi-Turn Architecture:
 *   1. Verifies chat ownership for req.userId.
 *   2. Persists incoming user message into MongoDB (preventing duplicates via ID upsert).
 *   3. Loads the chat's persistent message history from MongoDB for chatId.
 *   4. Supplies the complete conversation context to the selected model.
 *   5. Streams the assistant response as SSE (AI SDK v6 UI Message Stream protocol).
 *   6. Upon stream completion, persists ONE complete assistant message with the model name to MongoDB.
 *   7. Updates Chat.updatedAt and auto-titles if necessary.
 */

import fs from "fs";
import crypto from "crypto";
import mongoose from "mongoose";
import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import File from "../models/File.js";
import {
  streamChatFromOllama,
  getActiveModel,
  switchModel,
  isOllamaReachable,
  getInstalledModels,
} from "../services/ollama.service.js";
import { streamChatFromGemini } from "../services/gemini.service.js";
import { isValidModelId, isCloudModelId } from "../constants/models.config.js";
import {
  isIndexableDocument,
  processAndIndexDocument,
  retrieveChatContext,
  buildAugmentedMessages,
} from "../services/rag.service.js";
import { countPointsForChat } from "../services/qdrant.service.js";

/** Serialize one UI-message-stream chunk as an SSE data line. */
function sseChunk(part) {
  return `data: ${JSON.stringify(part)}\n\n`;
}

/**
 * Convert internal messages to Ollama format.
 * Ollama expects: [{ role, content, images?: string[] }]
 */
function toOllamaMessages(messages) {
  return messages.map(({ role, content, images }) => {
    const msg = {
      role,
      content: (content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
    };
    if (Array.isArray(images) && images.length > 0) {
      msg.images = images;
    }
    return msg;
  });
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
 * Stream chat through Gemini 3.6 Flash and persist response to MongoDB.
 */
async function streamGeminiCompletion(res, messages, chatId, targetModel, ragSources = []) {
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
  let fullResponseText = "";

  res.on("close", () => {
    if (!res.writableEnded) aborted = true;
  });

  console.log(`[CHAT] Using model: ${targetModel}`);
  console.log(`[CHAT] Streaming started (Gemini)`);

  try {
    for await (const delta of streamChatFromGemini(messages)) {
      if (aborted) break;
      if (delta) {
        fullResponseText += delta;
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

  // Persist ONE complete assistant message in MongoDB
  if (!aborted && fullResponseText.trim()) {
    try {
      const parts = [{ type: "text", text: fullResponseText }];
      if (Array.isArray(ragSources) && ragSources.length > 0) {
        for (const s of ragSources) {
          parts.push({
            type: "source",
            isDocument: true,
            filename: s.filename,
            page: s.page,
            documentId: s.documentId,
          });
        }
      }

      await Message.findOneAndUpdate(
        { _id: messageId, chatId },
        {
          $set: {
            chatId,
            role: "assistant",
            content: fullResponseText,
            parts,
            model: targetModel,
            metadata: ragSources?.length > 0 ? { ragSources } : null,
            createdAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );

      await Chat.updateOne(
        { _id: chatId },
        { $set: { updatedAt: new Date(), selectedModel: targetModel } }
      );
    } catch (saveErr) {
      console.error("[completion.controller] Failed to persist Gemini assistant message:", saveErr.message);
    }
  }
}

// ── Ollama streaming ──────────────────────────────────────────────────────────

/**
 * Stream chat through local Ollama model and persist response to MongoDB.
 */
async function streamOllamaCompletion(res, messages, targetModel, chatId, ragSources = []) {
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
  let fullResponseText = "";

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
            fullResponseText += "<think>\n";
          }
          fullResponseText += thinkingDelta;
          res.write(sseChunk({ type: "text-delta", id: "text-1", delta: thinkingDelta }));
        }

        // Handle actual response content
        const contentDelta = chunk?.message?.content;
        if (contentDelta) {
          if (inThinking) {
            inThinking = false;
            res.write(sseChunk({ type: "text-delta", id: "text-1", delta: "\n</think>\n\n" }));
            fullResponseText += "\n</think>\n\n";
          }
          fullResponseText += contentDelta;
          res.write(sseChunk({ type: "text-delta", id: "text-1", delta: contentDelta }));
        }

        // Handle stream completion
        if (chunk?.done === true) {
          if (inThinking) {
            inThinking = false;
            res.write(sseChunk({ type: "text-delta", id: "text-1", delta: "\n</think>\n\n" }));
            fullResponseText += "\n</think>\n\n";
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
            fullResponseText += "\n</think>\n\n";
          }
          fullResponseText += contentDelta;
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
    fullResponseText += "\n</think>\n\n";
  }

  res.write(sseChunk({ type: "text-end", id: "text-1" }));
  res.write(sseChunk({ type: "finish-step" }));
  res.write(sseChunk({ type: "finish", finishReason }));
  res.write("data: [DONE]\n\n");
  res.end();

  console.log(`[CHAT] Streaming completed`);

  // Persist ONE complete assistant message in MongoDB
  if (!aborted && fullResponseText.trim()) {
    try {
      const parts = [{ type: "text", text: fullResponseText }];
      if (Array.isArray(ragSources) && ragSources.length > 0) {
        for (const s of ragSources) {
          parts.push({
            type: "source",
            isDocument: true,
            filename: s.filename,
            page: s.page,
            documentId: s.documentId,
          });
        }
      }

      await Message.findOneAndUpdate(
        { _id: messageId, chatId },
        {
          $set: {
            chatId,
            role: "assistant",
            content: fullResponseText,
            parts,
            model: targetModel,
            metadata: ragSources?.length > 0 ? { ragSources } : null,
            createdAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );

      await Chat.updateOne(
        { _id: chatId },
        { $set: { updatedAt: new Date(), selectedModel: targetModel } }
      );
    } catch (saveErr) {
      console.error("[completion.controller] Failed to persist Ollama assistant message:", saveErr.message);
    }
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * POST /api/chats/:id/completion
 */
export async function postCompletion(req, res) {
  const { id: chatId } = req.params;
  const { messages, model: requestedModel } = req.body;
  const userId = req.userId;

  // Validate request
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      success: false,
      error: "Request must include a non-empty 'messages' array.",
    });
  }

  const incomingUserMsg = messages[messages.length - 1];
  const attachedFileIds = (incomingUserMsg?.fileIds || []).filter(Boolean);

  // 1. Inspect incoming attached files
  let attachedFiles = [];
  if (attachedFileIds.length > 0) {
    try {
      attachedFiles = await File.find({ _id: { $in: attachedFileIds } });
    } catch (e) {
      console.warn("[completion.controller] Failed to fetch attached files:", e.message);
    }
  }

  const hasIncomingImage = attachedFiles.some(
    (f) => f.category === "image" || f.mimeType?.startsWith("image/")
  );
  const hasIncomingDocument = attachedFiles.some(
    (f) =>
      isIndexableDocument(f.filename, f.mimeType) ||
      f.category === "pdf" ||
      f.category === "textLike" ||
      f.mimeType === "application/pdf"
  );

  // Ensure any attached document files are linked to this chatId and indexed in Qdrant
  if (attachedFiles.length > 0) {
    for (const f of attachedFiles) {
      let needsSave = false;
      if (!f.chatId || f.chatId !== chatId) {
        f.chatId = chatId;
        f.scope = "chat";
        needsSave = true;
      }
      if (needsSave) {
        await f.save().catch(() => {});
      }
      if (f.status !== "indexed" && isIndexableDocument(f.filename, f.mimeType)) {
        console.log(`[completion.controller] Indexing attached document: ${f.filename}`);
        await processAndIndexDocument(f).catch((e) => {
          console.error(`[completion.controller] Indexing attached file ${f._id} error:`, e.message);
        });
      }
    }
  }

  // 2. Check if current chat has any uploaded or indexed documents
  let existingChatDocsCount = 0;
  let qdrantPointCount = 0;
  try {
    existingChatDocsCount = await File.countDocuments({
      chatId,
      scope: "chat",
      category: { $ne: "image" },
    });
    qdrantPointCount = await countPointsForChat(chatId);
  } catch (e) {
    console.warn("[completion.controller] Error checking chat document count:", e.message);
  }

  const hasChatDocuments = hasIncomingDocument || existingChatDocsCount > 0 || qdrantPointCount > 0;

  // 3. Determine target generation model
  // STRICT RULE: Chat-scoped document RAG must use local Qwen3 8B. Never route to Gemini.
  let targetModel;
  if (hasChatDocuments) {
    targetModel = "qwen3:8b";
    console.log(`[CHAT] Document RAG active for chat ${chatId}. Enforcing local model: ${targetModel}`);
  } else if (hasIncomingImage) {
    targetModel = "qwen2.5vl:7b";
    console.log(`[CHAT] Image attachment detected. Enforcing vision model: ${targetModel}`);
  } else {
    targetModel = requestedModel && isValidModelId(requestedModel)
      ? requestedModel
      : (requestedModel || getActiveModel() || "qwen3:8b");
  }

  // 4. Verify / ensure chat document exists in MongoDB for this user
  let chat = await Chat.findOne({ _id: chatId, userId });
  if (!chat) {
    chat = await Chat.create({
      _id: chatId,
      userId,
      title: "New Chat",
      selectedModel: targetModel,
    });
  } else if (chat.selectedModel !== targetModel && (hasChatDocuments || hasIncomingImage)) {
    // Keep chat record synchronized with the active local model
    chat.selectedModel = targetModel;
    await chat.save().catch(() => {});
  }

  // 5. Save incoming user message to MongoDB to ensure persistence
  if (incomingUserMsg && incomingUserMsg.role === "user") {
    const userMsgId = incomingUserMsg.id || new mongoose.Types.ObjectId().toString();
    await Message.findOneAndUpdate(
      { _id: userMsgId, chatId },
      {
        $set: {
          chatId,
          role: "user",
          content: incomingUserMsg.content || "",
          parts: incomingUserMsg.parts || [{ type: "text", text: incomingUserMsg.content || "" }],
          fileIds: incomingUserMsg.fileIds || [],
          model: targetModel,
          createdAt: incomingUserMsg.createdAt ? new Date(incomingUserMsg.createdAt) : new Date(),
        },
      },
      { upsert: true, new: true }
    );

    // Auto-update chat title from first message if still "New Chat"
    if (chat.title === "New Chat" && incomingUserMsg.content && incomingUserMsg.content.trim()) {
      chat.title = incomingUserMsg.content.trim().slice(0, 30);
      await chat.save().catch(() => {});
    }
  }

  // 6. Load conversation history from MongoDB for this chatId ONLY
  const dbMessages = await Message.find({ chatId }).sort({ createdAt: 1 }).lean();

  // Load any associated image files to provide base64 to multimodal models
  const allFileIds = [...new Set(dbMessages.flatMap((m) => m.fileIds || []).filter(Boolean))];
  const imageFilesMap = new Map();
  if (allFileIds.length > 0) {
    const fileDocs = await File.find({ _id: { $in: allFileIds } }).lean();
    for (const f of fileDocs) {
      if (f.category === "image" || f.mimeType?.startsWith("image/")) {
        imageFilesMap.set(f._id.toString(), f);
      }
    }
  }

  const conversationContext = dbMessages.map((m) => {
    const item = {
      role: m.role,
      content: m.content || "",
    };

    if (m.role === "user" && Array.isArray(m.fileIds) && m.fileIds.length > 0) {
      const images = [];
      for (const fId of m.fileIds) {
        const fileDoc = imageFilesMap.get(fId.toString());
        if (fileDoc && fileDoc.path && fs.existsSync(fileDoc.path)) {
          try {
            const base64Data = fs.readFileSync(fileDoc.path).toString("base64");
            images.push(base64Data);
          } catch (readErr) {
            console.error(`[completion.controller] Failed to read image ${fId} from disk:`, readErr.message);
          }
        }
      }
      if (images.length > 0) {
        item.images = images;
      }
    }

    return item;
  });

  // 7. Perform Chat-Scoped RAG Retrieval (strictly scoped to this chatId)
  let ragResult = { hasContext: false, chunks: [], sources: [], contextText: "" };
  if (hasChatDocuments) {
    const queryText = incomingUserMsg?.content || "";
    ragResult = await retrieveChatContext({
      query: queryText.trim(),
      chatId,
      userId,
      limit: 15,
      scoreThreshold: 0.15,
    });
  }

  let finalContext = conversationContext;
  if (ragResult.hasContext) {
    console.log(`[CHAT] RAG context retrieved: ${ragResult.sources.length} sources for chat ${chatId}`);
    finalContext = buildAugmentedMessages(conversationContext, ragResult.contextText, ragResult.sources);
  }

  // 8. Route to LLM:
  // Gemini is allowed ONLY if requested for a normal chat (NO documents, NO images).
  if (isCloudModelId(targetModel) && !hasChatDocuments && !hasIncomingImage) {
    return streamGeminiCompletion(res, finalContext, chatId, targetModel, ragResult.sources);
  }

  // Otherwise route to local Ollama (Qwen3 8B for RAG / general chat, Qwen2.5-VL for images)
  return streamOllamaCompletion(res, finalContext, targetModel, chatId, ragResult.sources);
}
