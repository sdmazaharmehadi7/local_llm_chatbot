/**
 * Retrieval Tool
 *
 * Exposes a unified 'retrieve_information' capability to the Agent orchestrator.
 * Delegates directly to the existing Unified Retrieval Service.
 *
 * ACCESS CONTROL:
 * - Injects and prioritizes caller context (userId, chatId, workspaceId)
 * - Restricts retrieval scope to authorized resources only
 */

import { executeUnifiedRetrieval } from "../../unifiedRetrieval.service.js";

export const retrievalTool = {
  name: "retrieve_information",
  purpose:
    "Searches and retrieves verified facts, specifications, standard operating procedures (SOPs), manuals, policies, guidelines, and document excerpts from authorized chat attachments and Knowledge Base documentation.",
  whenToUse:
    "Use when the user asks questions about documents, files, manuals, SOPs, company/system procedures, policies, regulations, safety requirements, technical specifications, or domain-specific facts requiring external context.",
  whenNotToUse:
    "Do NOT use for pure mathematical calculations (use calculator instead), explicit string formatting (use text_transform instead), or generic conversational chit-chat that needs no factual lookup.",
  description:
    "Searches and retrieves verified facts, policies, SOPs, manuals, and document excerpts from authorized attachments and Knowledge Base. Use when external or document knowledge is needed. Do NOT use for pure math or text transformations.",
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description: "The targeted semantic or keyword query to search for.",
      },
      chatId: {
        type: "string",
        description: "Optional chat session ID to search chat-scoped attachments.",
      },
      userId: {
        type: "string",
        description: "Optional user ID for access-controlled resource search.",
      },
      workspaceId: {
        type: "string",
        description: "Optional workspace ID for Knowledge Base documentation search.",
      },
      documentId: {
        type: "string",
        description: "Optional ID of a specific document to restrict search to.",
      },
      sourceScope: {
        type: "string",
        description: "Optional scope filter: 'chat', 'knowledge_base', or 'all' (default).",
      },
      limit: {
        type: "number",
        description: "Maximum number of excerpts to retrieve (default 8, max 20).",
      },
    },
    validate: (input) => {
      if (!input || typeof input !== "object") {
        return { valid: false, error: "Input must be an object." };
      }
      if (!input.query || typeof input.query !== "string" || !input.query.trim()) {
        return { valid: false, error: "Missing or empty required field 'query'." };
      }
      if (
        input.sourceScope &&
        !["chat", "knowledge_base", "all"].includes(input.sourceScope)
      ) {
        return {
          valid: false,
          error: "Field 'sourceScope' must be 'chat', 'knowledge_base', or 'all'.",
        };
      }
      return { valid: true };
    },
  },
  permissions: ["read:documents"],
  execute: async (input, context = {}) => {
    const {
      query,
      documentId,
      sourceScope = "all",
      limit = 8,
    } = input;

    // Security: Caller context provided by Agent Executor takes precedence over any tool-level parameters
    const verifiedChatId = context.chatId || input.chatId || null;
    const verifiedUserId = context.userId || input.userId || null;
    const verifiedWorkspaceId = context.workspaceId || input.workspaceId || "default";
    const effectiveDocumentId = documentId || context.documentId || null;
    const effectiveScope = sourceScope || context.sourceScope || "all";

    const cappedLimit = Math.min(Math.max(1, Number(limit) || 8), 20);

    const retrieverFn =
      typeof context.retriever === "function"
        ? context.retriever
        : executeUnifiedRetrieval;

    const retrievalResult = await retrieverFn({
      query,
      chatId: verifiedChatId,
      userId: verifiedUserId,
      workspaceId: verifiedWorkspaceId,
      documentId: effectiveDocumentId,
      sourceScope: effectiveScope,
      limit: cappedLimit,
    });

    const isArray = Array.isArray(retrievalResult);
    const content = isArray
      ? retrievalResult.map((r) => r.text || r.content || "").filter(Boolean).join("\n\n")
      : retrievalResult?.content || "";
    const rawSources = isArray
      ? retrievalResult
      : Array.isArray(retrievalResult?.sources)
        ? retrievalResult.sources
        : [];
    const rawResults = isArray
      ? retrievalResult
      : Array.isArray(retrievalResult?.results)
        ? retrievalResult.results
        : [];

    // Normalize each result into a structured chunk record
    const structuredResults = rawResults.map((r) => {
      const filename = r.filename || r.sourceName || r.title || r.name || "Document";
      const page = r.page !== undefined ? r.page : (r.pageNumber !== undefined ? r.pageNumber : 1);
      const score = typeof r.score === "number" ? r.score : (typeof r.similarity === "number" ? r.similarity : null);
      const docId = r.documentId || r.id || "doc";
      const chunkIdx = r.chunkIndex !== undefined ? r.chunkIndex : 0;
      const text = r.text || r.content || content || "";

      return {
        text,
        filename,
        sourceName: filename,
        documentId: docId,
        page,
        score,
        metadata: {
          documentId: docId,
          filename,
          page,
          chunkIndex: chunkIdx,
          source: r.source || "knowledge_base",
          ...(r.metadata || {}),
        },
      };
    });

    // Normalize sources list
    const structuredSources = rawSources.map((s) => ({
      documentId: s.documentId || s.id || null,
      filename: s.filename || s.name || "Document",
      page: s.page !== undefined ? s.page : (s.pages ? s.pages[0] : 1),
      pages: Array.isArray(s.pages) ? s.pages : (s.page !== undefined ? [s.page] : [1]),
      score: typeof s.score === "number" ? s.score : null,
    }));

    return {
      success: retrievalResult?.success !== false,
      query: retrievalResult?.query || query,
      content,
      sources: structuredSources,
      results: structuredResults,
      resultCount: structuredResults.length || structuredSources.length,
      hasContext:
        retrievalResult?.hasContext !== undefined
          ? retrievalResult.hasContext
          : Boolean(content || structuredResults.length > 0),
      ...(retrievalResult?.error ? { error: retrievalResult.error } : {}),
    };
  },
};

export default retrievalTool;
