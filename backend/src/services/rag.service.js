/**
 * RAG Service
 *
 * Implements chat-scoped Retrieval-Augmented Generation:
 * - Document text extraction (PDF via pdf-parse with page preservation, text/code files)
 * - Text chunking with page number preservation
 * - Embedding generation via nomic-embed-text
 * - Storing vector points with metadata in Qdrant (scope = "chat", chatId, userId)
 * - Chat-scoped retrieval with strict chatId isolation
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { PDFParse } from "pdf-parse";
import File from "../models/File.js";
import { upsertPoints, searchChatPoints, getChatPoints } from "./qdrant.service.js";
import { generateEmbedding, generateBatchEmbeddings } from "./embedding.service.js";

// Text-like extensions supported for direct text extraction
const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".html",
  ".htm",
  ".xml",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".jsx",
  ".tsx",
  ".py",
  ".java",
  ".c",
  ".cpp",
  ".css",
  ".log",
  ".sql",
  ".env",
  ".sh",
]);

/**
 * Check if a file is an indexable document (PDF or text).
 * @param {string} filename
 * @param {string} mimeType
 * @returns {boolean}
 */
export function isIndexableDocument(filename = "", mimeType = "") {
  const ext = path.extname(filename).toLowerCase();
  if (mimeType === "application/pdf" || ext === ".pdf") {
    return true;
  }
  if (TEXT_EXTENSIONS.has(ext)) {
    return true;
  }
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return true;
  }
  return false;
}

/**
 * Extract text from a document preserving page numbers when available.
 *
 * @param {string} filePath - Absolute path to file on disk
 * @param {string} mimeType - MIME type
 * @param {string} filename - Original filename
 * @returns {Promise<Array<{pageNumber: number, text: string}>>}
 */
export async function extractDocumentPages(filePath, mimeType = "", filename = "") {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist at path: ${filePath}`);
  }

  const ext = path.extname(filename || filePath).toLowerCase();
  const isPdf = mimeType === "application/pdf" || ext === ".pdf";

  if (isPdf) {
    const fileBuffer = await fs.promises.readFile(filePath);
    let parser;
    try {
      parser = new PDFParse({ data: fileBuffer });
      const parsed = await parser.getText();
      const rawPages = parsed?.pages || [];

      if (Array.isArray(rawPages) && rawPages.length > 0) {
        return rawPages
          .map((p) => ({
            pageNumber: p.num || 1,
            text: (p.text || "").trim(),
          }))
          .filter((p) => p.text.length > 0);
      }

      // Fallback if individual pages were not returned
      const fullText = (parsed?.text || "").trim();
      return fullText ? [{ pageNumber: 1, text: fullText }] : [];
    } finally {
      if (parser && typeof parser.destroy === "function") {
        try {
          await parser.destroy();
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  // Text-based documents (txt, md, csv, json, code files, etc.)
  const content = await fs.promises.readFile(filePath, "utf-8");
  const cleanContent = content.trim();
  if (!cleanContent) return [];

  return [{ pageNumber: 1, text: cleanContent }];
}

/**
 * Split pages of text into reasonable chunks (~600-800 chars) with overlap.
 *
 * @param {Array<{pageNumber: number, text: string}>} pages
 * @param {number} [maxChunkSize=700]
 * @param {number} [overlap=100]
 * @returns {Array<{chunkIndex: number, pageNumber: number, text: string}>}
 */
export function chunkPages(pages, maxChunkSize = 700, overlap = 100) {
  const chunks = [];
  let globalChunkIndex = 0;

  for (const page of pages) {
    const { pageNumber, text } = page;
    if (!text || text.length < 15) continue;

    // If page text is within maxChunkSize, keep as single chunk
    if (text.length <= maxChunkSize) {
      chunks.push({
        chunkIndex: globalChunkIndex++,
        pageNumber,
        text,
      });
      continue;
    }

    // Split text into paragraphs
    const paragraphs = text.split(/\n\s*\n/);
    let currentChunk = "";

    for (const paragraph of paragraphs) {
      const cleanPara = paragraph.trim();
      if (!cleanPara) continue;

      if ((currentChunk + "\n\n" + cleanPara).length <= maxChunkSize) {
        currentChunk = currentChunk ? `${currentChunk}\n\n${cleanPara}` : cleanPara;
      } else {
        if (currentChunk) {
          chunks.push({
            chunkIndex: globalChunkIndex++,
            pageNumber,
            text: currentChunk,
          });
          // Add overlap from previous chunk
          const overlapText = currentChunk.slice(-overlap).trim();
          currentChunk = overlapText ? `${overlapText}\n\n${cleanPara}` : cleanPara;
        } else {
          // Single paragraph is longer than maxChunkSize, split into windows
          let start = 0;
          while (start < cleanPara.length) {
            const end = Math.min(start + maxChunkSize, cleanPara.length);
            const slice = cleanPara.slice(start, end).trim();
            if (slice.length >= 15) {
              chunks.push({
                chunkIndex: globalChunkIndex++,
                pageNumber,
                text: slice,
              });
            }
            start += maxChunkSize - overlap;
          }
          currentChunk = "";
        }
      }
    }

    if (currentChunk.trim().length >= 15) {
      chunks.push({
        chunkIndex: globalChunkIndex++,
        pageNumber,
        text: currentChunk.trim(),
      });
    }
  }

  return chunks;
}

/**
 * Process an uploaded document, chunk it, embed chunks with nomic-embed-text,
 * and index into Qdrant under scope = "chat" with the document's chatId.
 *
 * @param {object} fileDoc - Mongoose File document
 * @returns {Promise<{success: boolean, chunkCount: number, error?: string}>}
 */
export async function processAndIndexDocument(fileDoc) {
  if (!fileDoc) {
    return { success: false, chunkCount: 0, error: "File document is null" };
  }

  const fileId = fileDoc._id.toString();
  const filePath = fileDoc.storagePath || fileDoc.path;
  const filename = fileDoc.originalName || fileDoc.filename;
  const mimeType = fileDoc.mimeType || "";
  const chatId = fileDoc.chatId ? String(fileDoc.chatId) : null;
  const userId = fileDoc.userId ? String(fileDoc.userId) : null;

  if (!isIndexableDocument(filename, mimeType)) {
    console.log(`[rag.service] Skipping non-document file: ${filename} (${mimeType})`);
    return { success: true, chunkCount: 0 };
  }

  try {
    // Update status to processing
    await File.updateOne({ _id: fileId }, { $set: { status: "processing" } });

    console.log(`[rag.service] Processing document: "${filename}" for chat: ${chatId}`);

    // 1. Extract text preserving page numbers
    const pages = await extractDocumentPages(filePath, mimeType, filename);
    if (pages.length === 0) {
      console.warn(`[rag.service] No extractable text found in "${filename}"`);
      await File.updateOne(
        { _id: fileId },
        { $set: { status: "indexed", chunkCount: 0, updatedAt: new Date() } }
      );
      return { success: true, chunkCount: 0 };
    }

    // 2. Chunk text
    const chunks = chunkPages(pages);
    console.log(`[rag.service] Extracted ${pages.length} pages, produced ${chunks.length} chunks.`);

    if (chunks.length === 0) {
      await File.updateOne(
        { _id: fileId },
        { $set: { status: "indexed", chunkCount: 0, updatedAt: new Date() } }
      );
      return { success: true, chunkCount: 0 };
    }

    // 3. Generate embeddings using nomic-embed-text
    console.log(`[rag.service] Generating embeddings via nomic-embed-text...`);
    const texts = chunks.map((c) => c.text);
    const embeddings = await generateBatchEmbeddings(texts);

    // 4. Build Qdrant points with payload metadata
    const points = chunks.map((chunk, i) => ({
      id: crypto.randomUUID(),
      vector: embeddings[i],
      payload: {
        documentId: fileId,
        chatId: chatId,
        userId: userId,
        scope: "chat",
        filename: filename,
        page: chunk.pageNumber,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
      },
    }));

    // 5. Upsert points to Qdrant collection local_chat_documents
    await upsertPoints(points);

    // 6. Update MongoDB File metadata
    await File.updateOne(
      { _id: fileId },
      {
        $set: {
          status: "indexed",
          chunkCount: points.length,
          updatedAt: new Date(),
        },
      }
    );

    console.log(`[rag.service] Successfully indexed ${points.length} chunks for "${filename}".`);
    return { success: true, chunkCount: points.length };
  } catch (err) {
    console.error(`[rag.service] Failed to index document ${fileId} ("${filename}"):`, err.message);
    await File.updateOne(
      { _id: fileId },
      { $set: { status: "failed", updatedAt: new Date() } }
    ).catch(() => {});
    return { success: false, chunkCount: 0, error: err.message };
  }
}

/**
 * Retrieve chat-scoped document context for a user query.
 *
 * SENSIBLE DOCUMENT-SUMMARY & RETRIEVAL STRATEGY:
 * - Queries for summaries ("give me summary of this pdf", "overview", etc.) or
 *   documents of reasonable size (<= 25 chunks, up to ~10 pages) retrieve
 *   chronological chunks ordered by pageNumber and chunkIndex so the LLM has
 *   the complete document to generate a high-quality summary.
 * - Specific queries use vector similarity search (nomic-embed-text) with
 *   payload filtering strictly scoped to chatId and scope = "chat".
 *
 * STRICT SECURITY:
 * Only returns chunks matching scope = "chat" AND chatId = currentChatId.
 *
 * @param {object} params
 * @param {string} params.query - User message text
 * @param {string} params.chatId - Current chat ID
 * @param {string} [params.userId] - Current user ID
 * @param {number} [params.limit=15] - Maximum chunks to retrieve
 * @param {number} [params.scoreThreshold=0.15] - Minimum cosine similarity
 * @returns {Promise<{hasContext: boolean, chunks: Array<object>, sources: Array<object>, contextText: string}>}
 */
export async function retrieveChatContext({
  query,
  chatId,
  userId = null,
  limit = 15,
  scoreThreshold = 0.15,
}) {
  if (!chatId) {
    return { hasContext: false, chunks: [], sources: [], contextText: "" };
  }

  try {
    // 1. Check all points available for this chat in Qdrant
    const allChatPoints = await getChatPoints({
      chatId: String(chatId),
      userId: userId ? String(userId) : null,
      scope: "chat",
      limit: 60,
    });

    if (!Array.isArray(allChatPoints) || allChatPoints.length === 0) {
      return { hasContext: false, chunks: [], sources: [], contextText: "" };
    }

    const cleanQuery = (query || "").trim();
    // Detect summary / overview intent
    const isSummaryQuery =
      !cleanQuery ||
      /\b(summar(y|ize)|overview|brief|about|what does this|explain this|review|outline|content|key points|gist|takeaway|analyze|analysis)\b/i.test(
        cleanQuery
      );

    let selectedChunks = [];

    // Document is small (<= 25 chunks, up to ~10 pages) OR user wants a summary:
    // Supply chunks in chronological page order for complete and accurate context.
    if (allChatPoints.length <= 25 || isSummaryQuery) {
      const sorted = [...allChatPoints].sort((a, b) => {
        const pageA = a.payload?.page || a.payload?.pageNumber || 1;
        const pageB = b.payload?.page || b.payload?.pageNumber || 1;
        if (pageA !== pageB) return pageA - pageB;
        return (a.payload?.chunkIndex || 0) - (b.payload?.chunkIndex || 0);
      });

      if (sorted.length <= 25) {
        selectedChunks = sorted.map((p) => p.payload);
      } else {
        // For large documents on summary requests: sample intro, middle, and end chunks
        const firstFew = sorted.slice(0, 8);
        const mid = Math.floor(sorted.length / 2);
        const midFew = sorted.slice(Math.max(0, mid - 3), mid + 3);
        const lastFew = sorted.slice(-4);
        const combinedMap = new Map();
        [...firstFew, ...midFew, ...lastFew].forEach((p) => combinedMap.set(p.id, p.payload));
        selectedChunks = Array.from(combinedMap.values());
      }
    } else {
      // Specific user query on a larger document: use vector similarity search
      const queryVector = await generateEmbedding(cleanQuery);
      const matches = await searchChatPoints({
        vector: queryVector,
        chatId: String(chatId),
        userId: userId ? String(userId) : null,
        scope: "chat",
        limit,
        scoreThreshold,
      });

      if (matches.length > 0) {
        selectedChunks = matches.map((m) => m.payload).filter(Boolean);
      } else {
        // Fallback: take initial document chunks so model is grounded
        selectedChunks = allChatPoints.slice(0, 8).map((p) => p.payload).filter(Boolean);
      }
    }

    if (selectedChunks.length === 0) {
      return { hasContext: false, chunks: [], sources: [], contextText: "" };
    }

    // Deduplicate chunks and sort chronologically by page and chunkIndex
    const seenChunkKeys = new Set();
    const deduplicatedChunks = [];
    for (const c of selectedChunks) {
      const key = `${c.documentId}:::${c.page || c.pageNumber}:::${c.chunkIndex}`;
      if (!seenChunkKeys.has(key)) {
        seenChunkKeys.add(key);
        deduplicatedChunks.push(c);
      }
    }

    deduplicatedChunks.sort((a, b) => {
      const pageA = a.page || a.pageNumber || 1;
      const pageB = b.page || b.pageNumber || 1;
      if (pageA !== pageB) return pageA - pageB;
      return (a.chunkIndex || 0) - (b.chunkIndex || 0);
    });

    // Extract deduplicated source citations
    const seenSources = new Set();
    const sources = [];
    for (const chunk of deduplicatedChunks) {
      const page = chunk.page || chunk.pageNumber || 1;
      const filename = chunk.filename || "document";
      const sourceKey = `${filename}:::${page}`;
      if (!seenSources.has(sourceKey)) {
        seenSources.add(sourceKey);
        sources.push({
          filename,
          page,
          documentId: chunk.documentId,
        });
      }
    }

    // Construct readable context sections
    const contextSections = deduplicatedChunks.map(
      (chunk) =>
        `[Document: ${chunk.filename} — Page ${chunk.page || chunk.pageNumber || 1}]\n${chunk.text}`
    );
    const contextText = contextSections.join("\n\n---\n\n");

    return {
      hasContext: true,
      chunks: deduplicatedChunks,
      sources,
      contextText,
    };
  } catch (err) {
    console.warn(`[rag.service] Retrieval notice for chat ${chatId}:`, err.message);
    return { hasContext: false, chunks: [], sources: [], contextText: "" };
  }
}

/**
 * Augment conversation messages with chat-scoped document context.
 *
 * @param {Array<{role: string, content: string, images?: string[]}>} messages
 * @param {string} contextText
 * @param {Array<{filename: string, page: number, documentId?: string}>} sources
 * @returns {Array<{role: string, content: string, images?: string[]}>}
 */
export function buildAugmentedMessages(messages, contextText, sources = []) {
  if (!contextText || !Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  const sourcesList = sources
    .map((s) => `- ${s.filename}${s.page ? ` — Page ${s.page}` : ""}`)
    .join("\n");

  const systemInstructions = `You are a helpful and accurate assistant. You have access to the following verified document excerpts uploaded specifically to this chat:

DOCUMENT CONTEXT:
---
${contextText}
---

INSTRUCTIONS:
1. Use the document context above to answer the user's question, produce summaries, or provide requested insights.
2. Rely strictly on the provided document facts. Do not invent or hallucinate information not present in the document.
3. At the end of your response, list the source documents used in this exact format:
Sources:
${sourcesList || "- Document"}
`;

  // Clone messages
  const augmented = messages.map((m) => ({ ...m }));

  // Find or insert system prompt
  const existingSystemIndex = augmented.findIndex((m) => m.role === "system");
  if (existingSystemIndex !== -1) {
    augmented[existingSystemIndex] = {
      ...augmented[existingSystemIndex],
      content: `${augmented[existingSystemIndex].content}\n\n${systemInstructions}`,
    };
  } else {
    augmented.unshift({
      role: "system",
      content: systemInstructions,
    });
  }

  return augmented;
}
