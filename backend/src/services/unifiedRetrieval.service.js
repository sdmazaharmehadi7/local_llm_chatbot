/**
 * Unified Retrieval Service
 *
 * Single unified entry point that orchestrates document retrieval across:
 * 1. Chat-scoped attachments (via existing rag.service.js)
 * 2. Knowledge Base documents (via existing knowledgeBase.service.js and qdrant.service.js)
 *
 * STRICT REUSE & ACCESS-CONTROL RULES:
 * - Reuses existing Qdrant client, collections, and nomic embedding service.
 * - Does NOT create duplicate collections or duplicate vector connections.
 * - Never bypasses chatId, userId, or workspaceId security boundaries.
 * - Normalizes results into a uniform schema for Agent tools.
 */

import { retrieveChatContext } from "./rag.service.js";
import { generateEmbedding } from "./embedding.service.js";
import { searchKnowledgeBasePoints } from "./qdrant.service.js";
import { buildKnowledgeBaseContext } from "./contextBuilder.service.js";

/**
 * Execute unified retrieval across authorized document sources.
 *
 * @param {object} params
 * @param {string} params.query - The search query
 * @param {string} [params.chatId] - Current chat ID for chat attachments
 * @param {string} [params.userId] - Verified user ID
 * @param {string} [params.workspaceId="default"] - Workspace ID for KB access
 * @param {string} [params.documentId] - Optional filter for specific document
 * @param {string} [params.sourceScope="all"] - "chat" | "knowledge_base" | "all"
 * @param {number} [params.limit=10] - Max results to return
 * @param {number} [params.scoreThreshold=0.35] - Minimum cosine similarity threshold
 * @returns {Promise<{
 *   success: boolean,
 *   query: string,
 *   results: Array<{
 *     documentId: string,
 *     filename: string,
 *     page: number,
 *     chunkIndex: number,
 *     score: number,
 *     text: string
 *   }>,
 *   error?: string
 * }>}
 */
export async function executeUnifiedRetrieval({
  query,
  chatId = null,
  userId = null,
  workspaceId = "default",
  documentId = null,
  sourceScope = "all",
  limit = 10,
  scoreThreshold = 0.35,
}) {
  const cleanQuery = (query || "").trim();
  if (!cleanQuery) {
    return { success: true, query: "", results: [] };
  }

  const normalizedResults = [];
  const errors = [];

  const shouldQueryChat = (sourceScope === "chat" || sourceScope === "all") && Boolean(chatId);
  const shouldQueryKB = sourceScope === "knowledge_base" || sourceScope === "all";

  let chatContextText = "";
  let chatSources = [];

  // 1. Query Chat-scoped attachments if eligible
  if (shouldQueryChat) {
    try {
      const chatRes = await retrieveChatContext({
        query: cleanQuery,
        chatId: String(chatId),
        userId: userId ? String(userId) : null,
        limit,
        scoreThreshold,
      });

      if (chatRes && Array.isArray(chatRes.chunks)) {
        chatContextText = chatRes.contextText || "";
        chatSources = chatRes.sources || [];
        for (const chunk of chatRes.chunks) {
          // If documentId filter is requested, enforce it
          if (documentId && String(chunk.documentId) !== String(documentId)) {
            continue;
          }
          normalizedResults.push({
            documentId: chunk.documentId || "unknown",
            filename: chunk.filename || "chat-attachment",
            page: chunk.page || chunk.pageNumber || 1,
            chunkIndex: chunk.chunkIndex !== undefined ? chunk.chunkIndex : 0,
            score: typeof chunk.score === "number" ? chunk.score : 1.0,
            text: chunk.text || "",
            source: "chat",
          });
        }
      }
    } catch (chatErr) {
      console.warn(`[unifiedRetrieval] Chat retrieval warning for chat ${chatId}:`, chatErr.message);
      errors.push(`Chat retrieval: ${chatErr.message}`);
    }
  }

  // 2. Query Knowledge Base if eligible
  let kbContextText = "";
  let kbSources = [];

  if (shouldQueryKB) {
    try {
      const queryVector = await generateEmbedding(cleanQuery);
      const kbMatches = await searchKnowledgeBasePoints({
        vector: queryVector,
        documentId: documentId ? String(documentId) : null,
        workspaceId: workspaceId || "default",
        userId: userId ? String(userId) : null,
        limit,
        scoreThreshold,
      });

      if (Array.isArray(kbMatches) && kbMatches.length > 0) {
        // Pass through Context Builder for deduplication, bounds checking, and source attribution
        const kbContext = buildKnowledgeBaseContext(kbMatches, {
          targetDocumentId: documentId ? String(documentId) : null,
          scoreThreshold,
          maxChunks: limit,
        });

        kbContextText = kbContext.contextText || "";
        kbSources = kbContext.sources || [];

        for (const match of kbMatches) {
          const p = match.payload || {};
          if (documentId && String(p.documentId) !== String(documentId)) {
            continue;
          }
          normalizedResults.push({
            documentId: p.documentId || match.id || "kb-doc",
            filename: p.filename || "Knowledge Base Document",
            page: p.page || p.pageNumber || 1,
            chunkIndex: p.chunkIndex !== undefined ? p.chunkIndex : 0,
            score: typeof match.score === "number" ? match.score : 1.0,
            text: p.text || "",
            source: "knowledge_base",
          });
        }
      }
    } catch (kbErr) {
      console.warn(`[unifiedRetrieval] KB retrieval warning for workspace ${workspaceId}:`, kbErr.message);
      errors.push(`KB retrieval: ${kbErr.message}`);
    }
  }

  // 3. Sort merged results by relevance score (descending) and cap at limit
  normalizedResults.sort((a, b) => b.score - a.score);
  const finalResults = normalizedResults.slice(0, limit);

  // 4. Assemble merged context content from Chat and Knowledge Base
  const contextSections = [];
  if (chatContextText && chatContextText.trim()) {
    contextSections.push(chatContextText.trim());
  }
  if (kbContextText && kbContextText.trim()) {
    contextSections.push(kbContextText.trim());
  }

  const mergedContent = contextSections.length > 0
    ? contextSections.join("\n\n---\n\n")
    : (finalResults.length > 0
        ? finalResults.map((r) => `[${r.filename} - Page ${r.page}]\n${r.text}`).join("\n\n---\n\n")
        : "");

  // 5. Deduplicate sources
  const seenSourceKeys = new Set();
  const mergedSources = [];
  for (const src of [...chatSources, ...kbSources]) {
    const key = `${src.documentId || src.filename}:::${src.page || src.pageText || (src.pages ? src.pages.join(",") : "")}`;
    if (!seenSourceKeys.has(key)) {
      seenSourceKeys.add(key);
      mergedSources.push(src);
    }
  }

  if (mergedSources.length === 0 && finalResults.length > 0) {
    for (const r of finalResults) {
      const key = `${r.documentId || r.filename}:::${r.page}`;
      if (!seenSourceKeys.has(key)) {
        seenSourceKeys.add(key);
        mergedSources.push({
          documentId: r.documentId,
          filename: r.filename,
          page: r.page,
        });
      }
    }
  }

  return {
    success: errors.length === 0 || finalResults.length > 0 || Boolean(mergedContent),
    query: cleanQuery,
    content: mergedContent,
    sources: mergedSources,
    results: finalResults,
    hasContext: Boolean(mergedContent) || finalResults.length > 0,
    ...(errors.length > 0 && finalResults.length === 0 && !mergedContent ? { error: errors.join("; ") } : {}),
  };
}

export default { executeUnifiedRetrieval };
