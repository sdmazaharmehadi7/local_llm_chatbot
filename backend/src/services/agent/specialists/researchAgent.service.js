/**
 * Research Agent Specialist
 *
 * Responsible for:
 * - Knowledge Base retrieval
 * - Document retrieval & search
 * - Evidence extraction & citation attribution
 * - Document-focused reasoning
 *
 * Integrates with existing Unified Retrieval Service.
 * Restricted to research/retrieval domain; reports directly to Supervisor.
 */

import { executeUnifiedRetrieval } from "../../unifiedRetrieval.service.js";

export class ResearchAgentService {
  /**
   * Execute research / retrieval task delegated by Supervisor.
   *
   * @param {object} params
   * @param {string} params.query - Search query / topic
   * @param {string} [params.sourceScope="all"] - 'chat', 'knowledge_base', or 'all'
   * @param {string} [params.userId] - User ID for access control
   * @param {string} [params.chatId] - Chat ID for attachment access
   * @param {string} [params.workspaceId] - Workspace ID
   * @param {Function} [params.retriever] - Optional mock retriever
   * @returns {Promise<{
   *   success: boolean,
   *   agent: string,
   *   query: string,
   *   results: Array<object>,
   *   sources: Array<object>,
   *   content: string,
   *   error?: string
   * }>}
   */
  async executeResearch(params = {}) {
    const {
      query,
      sourceScope = "all",
      userId,
      chatId,
      workspaceId = "default",
      documentId,
      retriever,
      limit = 8,
    } = params;

    if (!query || typeof query !== "string" || !query.trim()) {
      return {
        success: false,
        agent: "Research Agent",
        error: "Missing required parameter 'query'.",
        results: [],
        sources: [],
        content: "",
      };
    }

    const startIso = new Date().toISOString();
    console.log(`\n[${startIso}] [Research Agent] Executing retrieval for: "${query.trim()}"`);

    const retrieverFn = typeof retriever === "function" ? retriever : executeUnifiedRetrieval;
    const startTime = Date.now();

    try {
      const retrievalResult = await retrieverFn({
        query: query.trim(),
        userId,
        chatId,
        workspaceId,
        documentId,
        sourceScope,
        limit,
      });

      const results = Array.isArray(retrievalResult?.results) ? retrievalResult.results : [];
      const sources = Array.isArray(retrievalResult?.sources) ? retrievalResult.sources : [];
      const content = retrievalResult?.content || "";

      const endIso = new Date().toISOString();
      console.log(`[${endIso}] [Research Agent] Completed: retrieved ${results.length || sources.length} evidence excerpts (${Date.now() - startTime}ms)`);

      return {
        success: true,
        agent: "Research Agent",
        query: query.trim(),
        results,
        sources,
        content,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err) {
      console.warn(`[Research Agent] Retrieval error:`, err.message);
      return {
        success: false,
        agent: "Research Agent",
        query: query.trim(),
        error: err.message,
        results: [],
        sources: [],
        content: "",
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
}

export const researchAgentService = new ResearchAgentService();
export default researchAgentService;
