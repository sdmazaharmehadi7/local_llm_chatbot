/**
 * Framework Graph Service (LangGraph StateGraph)
 *
 * Implements the experimental Agent orchestration layer using LangGraph JS.
 *
 * GUARANTEES & PRINCIPLES:
 * - Powered by LangGraph StateGraph (Annotation.Root, nodes, edges, cycle control).
 * - Connected directly to local Qwen3:8b via local Ollama (http://localhost:11434).
 * - Zero external dependencies, cloud models, or external telemetry.
 * - Enforces minimum-tool policy and strict tool selection rules.
 * - Step limits, execution limits, and stuck loop protection.
 * - Emits real-time progress events for UI compatibility.
 */

import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import {
  FRAMEWORK_AGENT_STATUS,
  FRAMEWORK_ACTION_TYPES,
  FRAMEWORK_AGENT_LIMITS,
} from "./frameworkAgent.types.js";
import { createFrameworkTools } from "./frameworkTools.js";
import { sendChatToOllama } from "../../ollama.service.js";
import {
  parseBrainOutput,
  validateToolSelectionPolicy,
  formatAvailableTools,
  formatStepHistory,
  AGENT_BRAIN_SYSTEM_PROMPT,
} from "../qwenBrain.service.js";

// Disable LangChain tracing/telemetry globally
if (typeof process !== "undefined" && process.env) {
  process.env.LANGCHAIN_TRACING_V2 = "false";
}

/**
 * LangGraph State Annotation Schema
 */
export const FrameworkStateAnnotation = Annotation.Root({
  taskId: Annotation({ reducer: (_, y) => y, default: () => "" }),
  userId: Annotation({ reducer: (_, y) => y, default: () => "user-local-admin" }),
  chatId: Annotation({ reducer: (_, y) => y, default: () => null }),
  workspaceId: Annotation({ reducer: (_, y) => y, default: () => "default" }),
  userRequest: Annotation({ reducer: (_, y) => y, default: () => "" }),
  conversationHistory: Annotation({ reducer: (_, y) => y, default: () => [] }),
  steps: Annotation({ reducer: (x, y) => x.concat(y), default: () => [] }),
  toolExecutionCount: Annotation({ reducer: (_, y) => y, default: () => 0 }),
  status: Annotation({ reducer: (_, y) => y, default: () => FRAMEWORK_AGENT_STATUS.PLANNING }),
  currentAction: Annotation({ reducer: (_, y) => y, default: () => null }),
  finalResponse: Annotation({ reducer: (_, y) => y, default: () => "" }),
  error: Annotation({ reducer: (_, y) => y, default: () => null }),
});

class FrameworkGraphService {
  constructor() {
    this.brainLlmClient = null; // Testing hook for offline mock inference
  }

  setFrameworkBrainLlmClient(clientFn) {
    this.brainLlmClient = clientFn;
  }

  resetFrameworkBrainLlmClient() {
    this.brainLlmClient = null;
  }

  /**
   * Calls the local Ollama service (or test mock)
   */
  async _callBrainLlm(messages) {
    if (typeof this.brainLlmClient === "function") {
      return this.brainLlmClient(messages);
    }

    return sendChatToOllama(messages, "qwen3:8b", {
      format: "json",
      think: false,
      options: {
        temperature: 0.1,
        num_predict: 2048,
        think: false,
      },
      timeoutMs: 120_000,
    });
  }

  /**
   * Compiles and returns an executable LangGraph StateGraph instance.
   *
   * @param {object} [runnerOptions={}]
   * @param {Function} [runnerOptions.onProgress]
   * @param {Function} [runnerOptions.retriever]
   * @param {AbortSignal} [runnerOptions.signal]
   * @returns {object} Compiled LangGraph Runnable
   */
  buildGraph(runnerOptions = {}) {
    const { onProgress, retriever, signal } = runnerOptions;

    const emit = (event) => {
      if (typeof onProgress === "function") {
        try {
          onProgress({ ...event, timestamp: new Date().toISOString() });
        } catch {
          // ignore callback error
        }
      }
    };

    /**
     * LangGraph Reasoner Node
     */
    const reasonerNode = async (state) => {
      // Check abort signal
      if (signal && signal.aborted) {
        emit({
          status: "cancelled",
          message: "Agent task stopped by user.",
        });
        return {
          status: FRAMEWORK_AGENT_STATUS.CANCELLED,
          finalResponse: "Agent task stopped by user.",
          currentAction: { action: "final", answer: "Agent task stopped by user." },
        };
      }

      // Check graph steps limit
      if (state.steps.length >= FRAMEWORK_AGENT_LIMITS.MAX_GRAPH_STEPS) {
        const errMsg = `Maximum steps reached: LangGraph execution limit exceeded (${FRAMEWORK_AGENT_LIMITS.MAX_GRAPH_STEPS} steps).`;
        emit({ status: "error", error: errMsg });
        return {
          status: FRAMEWORK_AGENT_STATUS.FAILED,
          error: errMsg,
          currentAction: { action: "error", reason: errMsg },
        };
      }

      emit({
        status: "planning",
        message: state.steps.length === 0 ? "Analysing your question with LangGraph..." : "Planning next step...",
        reason: "Evaluating required actions...",
      });

      // Context-bound tools
      const frameworkTools = createFrameworkTools({
        userId: state.userId,
        chatId: state.chatId,
        workspaceId: state.workspaceId,
        retriever,
      });

      const formattedTools = formatAvailableTools(
        frameworkTools.map((t) => {
          const shape =
            t.schema?.shape ||
            (typeof t.schema?._def?.shape === "function" ? t.schema._def.shape() : t.schema?._def?.shape) ||
            {};
          const properties = Object.fromEntries(
            Object.entries(shape).map(([k, v]) => [
              k,
              { description: v?.description || "" },
            ])
          );
          return {
            name: t.name,
            description: t.description,
            inputSchema: { properties },
          };
        })
      );


      const formattedHistory = formatStepHistory(state.steps);

      const promptContent = `User Request: "${state.userRequest}"

Available Tools:
${formattedTools}

Previous Execution Steps & Observations:
${formattedHistory}

Current Step: ${state.steps.length + 1} of ${FRAMEWORK_AGENT_LIMITS.MAX_GRAPH_STEPS}

Decide the next action now. Remember the strict tool selection rules:
- Minimal tool usage: return "final" if answerable directly.
- Calculator: ONLY for explicit arithmetic computation.
- Text transform: ONLY for explicit string transformation operations.
- Retrieval: ONLY for document, manual, SOP, or policy questions.
- Multi-step: When documents contain numbers that require calculation, retrieve first, then calculate.

Return ONLY a valid JSON object matching the Response Schema.`;

      const messages = [
        { role: "system", content: AGENT_BRAIN_SYSTEM_PROMPT },
        ...(state.conversationHistory || []).map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: promptContent },
      ];

      let rawOutput;
      try {
        rawOutput = await this._callBrainLlm(messages);
      } catch (llmErr) {
        const errMsg = `Brain inference error: ${llmErr.message}`;
        emit({ status: "error", error: errMsg });
        return {
          status: FRAMEWORK_AGENT_STATUS.FAILED,
          error: errMsg,
          currentAction: { action: "error", reason: errMsg },
        };
      }

      let parsed = parseBrainOutput(rawOutput);

      // Single-turn self-correction retry on malformed JSON
      if (!parsed.valid) {
        try {
          const retryMessages = [
            ...messages,
            { role: "assistant", content: rawOutput || "" },
            {
              role: "user",
              content: `Your previous response was not valid JSON (${parsed.error}). Please output ONLY the raw valid JSON object.`,
            },
          ];
          const retryOutput = await this._callBrainLlm(retryMessages);
          parsed = parseBrainOutput(retryOutput);
        } catch {
          // retry failed, use original parsed error
        }
      }

      if (!parsed.valid) {
        const errMsg = `Brain output invalid: ${parsed.error}`;
        emit({ status: "error", error: errMsg });
        return {
          status: FRAMEWORK_AGENT_STATUS.FAILED,
          error: errMsg,
          currentAction: { action: "error", reason: errMsg },
        };
      }

      const decision = parsed.decision;

      // Validate tool selection policy (rules against unnecessary calculator/retrieval/transform)
      const policyValidation = validateToolSelectionPolicy(decision, {
        userRequest: state.userRequest,
        steps: state.steps,
      });

      if (!policyValidation.valid) {
        console.warn(`[frameworkGraph] Tool selection policy rejection: ${policyValidation.reason}`);
        // Safely redirect to final answer instead of running unneeded tool
        const safeFinalAction = {
          action: FRAMEWORK_ACTION_TYPES.FINAL,
          type: FRAMEWORK_ACTION_TYPES.FINAL,
          answer: decision.answer || `Cannot execute tool: ${policyValidation.reason}`,
          reason: policyValidation.reason,
        };
        emit({
          status: "preparing_answer",
          message: "Generating response...",
          reason: policyValidation.reason,
        });
        return {
          status: FRAMEWORK_AGENT_STATUS.COMPLETED,
          finalResponse: safeFinalAction.answer,
          currentAction: safeFinalAction,
        };
      }

      // If final action
      if (decision.action === FRAMEWORK_ACTION_TYPES.FINAL) {
        emit({
          status: "preparing_answer",
          message: "Generating response...",
          reason: decision.reason || "Synthesizing final answer...",
        });
        return {
          status: FRAMEWORK_AGENT_STATUS.COMPLETED,
          finalResponse: decision.answer || decision.response || "Task completed.",
          currentAction: decision,
        };
      }

      // If tool action
      return {
        status: FRAMEWORK_AGENT_STATUS.EXECUTING,
        currentAction: decision,
      };
    };

    /**
     * LangGraph Tools Node
     */
    const toolsNode = async (state) => {
      const decision = state.currentAction;
      const toolName = decision?.tool || decision?.toolName;

      // Tool execution limit check
      if (state.toolExecutionCount >= FRAMEWORK_AGENT_LIMITS.MAX_TOOL_EXECUTIONS) {
        const errMsg = `Execution limit exceeded: maximum allowed tool executions (${FRAMEWORK_AGENT_LIMITS.MAX_TOOL_EXECUTIONS}) reached.`;
        emit({ status: "error", error: errMsg });
        return {
          status: FRAMEWORK_AGENT_STATUS.FAILED,
          error: errMsg,
          currentAction: { action: "error", reason: errMsg },
        };
      }

      // Check stuck loop protection (consecutive identical tool calls)
      const actionFingerprint = `${toolName}:::${JSON.stringify(decision.input || {})}`;
      const recentSteps = state.steps.slice(-FRAMEWORK_AGENT_LIMITS.MAX_CONSECUTIVE_IDENTICAL_ACTIONS);
      if (
        recentSteps.length >= FRAMEWORK_AGENT_LIMITS.MAX_CONSECUTIVE_IDENTICAL_ACTIONS &&
        recentSteps.every(
          (s) => `${s.tool}:::${JSON.stringify(s.input || {})}` === actionFingerprint
        )
      ) {
        const errMsg = `Agent stuck: detected repeated identical action for tool "${toolName}". Execution stopped safely.`;
        emit({ status: "error", error: errMsg });
        return {
          status: FRAMEWORK_AGENT_STATUS.FAILED,
          error: errMsg,
          currentAction: { action: "error", reason: errMsg },
        };
      }

      const toolActionMsg =
        toolName === "retrieve_information"
          ? "🔧 Searching knowledge base..."
          : toolName === "calculator"
          ? "🔧 Calling calculator..."
          : toolName === "text_transform"
          ? "🔧 Transforming text..."
          : `🔧 Using ${toolName}...`;

      emit({
        status: "tool",
        tool: toolName,
        message: toolActionMsg,
        reason: decision.reason || toolActionMsg,
      });

      const frameworkTools = createFrameworkTools({
        userId: state.userId,
        chatId: state.chatId,
        workspaceId: state.workspaceId,
        retriever,
      });

      const matchedTool = frameworkTools.find((t) => t.name === toolName);
      const startTime = Date.now();
      let stepRecord;

      if (!matchedTool) {
        const errMsg = `Unknown tool: "${toolName}" is not registered in the framework catalog.`;
        emit({
          status: "tool_complete",
          tool: toolName,
          success: false,
          message: `✗ Tool "${toolName}" not found.`,
        });
        stepRecord = {
          type: "tool",
          action: "tool",
          tool: toolName,
          toolName,
          reason: decision.reason,
          input: decision.input,
          observation: { error: errMsg },
          status: "failed",
          executionTimeMs: Date.now() - startTime,
        };
      } else {
        try {
          const rawResultStr = await matchedTool.invoke(decision.input || {});
          let parsedResult;
          try {
            parsedResult = JSON.parse(rawResultStr);
          } catch {
            parsedResult = rawResultStr;
          }

          const isSuccess =
            typeof parsedResult === "object" && parsedResult !== null
              ? parsedResult.success !== false
              : true;

          const toolDoneMsg = isSuccess
            ? toolName === "retrieve_information"
              ? "✓ Knowledge retrieved"
              : toolName === "calculator"
              ? "✓ Calculation completed"
              : toolName === "text_transform"
              ? "✓ Text transformed"
              : "✓ Tool completed"
            : `✗ Tool "${toolName}" failed`;

          emit({
            status: "tool_complete",
            tool: toolName,
            success: isSuccess,
            message: toolDoneMsg,
          });

          emit({
            status: "analyzing",
            tool: toolName,
            message: "Analysing result...",
            reason: `Evaluating output from ${toolName}...`,
          });

          stepRecord = {
            type: "tool",
            action: "tool",
            tool: toolName,
            toolName,
            reason: decision.reason,
            input: decision.input,
            output: parsedResult,
            observation: parsedResult,
            status: isSuccess ? "completed" : "failed",
            executionTimeMs: Date.now() - startTime,
          };
        } catch (execErr) {
          emit({
            status: "tool_complete",
            tool: toolName,
            success: false,
            message: `✗ Tool "${toolName}" error: ${execErr.message}`,
          });
          stepRecord = {
            type: "tool",
            action: "tool",
            tool: toolName,
            toolName,
            reason: decision.reason,
            input: decision.input,
            observation: { error: execErr.message },
            status: "failed",
            executionTimeMs: Date.now() - startTime,
          };
        }
      }

      return {
        steps: [stepRecord],
        toolExecutionCount: state.toolExecutionCount + 1,
        status: FRAMEWORK_AGENT_STATUS.PLANNING,
      };
    };

    /**
     * LangGraph Conditional Routing Function
     */
    const shouldContinue = (state) => {
      if (
        state.status === FRAMEWORK_AGENT_STATUS.COMPLETED ||
        state.status === FRAMEWORK_AGENT_STATUS.FAILED ||
        state.status === FRAMEWORK_AGENT_STATUS.CANCELLED ||
        state.error
      ) {
        return "end";
      }

      const action = state.currentAction?.action;
      if (action === FRAMEWORK_ACTION_TYPES.TOOL) {
        return "tools";
      }

      return "end";
    };

    // Construct the LangGraph StateGraph
    const workflow = new StateGraph(FrameworkStateAnnotation)
      .addNode("reasoner", reasonerNode)
      .addNode("tools", toolsNode)
      .addEdge(START, "reasoner")
      .addConditionalEdges("reasoner", shouldContinue, {
        tools: "tools",
        end: END,
      })
      .addEdge("tools", "reasoner");

    return workflow.compile();
  }
}

export const frameworkGraphService = new FrameworkGraphService();
export default frameworkGraphService;
