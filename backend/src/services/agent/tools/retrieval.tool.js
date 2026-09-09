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
  description:
    "Retrieves relevant information, verified facts, and document excerpts from authorized chat attachments and sovereign Knowledge Base documentation.",
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

    const content = retrievalResult?.content || "";
    const sources = Array.isArray(retrievalResult?.sources) ? retrievalResult.sources : [];
    const results = Array.isArray(retrievalResult?.results) ? retrievalResult.results : [];

    return {
      success: retrievalResult?.success !== false,
      query: retrievalResult?.query || query,
      content,
      sources,
      results,
      resultCount: results.length || sources.length,
      hasContext:
        retrievalResult?.hasContext !== undefined
          ? retrievalResult.hasContext
          : Boolean(content || results.length > 0),
      ...(retrievalResult?.error ? { error: retrievalResult.error } : {}),
    };
  },
};

export default retrievalTool;
