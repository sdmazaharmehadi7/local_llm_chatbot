/**
 * Sovereign Agent Graph Service (LangGraph StateGraph Engine)
 *
 * Primary and sole agent orchestration engine for the Sovereign AI Workbench.
 *
 * GUARANTEES:
 * - Powered by LangGraph StateGraph (Annotation.Root, nodes, edges, cycle control).
 * - Connected directly to local Qwen3:8b via local Ollama (http://localhost:11434).
 * - Zero external dependencies, cloud models, or external telemetry (LANGCHAIN_TRACING_V2=false).
 * - Enforces minimum-tool policy and strict tool selection rules.
 * - Step limits, execution limits, and stuck loop protection.
 * - Emits real-time progress events for UI compatibility.
 */

import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import {
  AGENT_STATUS,
  AGENT_ACTION_TYPES,
  AGENT_LIMITS,
} from "./agent.types.js";
import { createAgentTools } from "./agentTools.js";
import { sendChatToOllama } from "../ollama.service.js";
import {
  parseBrainOutput,
  validateToolSelectionPolicy,
  formatAvailableTools,
  formatStepHistory,
  AGENT_BRAIN_SYSTEM_PROMPT,
} from "./qwenBrain.service.js";

// Disable LangChain tracing/telemetry globally
if (typeof process !== "undefined" && process.env) {
  process.env.LANGCHAIN_TRACING_V2 = "false";
}

/**
 * LangGraph State Annotation Schema
 */
export const AgentStateAnnotation = Annotation.Root({
  taskId: Annotation({ reducer: (_, y) => y, default: () => "" }),
  userId: Annotation({ reducer: (_, y) => y, default: () => "user-local-admin" }),
  chatId: Annotation({ reducer: (_, y) => y, default: () => null }),
  workspaceId: Annotation({ reducer: (_, y) => y, default: () => "default" }),
  userRequest: Annotation({ reducer: (_, y) => y, default: () => "" }),
  conversationHistory: Annotation({ reducer: (_, y) => y, default: () => [] }),
  steps: Annotation({ reducer: (x, y) => x.concat(y), default: () => [] }),
  toolExecutionCount: Annotation({ reducer: (_, y) => y, default: () => 0 }),
  status: Annotation({ reducer: (_, y) => y, default: () => AGENT_STATUS.PLANNING }),
  currentAction: Annotation({ reducer: (_, y) => y, default: () => null }),
  finalResponse: Annotation({ reducer: (_, y) => y, default: () => "" }),
  error: Annotation({ reducer: (_, y) => y, default: () => null }),
});

class AgentGraphService {
  constructor() {
    this.brainLlmClient = null; // Testing hook for offline mock inference
    this.coderLlmClient = null; // Testing hook for offline coding mock inference
  }

  setAgentBrainLlmClient(clientFn) {
    this.brainLlmClient = clientFn;
  }

  resetAgentBrainLlmClient() {
    this.brainLlmClient = null;
  }

  setCoderLlmClient(clientFn) {
    this.coderLlmClient = clientFn;
  }

  resetCoderLlmClient() {
    this.coderLlmClient = null;
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
    const { onProgress, retriever, coderClient, signal } = runnerOptions;
    const effectiveCoderClient = coderClient || this.coderLlmClient;

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
      if (signal && signal.aborted) {
        emit({
          status: "cancelled",
          message: "Agent task stopped by user.",
        });
        return {
          status: AGENT_STATUS.CANCELLED,
          finalResponse: "Agent task stopped by user.",
          currentAction: { action: "final", answer: "Agent task stopped by user." },
        };
      }

      if (state.steps.length >= AGENT_LIMITS.MAX_AGENT_STEPS) {
        const errMsg = `Maximum steps reached: LangGraph execution limit exceeded (${AGENT_LIMITS.MAX_AGENT_STEPS} steps).`;
        emit({ status: "error", error: errMsg });
        return {
          status: AGENT_STATUS.FAILED,
          error: errMsg,
          currentAction: { action: "error", reason: errMsg },
        };
      }

      emit({
        status: "planning",
        message: state.steps.length === 0 ? "Analysing your question..." : "Planning next step...",
        reason: "Evaluating required actions...",
      });

      const tools = createAgentTools({
        userId: state.userId,
        chatId: state.chatId,
        workspaceId: state.workspaceId,
        retriever,
        coderClient: effectiveCoderClient,
      });

      const formattedTools = formatAvailableTools(
        tools.map((t) => {
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

Current Step: ${state.steps.length + 1} of ${AGENT_LIMITS.MAX_AGENT_STEPS}

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
          status: AGENT_STATUS.FAILED,
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
          // retry failed, use original error
        }
      }

      if (!parsed.valid) {
        const errMsg = `Brain output invalid: ${parsed.error}`;
        emit({ status: "error", error: errMsg });
        return {
          status: AGENT_STATUS.FAILED,
          error: errMsg,
          currentAction: { action: "error", reason: errMsg },
        };
      }

      const decision = parsed.decision;

      // Validate tool selection policy against unneeded tool calls
      const policyValidation = validateToolSelectionPolicy(decision, {
        userRequest: state.userRequest,
        steps: state.steps,
      });

      if (!policyValidation.valid) {
        console.warn(`[agentGraph] Tool selection policy rejection: ${policyValidation.reason}`);
        const safeFinalAction = {
          action: AGENT_ACTION_TYPES.FINAL,
          type: AGENT_ACTION_TYPES.FINAL,
          answer: decision.answer || `Cannot execute tool: ${policyValidation.reason}`,
          reason: policyValidation.reason,
        };
        emit({
          status: "preparing_answer",
          message: "Generating response...",
          reason: policyValidation.reason,
        });
        return {
          status: AGENT_STATUS.COMPLETED,
          finalResponse: safeFinalAction.answer,
          currentAction: safeFinalAction,
        };
      }

      if (decision.action === AGENT_ACTION_TYPES.FINAL) {
        emit({
          status: "preparing_answer",
          message: "Generating response...",
          reason: decision.reason || "Synthesizing final answer...",
        });
        return {
          status: AGENT_STATUS.COMPLETED,
          finalResponse: decision.answer || decision.response || "Task completed.",
          currentAction: decision,
        };
      }

      return {
        status: AGENT_STATUS.EXECUTING,
        currentAction: decision,
      };
    };

    /**
     * LangGraph Tools Node
     */
    const toolsNode = async (state) => {
      const decision = state.currentAction;
      const toolName = decision?.tool || decision?.toolName;

      if (state.toolExecutionCount >= AGENT_LIMITS.MAX_TOOL_EXECUTIONS) {
        const errMsg = `Execution limit exceeded: maximum allowed tool executions (${AGENT_LIMITS.MAX_TOOL_EXECUTIONS}) reached.`;
        emit({ status: "error", error: errMsg });
        return {
          status: AGENT_STATUS.FAILED,
          error: errMsg,
          currentAction: { action: "error", reason: errMsg },
        };
      }

      // Check stuck loop protection (consecutive identical tool calls)
      const actionFingerprint = `${toolName}:::${JSON.stringify(decision.input || {})}`;
      const recentSteps = state.steps.slice(-AGENT_LIMITS.MAX_CONSECUTIVE_IDENTICAL_ACTIONS);
      if (
        recentSteps.length >= AGENT_LIMITS.MAX_CONSECUTIVE_IDENTICAL_ACTIONS &&
        recentSteps.every(
          (s) => `${s.tool}:::${JSON.stringify(s.input || {})}` === actionFingerprint
        )
      ) {
        const errMsg = `Agent stuck: detected repeated identical action for tool "${toolName}". Execution stopped safely.`;
        emit({ status: "error", error: errMsg });
        return {
          status: AGENT_STATUS.FAILED,
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
          : toolName === "coding"
          ? "🔧 Invoking Qwen2.5-Coder..."
          : `🔧 Using ${toolName}...`;

      emit({
        status: "tool",
        tool: toolName,
        message: toolActionMsg,
        reason: decision.reason || toolActionMsg,
      });

      const tools = createAgentTools({
        userId: state.userId,
        chatId: state.chatId,
        workspaceId: state.workspaceId,
        retriever,
        coderClient: effectiveCoderClient,
      });

      const matchedTool = tools.find((t) => t.name === toolName);
      const startTime = Date.now();
      let stepRecord;

      if (!matchedTool) {
        const errMsg = `Unknown tool: "${toolName}" is not registered in the catalog.`;
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
              : toolName === "coding"
              ? "✓ Code generated by Qwen2.5-Coder"
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
        status: AGENT_STATUS.PLANNING,
      };
    };

    /**
     * LangGraph Conditional Edge
     */
    const shouldContinue = (state) => {
      if (
        state.status === AGENT_STATUS.COMPLETED ||
        state.status === AGENT_STATUS.FAILED ||
        state.status === AGENT_STATUS.CANCELLED ||
        state.error
      ) {
        return "end";
      }

      const action = state.currentAction?.action;
      if (action === AGENT_ACTION_TYPES.TOOL) {
        return "tools";
      }

      return "end";
    };

    const workflow = new StateGraph(AgentStateAnnotation)
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

export const agentGraphService = new AgentGraphService();
export default agentGraphService;
