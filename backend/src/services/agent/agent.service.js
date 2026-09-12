/**
 * Sovereign Agent Service (LangGraph Orchestrator)
 *
 * Core agent orchestrator powered solely by LangGraph JS.
 * - Coordinates task execution via LangGraph StateGraph
 * - Manages chat-scoped context retrieval from MongoDB
 * - Delivers streaming SSE progress events and final answer chunks
 * - Enforces deterministic, bounded, and sovereign local execution
 */

import crypto from "crypto";
import { agentGraphService } from "./agentGraph.service.js";
import { AGENT_STATUS } from "./agent.types.js";
import Message from "../../models/Message.js";
import { streamChatFromOllama } from "../ollama.service.js";

/**
 * Execute an Agent task end-to-end using the LangGraph engine.
 *
 * @param {object} params
 * @param {string} params.message - User prompt
 * @param {string} [params.taskId] - Unique task identifier
 * @param {string} [params.userId="user-local-admin"] - Authenticated user identifier
 * @param {string} [params.chatId=null] - Associated chat session ID
 * @param {string} [params.workspaceId="default"] - Active workspace ID
 * @param {object} [params.options={}] - Custom configuration / callbacks (onProgress, onChunk, signal, retriever)
 * @returns {Promise<{
 *   success: boolean,
 *   taskId: string,
 *   status: string,
 *   response: string,
 *   steps: Array<object>,
 *   events: Array<object>,
 *   executionTimeMs: number,
 *   error?: string
 * }>}
 */
export async function runAgentTask({
  message,
  taskId = crypto.randomUUID(),
  userId = "user-local-admin",
  chatId = null,
  workspaceId = "default",
  options = {},
}) {
  const startTime = Date.now();

  if (!message || typeof message !== "string" || !message.trim()) {
    throw new Error("Task message is required.");
  }

  // Load chat session conversation history from MongoDB
  let conversationHistory = [];
  if (chatId) {
    try {
      if (Message && Message.db && Message.db.readyState === 1) {
        const historyDocs = await Message.find({ chatId })
          .sort({ createdAt: -1 })
          .limit(10)
          .lean();
        conversationHistory = historyDocs.reverse().map((m) => ({
          role: m.role,
          content: m.content,
        }));
      }
    } catch (err) {
      console.warn(`[agent.service] Notice: Could not load chat history for ${chatId}:`, err.message);
    }
  }

  console.log(`[agent] LangGraph task started: ${taskId}`);

  const progressEvents = [];
  const emitProgress = (event) => {
    const fullEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };
    progressEvents.push(fullEvent);
    if (typeof options.onProgress === "function") {
      try {
        options.onProgress(fullEvent);
      } catch (err) {
        console.warn("[agent.service] Error in onProgress callback:", err.message);
      }
    }
  };

  // Build the compiled LangGraph workflow
  const app = agentGraphService.buildGraph({
    onProgress: emitProgress,
    retriever: options.retriever,
    coderClient: options.coderClient,
    signal: options.signal,
  });

  let finalGraphState;
  try {
    finalGraphState = await app.invoke({
      taskId,
      userId,
      chatId,
      workspaceId,
      userRequest: message.trim(),
      conversationHistory,
      steps: [],
      toolExecutionCount: 0,
      status: AGENT_STATUS.PLANNING,
      currentAction: null,
      finalResponse: "",
      error: null,
    });
  } catch (graphErr) {
    console.error(`[agent.service] Error during LangGraph execution:`, graphErr);
    return {
      success: false,
      taskId,
      status: "failed",
      response: "",
      steps: [],
      events: progressEvents,
      executionTimeMs: Date.now() - startTime,
      error: graphErr.message,
    };
  }

  let finalAnswer = finalGraphState.finalResponse || "";

  // Aggregate retrieved document sources across steps
  const extractedSources = [];
  const seenSourceKeys = new Set();
  for (const step of finalGraphState.steps || []) {
    const isRetrieval = step.toolName === "retrieve_information" || step.tool === "retrieve_information";
    if (isRetrieval) {
      const obs = step.observation || {};
      const sourcesList = Array.isArray(obs.sources)
        ? obs.sources
        : (Array.isArray(obs.results) ? obs.results : []);

      for (const src of sourcesList) {
        const docId = src.documentId || src.id || src.filename;
        const page = src.page !== undefined ? src.page : (src.pages ? src.pages[0] : 1);
        const key = `${docId}:::${page}`;
        if (!seenSourceKeys.has(key)) {
          seenSourceKeys.add(key);
          extractedSources.push({
            documentId: src.documentId || src.id || "doc",
            filename: src.filename || src.sourceName || "Document",
            page,
            pages: Array.isArray(src.pages) ? src.pages : [page],
            score: typeof src.score === "number" ? src.score : null,
          });
        }
      }
    }
  }

  // Stream answer chunks if requested and answer is available
  const isStreamingRequested = typeof options.onChunk === "function";
  if (isStreamingRequested && finalAnswer) {
    const isMockBrain = typeof agentGraphService.brainLlmClient === "function";
    if (!isMockBrain) {
      try {
        const retrievalSteps = (finalGraphState.steps || []).filter(
          (s) => s.toolName === "retrieve_information" || s.tool === "retrieve_information"
        );
        const otherSteps = (finalGraphState.steps || []).filter(
          (s) => s.toolName !== "retrieve_information" && s.tool !== "retrieve_information"
        );

        const promptSections = [];
        if (retrievalSteps.length > 0) {
          const documentContext = retrievalSteps
            .map((s) => s.observation?.content || JSON.stringify(s.observation?.results || []))
            .join("\n\n");
          promptSections.push(`Retrieved Document Excerpts:\n${documentContext}`);
        }

        if (otherSteps.length > 0) {
          const toolResults = otherSteps
            .map((s, idx) => {
              const name = s.toolName || s.tool;
              const inputStr = s.input?.expression || s.input?.task || JSON.stringify(s.input || {});
              const val =
                s.observation?.value !== undefined
                  ? s.observation.value
                  : (s.observation?.result !== undefined
                  ? s.observation.result
                  : JSON.stringify(s.observation || ""));
              return `Tool ${idx + 1} (${name}): Input: ${inputStr} -> Result: ${val}`;
            })
            .join("\n");
          promptSections.push(`Tool Execution & Calculation Results:\n${toolResults}`);
        }

        if (finalAnswer) {
          promptSections.push(`Agent Findings & Solution:\n${finalAnswer}`);
        }

        let streamPrompt;
        if (promptSections.length > 0) {
          streamPrompt = `You are Sovereign Agent. Deliver a direct, well-structured, and complete final answer to the user based on the findings below.
Cite document titles, section/page numbers, and calculation formulas clearly.

User Question: "${message}"

${promptSections.join("\n\n")}

Provide the complete final answer.`;
        } else {
          streamPrompt = `You are Sovereign Agent. Provide a direct and complete answer to the user's question:
User Question: "${message}"`;
        }

        const { stream: ollamaStream } = await streamChatFromOllama(
          [{ role: "user", content: streamPrompt }],
          options.signal || null,
          "qwen3:8b",
          { think: false }
        );

        const reader = ollamaStream.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamedAnswer = "";

        while (true) {
          if (options.signal && options.signal.aborted) {
            reader.cancel().catch(() => {});
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            let chunk;
            try {
              chunk = JSON.parse(trimmed);
            } catch {
              continue;
            }
            if (chunk?.message?.thinking) continue;
            const token = chunk?.message?.content || "";
            if (token) {
              const cleanToken = token.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<\/?think>/g, "");
              if (cleanToken) {
                streamedAnswer += cleanToken;
                options.onChunk({ text: cleanToken });
              }
            }
          }
        }
        if (streamedAnswer.trim()) {
          finalAnswer = streamedAnswer;
        }
      } catch (streamErr) {
        console.warn("[agent.service] Streaming final answer from Ollama failed, falling back to buffered answer:", streamErr.message);
        options.onChunk({ text: finalAnswer });
      }
    } else {
      options.onChunk({ text: finalAnswer });
    }
  }

  const isSuccess =
    finalGraphState.status === AGENT_STATUS.COMPLETED &&
    !finalGraphState.error;

  if (isSuccess) {
    emitProgress({
      status: "completed",
      message: "Response ready",
    });
  }

  const totalExecutionTimeMs = Date.now() - startTime;
  console.log(`[agent] LangGraph task finished: ${taskId} (${isSuccess ? "COMPLETED" : "FAILED"})`);

  const structuredState = {
    user_query: message.trim(),
    messages: conversationHistory,
    tool_results: (finalGraphState.steps || []).map((s) => s.observation),
    retrieved_facts: finalGraphState.retrievedFacts || [],
    completed_steps: (finalGraphState.steps || []).map((s) => ({
      tool: s.toolName || s.tool,
      input: s.input,
      observation: s.observation,
      status: s.status,
    })),
    remaining_information: finalGraphState.remainingInformation || [],
    iteration_count: (finalGraphState.steps || []).length,
  };

  return {
    success: isSuccess,
    taskId,
    status: isSuccess ? "completed" : "failed",
    response: finalAnswer,
    steps: finalGraphState.steps || [],
    sources: extractedSources,
    ragSources: extractedSources,
    events: progressEvents,
    executionTimeMs: totalExecutionTimeMs,
    state: structuredState,
    ...(finalGraphState.error ? { error: finalGraphState.error } : {}),
  };
}

export default {
  runAgentTask,
};
