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

import { StateGraph, Annotation, START, END, MemorySaver } from "@langchain/langgraph";
import {
  AGENT_STATUS,
  AGENT_ACTION_TYPES,
  AGENT_LIMITS,
  WORKFLOW_TYPES,
  WORKFLOW_STATUS,
} from "./agent.types.js";
import { createAgentTools } from "./agentTools.js";
import { sendChatToOllama } from "../ollama.service.js";
import {
  parseBrainOutput,
  validateToolSelectionPolicy,
  formatAvailableTools,
  formatStepHistory,
  formatAccumulatedEvidence,
  formatReasoningState,
  AGENT_BRAIN_SYSTEM_PROMPT,
} from "./qwenBrain.service.js";

// Disable LangChain tracing/telemetry globally
if (typeof process !== "undefined" && process.env) {
  process.env.LANGCHAIN_TRACING_V2 = "false";
}

export const WORKFLOW_TOOL_BUDGETS = {
  [WORKFLOW_TYPES.KNOWLEDGE_RETRIEVAL]: 3,
  [WORKFLOW_TYPES.RETRIEVAL_CALCULATION]: 4,
  [WORKFLOW_TYPES.VISION_CALCULATION]: 4,
  [WORKFLOW_TYPES.VISION_KNOWLEDGE]: 4,
  [WORKFLOW_TYPES.CODING_SANDBOX]: 6,
  [WORKFLOW_TYPES.ENGINEERING]: 5,
  [WORKFLOW_TYPES.DATA_ANALYSIS]: 4,
  [WORKFLOW_TYPES.COMPLIANCE_CHECK]: 4,
  [WORKFLOW_TYPES.DOCUMENT_ANALYSIS]: 4,
  [WORKFLOW_TYPES.MULTI_STEP_ANALYSIS]: 10,
  [WORKFLOW_TYPES.GENERAL]: 5,
};

/**
 * Normalize an action fingerprint for stuck loop, duplicate query, and cached execution detection.
 *
 * @param {string} toolName
 * @param {object} input
 * @returns {string}
 */
export function normalizeActionFingerprint(toolName, input = {}) {
  const normTool = String(toolName || "").trim().toLowerCase();
  if (normTool === "retrieve_information") {
    const rawQuery = String(input?.query || input?.searchTerm || "").trim().toLowerCase();
    const cleanQuery = rawQuery.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    const scope = String(input?.sourceScope || "all").trim().toLowerCase();
    return `${normTool}:::query=${cleanQuery}:::scope=${scope}`;
  }
  if (normTool === "calculator") {
    const rawExpr = String(input?.expression || "").replace(/\s+/g, "").toLowerCase();
    return `${normTool}:::expr=${rawExpr}`;
  }
  if (normTool === "text_transform") {
    const op = String(input?.operation || "").trim().toLowerCase();
    const text = String(input?.text || "").trim();
    return `${normTool}:::op=${op}:::text=${text}`;
  }
  if (normTool === "coding") {
    const task = String(input?.task || "").trim().toLowerCase();
    const lang = String(input?.language || "").trim().toLowerCase();
    return `${normTool}:::task=${task}:::lang=${lang}`;
  }
  if (normTool === "execute_code") {
    const code = String(input?.code || "").trim();
    const lang = String(input?.language || "python").trim().toLowerCase();
    return `${normTool}:::lang=${lang}:::code=${code}`;
  }
  if (normTool === "vision") {
    const prompt = String(input?.prompt || "").trim().toLowerCase();
    return `${normTool}:::prompt=${prompt.slice(0, 100)}`;
  }
  if (normTool === "engineering_formula") {
    const formula = String(input?.formula || "").trim().toLowerCase();
    const params = input?.parameters || input || {};
    return `${normTool}:::formula=${formula}:::params=${JSON.stringify(params)}`;
  }
  if (normTool === "unit_conversion") {
    const from = String(input?.from_unit || input?.from || "").trim().toLowerCase();
    const to = String(input?.to_unit || input?.to || "").trim().toLowerCase();
    const val = Number(input?.value !== undefined ? input.value : input?.amount);
    return `${normTool}:::from=${from}:::to=${to}:::val=${val}`;
  }
  if (normTool === "threshold_check") {
    const val = Number(input?.value !== undefined ? input.value : input?.val);
    const lim = Number(input?.limit !== undefined ? input.limit : input?.threshold);
    const op = String(input?.operator || input?.op || ">").trim().toLowerCase();
    return `${normTool}:::val=${val}:::lim=${lim}:::op=${op}`;
  }
  if (normTool === "statistics") {
    const rawVals = input?.values || input?.data || [];
    const cleanVals = Array.isArray(rawVals) ? rawVals.map((v) => Number(v)).filter((n) => !Number.isNaN(n)) : [];
    return `${normTool}:::values=${JSON.stringify(cleanVals)}`;
  }
  if (normTool === "trend_analysis") {
    const rawVals = input?.values || input?.data || [];
    const cleanVals = Array.isArray(rawVals) ? rawVals.map((v) => Number(v)).filter((n) => !Number.isNaN(n)) : [];
    const tol = input?.tolerance_percentage !== undefined ? input.tolerance_percentage : (input?.tolerance ?? 1.0);
    return `${normTool}:::values=${JSON.stringify(cleanVals)}:::tol=${tol}`;
  }
  return `${normTool}:::${JSON.stringify(input || {})}`;
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
  conversationHistory: Annotation({ reducer: (_, y) => (Array.isArray(y) ? y : []), default: () => [] }),
  images: Annotation({ reducer: (_, y) => (Array.isArray(y) ? y : []), default: () => [] }),
  steps: Annotation({
    reducer: (x, y) => {
      // Clean reset on empty array passed at start of new task turn
      if (Array.isArray(y) && y.length === 0) return [];
      return (x || []).concat(y || []);
    },
    default: () => [],
  }),
  toolExecutionCount: Annotation({ reducer: (_, y) => y ?? 0, default: () => 0 }),
  schemaErrorCount: Annotation({ reducer: (_, y) => y ?? 0, default: () => 0 }),
  executedToolSignatures: Annotation({
    reducer: (x, y) => {
      if (y && typeof y === "object") {
        return { ...(x || {}), ...y };
      }
      return x || {};
    },
    default: () => ({}),
  }),
  status: Annotation({ reducer: (_, y) => y, default: () => AGENT_STATUS.PLANNING }),
  currentAction: Annotation({ reducer: (_, y) => y, default: () => null }),
  finalResponse: Annotation({ reducer: (_, y) => y, default: () => "" }),
  error: Annotation({ reducer: (_, y) => y, default: () => null }),
  retrievedFacts: Annotation({
    reducer: (x, y) => {
      // Clean reset on empty array passed at start of new task turn
      if (Array.isArray(y) && y.length === 0) return [];
      return Array.isArray(y) ? (x || []).concat(y) : (y ? [...(x || []), y] : (x || []));
    },
    default: () => [],
  }),
  remainingInformation: Annotation({ reducer: (_, y) => (Array.isArray(y) ? y : []), default: () => [] }),
  workflow: Annotation({
    reducer: (x, y) => {
      if (y === null) return null;
      if (!y) return x;
      const prev = x || {
        type: WORKFLOW_TYPES.GENERAL,
        status: WORKFLOW_STATUS.PENDING,
        currentStep: "",
        completedSteps: [],
        retryCount: 0,
      };
      return {
        type: y.type ?? prev.type ?? WORKFLOW_TYPES.GENERAL,
        status: y.status ?? prev.status ?? WORKFLOW_STATUS.PENDING,
        currentStep: y.currentStep !== undefined ? y.currentStep : (prev.currentStep ?? ""),
        completedSteps: Array.isArray(y.completedSteps)
          ? (y.replaceSteps ? y.completedSteps : [...(prev.completedSteps || []), ...y.completedSteps])
          : (prev.completedSteps || []),
        retryCount: typeof y.retryCount === "number" ? y.retryCount : (prev.retryCount ?? 0),
      };
    },
    default: () => ({
      type: WORKFLOW_TYPES.GENERAL,
      status: WORKFLOW_STATUS.PENDING,
      currentStep: "",
      completedSteps: [],
      retryCount: 0,
    }),
  }),
});

class AgentGraphService {
  constructor() {
    this.brainLlmClient = null; // Testing hook for offline mock inference
    this.coderLlmClient = null; // Testing hook for offline coding mock inference
    this.visionLlmClient = null; // Testing hook for offline vision mock inference
    this.checkpointer = new MemorySaver(); // LangGraph state checkpointer for thread-isolated state
  }

  getCheckpointer() {
    return this.checkpointer;
  }

  resetCheckpointer() {
    this.checkpointer = new MemorySaver();
  }

  async getCheckpointState(threadId) {
    if (!threadId) return null;
    const config = { configurable: { thread_id: String(threadId) } };
    const app = this.buildGraph();
    return app.getState(config);
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

  setVisionLlmClient(clientFn) {
    this.visionLlmClient = clientFn;
  }

  resetVisionLlmClient() {
    this.visionLlmClient = null;
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
    const { onProgress, retriever, coderClient, sandboxRunner, visionClient, signal, checkpointer } = runnerOptions;
    const effectiveCoderClient = coderClient || this.coderLlmClient;
    const effectiveVisionClient = visionClient || this.visionLlmClient;
    const effectiveCheckpointer = checkpointer !== undefined ? checkpointer : this.checkpointer;

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

      if (
        state.status === AGENT_STATUS.COMPLETED ||
        state.status === AGENT_STATUS.FAILED ||
        state.status === AGENT_STATUS.CANCELLED
      ) {
        return {
          status: state.status,
          finalResponse: state.finalResponse || "Task completed.",
          currentAction: state.currentAction || { action: AGENT_ACTION_TYPES.FINAL, answer: state.finalResponse || "Task completed." },
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
      const accumulatedEvidence = formatAccumulatedEvidence(state);
      const reasoningState = formatReasoningState(state);

      const promptContent = `User Request: "${state.userRequest}"

Available Tools:
${formattedTools}

ACCUMULATED RETRIEVED DOCUMENT EVIDENCE (KNOWLEDGE BASE & ATTACHMENTS):
---
${accumulatedEvidence}
---

Previous Execution Steps:
${formattedHistory}

Current Knowledge & Query State:
${reasoningState}

Current Step: ${state.steps.length + 1} of ${AGENT_LIMITS.MAX_AGENT_STEPS}

Decide the next action now based on the accumulated evidence and the original user request:
1. Multi-Part Question & Missing Information Check:
   - Does "${state.userRequest}" require multiple values (e.g. Value A and Limit B)?
   - What is ALREADY KNOWN from the ACCUMULATED EVIDENCE above?
   - What is STILL MISSING to answer the question?
   - If another value or limit is still needed, call "retrieve_information" with a NEW, FOCUSED query specifically for the missing item (e.g. "ISO 10816-3 Zone B/C boundary allowable limit").
   - CRITICAL: Never repeat an identical query that has already been executed!
2. Calculation Check:
   - If all required numbers are now retrieved in the accumulated evidence (e.g. measured vibration = 3.1 and allowable limit = 4.5), DO NOT retrieve again!
   - Transition immediately to "calculator" with the numerical expression (e.g. "(3.1 / 4.5) * 100").
3. Final Answer & Evaluation Check:
   - If all values are known and all computations are completed:
   - If a verification or pass/fail question was asked (e.g. "Does it pass?"), compare the calculated percentage against the allowable threshold (e.g. 68.9% <= 100% -> PASS).
   - Return "final" citing document sources, numerical values, and calculation steps.

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

      let parsed = parseBrainOutput(rawOutput, state.workflow?.type);

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
          parsed = parseBrainOutput(retryOutput, state.workflow?.type);
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

      let decision = parsed.decision;

      // Validate tool selection policy against unneeded tool calls
      let policyValidation = validateToolSelectionPolicy(decision, {
        userRequest: state.userRequest,
        steps: state.steps,
        images: state.images || [],
      });

      // Single-turn self-correction retry on policy rejection (e.g. duplicate query proposed)
      if (!policyValidation.valid) {
        try {
          const retryMessages = [
            ...messages,
            { role: "assistant", content: rawOutput || "" },
            {
              role: "user",
              content: `Policy Guidance: ${policyValidation.reason} Please output a corrected JSON action.`,
            },
          ];
          const retryOutput = await this._callBrainLlm(retryMessages);
          const retryParsed = parseBrainOutput(retryOutput, state.workflow?.type);
          if (retryParsed.valid) {
            const retryValidation = validateToolSelectionPolicy(retryParsed.decision, {
              userRequest: state.userRequest,
              steps: state.steps,
              images: state.images || [],
            });
            if (retryValidation.valid) {
              decision = retryParsed.decision;
              policyValidation = retryValidation;
            }
          }
        } catch {
          // retry failed, keep original validation
        }
      }

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

      const effectiveWorkflow =
        decision.workflow && decision.workflow !== WORKFLOW_TYPES.GENERAL
          ? decision.workflow
          : (state.workflow?.type || WORKFLOW_TYPES.GENERAL);

      if (state.steps.length === 0) {
        console.log(`\n[Agent]`);
        console.log(`Task: ${state.userRequest}`);
        console.log(`\n[Workflow]`);
        console.log(`Selected: ${effectiveWorkflow}`);
        emit({
          status: "planning",
          workflow: effectiveWorkflow,
          message: "Analysing your question...",
          reason: `Workflow selected: ${effectiveWorkflow}`,
        });
      }

      if (decision.action === AGENT_ACTION_TYPES.FINAL) {
        const finalStepNum = (state.steps.length * 2) + 1;
        console.log(`\n[Agent Step ${finalStepNum}] Model: Qwen3 / Decision: final answer`);
        console.log(`User task preserved: yes`);
        console.log(`Final answer`);
        console.log(decision.answer || decision.response || "Task completed.");
        console.log(`\n[Workflow]`);
        console.log(`Completed: ${effectiveWorkflow}`);
        emit({
          status: "preparing_answer",
          message: "Generating response...",
          reason: decision.reason || "Synthesizing final answer...",
        });
        return {
          status: AGENT_STATUS.COMPLETED,
          finalResponse: decision.answer || decision.response || "Task completed.",
          currentAction: decision,
          workflow: {
            type: effectiveWorkflow,
            status: WORKFLOW_STATUS.COMPLETED,
            currentStep: "final",
          },
        };
      }

      const isRepairDecision =
        state.steps.length > 0 &&
        (state.steps[state.steps.length - 1].toolName || state.steps[state.steps.length - 1].tool) === "execute_code" &&
        state.steps[state.steps.length - 1].status === "failed" &&
        (decision.tool || decision.toolName) === "coding";

      const decisionName = isRepairDecision
        ? "repair"
        : (decision.tool || decision.toolName);

      const reasonerStepNum = (state.steps.length * 2) + 1;
      console.log(`\n[Agent Step ${reasonerStepNum}] Model: Qwen3 / Decision: ${decisionName}${decision.reason ? ` / Reason: ${decision.reason}` : ""}`);

      return {
        status: AGENT_STATUS.EXECUTING,
        currentAction: decision,
        workflow: {
          type: effectiveWorkflow,
          status: WORKFLOW_STATUS.RUNNING,
          currentStep: decision.tool || decision.toolName,
        },
      };
    };

    /**
     * LangGraph Tools Node
     */
    const toolsNode = async (state) => {
      const decision = state.currentAction;
      const toolName = decision?.tool || decision?.toolName;

      const effectiveWorkflow =
        decision?.workflow && decision.workflow !== WORKFLOW_TYPES.GENERAL
          ? decision.workflow
          : (state.workflow?.type || WORKFLOW_TYPES.GENERAL);

      // 1. Workflow-aware tool execution budget check
      const maxWorkflowBudget = Math.max(
        WORKFLOW_TOOL_BUDGETS[effectiveWorkflow] || AGENT_LIMITS.MAX_TOOL_EXECUTIONS,
        AGENT_LIMITS.MAX_TOOL_EXECUTIONS
      );
      if (state.toolExecutionCount >= maxWorkflowBudget) {
        const errMsg = `Execution limit exceeded: Maximum ${maxWorkflowBudget} tool executions allowed.`;
        console.warn(`[agentGraph] ${errMsg}`);
        emit({ status: "error", error: errMsg });
        return {
          status: AGENT_STATUS.FAILED,
          error: errMsg,
          currentAction: { action: "error", reason: errMsg },
        };
      }

      // 2. Action Fingerprint & Tool Call Deduplication
      const actionFingerprint = normalizeActionFingerprint(toolName, decision.input);

      // Check executed tool signatures: If already succeeded, DO NOT execute again. Return cached result!
      if (state.executedToolSignatures && state.executedToolSignatures[actionFingerprint]) {
        const cachedOutput = state.executedToolSignatures[actionFingerprint];
        console.log(`\n[Agent State] Deduplicated tool call: "${toolName}" already succeeded. Reusing cached result.`);
        emit({
          status: "tool_complete",
          tool: toolName,
          success: true,
          message: `✓ Reusing previously computed result for ${toolName}`,
        });

        const stepRecord = {
          type: "tool",
          action: "tool",
          tool: toolName,
          toolName,
          reason: decision.reason,
          input: decision.input,
          output: cachedOutput,
          observation: {
            ...cachedOutput,
            cached: true,
            message: "Result already obtained in previous step. Do not repeat identical tool call. Proceed to next step or final answer.",
          },
          status: "completed",
          executionTimeMs: 0,
        };

        return {
          steps: [stepRecord],
          toolExecutionCount: state.toolExecutionCount + 1,
          status: AGENT_STATUS.PLANNING,
          workflow: {
            type: effectiveWorkflow,
            completedSteps: [toolName],
            retryCount: state.workflow?.retryCount || 0,
          },
        };
      }

      // 3. Threshold Check Limit Guard: Verify limit != undefined before calling threshold_check
      if (toolName === "threshold_check") {
        const lim = decision.input?.limit !== undefined ? decision.input?.limit : decision.input?.threshold;
        if (lim === undefined || lim === null || String(lim).trim() === "" || Number.isNaN(Number(lim))) {
          const errMsg = "Cannot check threshold: limit is undefined. State that the limit is unavailable in documentation; never invent safety limits.";
          console.warn(`[agentGraph] threshold_check rejected: limit is undefined`);
          emit({
            status: "tool_complete",
            tool: toolName,
            success: false,
            message: `✗ Tool "${toolName}" missing limit.`,
          });
          const structuredErr = {
            tool: "threshold_check",
            status: "error",
            code: "MISSING_LIMIT",
            retryable: false,
            error: errMsg,
            message: "Limit is unavailable in documentation. State that the limit is unavailable; never invent safety limits.",
          };
          const stepRecord = {
            type: "tool",
            action: "tool",
            tool: toolName,
            toolName,
            reason: decision.reason,
            input: decision.input,
            output: structuredErr,
            observation: structuredErr,
            status: "failed",
            executionTimeMs: 0,
          };
          return {
            steps: [stepRecord],
            toolExecutionCount: state.toolExecutionCount + 1,
            status: AGENT_STATUS.PLANNING,
            workflow: {
              type: effectiveWorkflow,
              completedSteps: [toolName],
              retryCount: (state.workflow?.retryCount || 0) + 1,
            },
          };
        }
      }

      // 4. Stuck loop protection (consecutive identical tool calls with normalized fingerprint)
      const recentSteps = state.steps.slice(-AGENT_LIMITS.MAX_CONSECUTIVE_IDENTICAL_ACTIONS);
      if (
        recentSteps.length >= AGENT_LIMITS.MAX_CONSECUTIVE_IDENTICAL_ACTIONS &&
        recentSteps.every(
          (s) => normalizeActionFingerprint(s.toolName || s.tool, s.input) === actionFingerprint
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

      const toolStepNum = (state.steps.length * 2) + 2;
      let toolDetail = "";
      if (toolName === "vision") {
        toolDetail = `/ Instruction: ${decision.input?.prompt || "Visual inspection"}`;
      } else if (toolName === "calculator") {
        toolDetail = `/ Expression: ${decision.input?.expression || ""}`;
      } else if (toolName === "retrieve_information") {
        toolDetail = `/ Query: ${decision.input?.query || ""}`;
      } else if (toolName === "coding") {
        toolDetail = `/ Task: ${decision.input?.task || ""}`;
      } else if (toolName === "execute_code") {
        toolDetail = `/ Language: ${decision.input?.language || "python"}`;
      } else if (toolName === "text_transform") {
        toolDetail = `/ Operation: ${decision.input?.operation || ""}`;
      } else if (toolName === "engineering_formula") {
        toolDetail = `/ Formula: ${decision.input?.formula || ""}`;
      } else if (toolName === "unit_conversion") {
        toolDetail = `/ Convert: ${decision.input?.value} ${decision.input?.from_unit} -> ${decision.input?.to_unit}`;
      } else if (toolName === "threshold_check") {
        toolDetail = `/ Check: ${decision.input?.value} ${decision.input?.operator || ">"} ${decision.input?.limit}`;
      } else if (toolName === "statistics") {
        toolDetail = `/ Stats: ${JSON.stringify(decision.input?.values || [])}`;
      } else if (toolName === "trend_analysis") {
        toolDetail = `/ Trend: ${JSON.stringify(decision.input?.values || [])}`;
      } else {
        toolDetail = `/ Input: ${JSON.stringify(decision.input || {})}`;
      }

      console.log(`\n[Agent Step ${toolStepNum}] Tool: ${toolName} ${toolDetail}`);
      console.log(`User task preserved: yes`);
      console.log(`Tool: ${toolName}`);
      if (decision.input) {
        if (toolName === "retrieve_information" && decision.input.query) {
          console.log(`Query: ${decision.input.query}`);
        } else if (toolName === "calculator" && decision.input.expression) {
          console.log(`Expression: ${decision.input.expression}`);
        } else if (toolName === "engineering_formula" && decision.input.formula) {
          console.log(`Formula: ${decision.input.formula}`);
        } else if (toolName === "unit_conversion") {
          console.log(`Convert: ${decision.input.value} ${decision.input.from_unit} to ${decision.input.to_unit}`);
        } else if (toolName === "threshold_check") {
          console.log(`Check: ${decision.input.value} ${decision.input.operator || ">"} ${decision.input.limit}`);
        } else if (toolName === "coding" && decision.input.task) {
          console.log(`Task: ${decision.input.task}`);
        } else if (toolName === "execute_code") {
          console.log(`Language: ${decision.input.language || "python"}`);
        } else if (toolName === "vision") {
          console.log(`Instruction: ${decision.input.prompt || "Visual inspection"}`);
        } else {
          console.log(`Input: ${JSON.stringify(decision.input)}`);
        }
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
          : toolName === "execute_code"
          ? "🔒 Executing in isolated container sandbox..."
          : toolName === "vision"
          ? "👁️ Inspecting visual content with Qwen2.5-VL..."
          : toolName === "engineering_formula"
          ? `🔧 Calculating engineering formula (${decision.input?.formula || ""})...`
          : toolName === "unit_conversion"
          ? `🔧 Converting units (${decision.input?.from_unit} -> ${decision.input?.to_unit})...`
          : toolName === "threshold_check"
          ? "🔧 Checking threshold limit..."
          : toolName === "statistics"
          ? "🔧 Computing statistical metrics..."
          : toolName === "trend_analysis"
          ? "🔧 Analyzing data trend..."
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
        sandboxRunner,
        visionClient: effectiveVisionClient,
        images: state.images || [],
      });

      if (toolName === "retrieve_information") {
        console.log(`\n[Tool]`);
        console.log(`Retrieval started`);
      } else if (toolName === "calculator") {
        console.log(`\n[Tool]`);
        console.log(`Calculator expression: ${decision.input?.expression || ""}`);
      } else if (toolName === "vision") {
        console.log(`\n[Vision]`);
        console.log(`Instruction: ${decision.input?.prompt || ""}`);
      } else if (toolName === "execute_code") {
        console.log(`\n[Sandbox]`);
        console.log(`Execution started`);
      }

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

          console.log(`\n[Tool Result]`);
          if (toolName === "calculator") {
            const val = parsedResult?.value !== undefined ? parsedResult.value : (parsedResult?.formatted || parsedResult);
            console.log(val);
            console.log(`\n[Tool]`);
            console.log(`Calculator result: ${val}`);
          } else if (toolName === "retrieve_information") {
            if (parsedResult?.content) {
              const firstLine = parsedResult.content.split("\n").filter(Boolean)[0] || parsedResult.content;
              console.log(firstLine.slice(0, 150));
            } else if (Array.isArray(parsedResult?.results) && parsedResult.results.length > 0) {
              const firstText = parsedResult.results[0]?.text || parsedResult.results[0]?.content || "";
              const firstLine = firstText.split("\n").filter(Boolean)[0] || firstText;
              console.log(firstLine.slice(0, 150));
            } else {
              const count = Array.isArray(parsedResult?.results)
                ? parsedResult.results.length
                : Array.isArray(parsedResult?.sources)
                ? parsedResult.sources.length
                : 0;
              console.log(`Retrieved ${count} excerpts`);
            }
            console.log(`\n[Tool]`);
            console.log(`Retrieval completed`);
          } else if (toolName === "coding") {
            const isRepair =
              state.steps.length > 0 &&
              (state.steps[state.steps.length - 1].toolName || state.steps[state.steps.length - 1].tool) === "execute_code" &&
              state.steps[state.steps.length - 1].status === "failed";
            console.log(`Generated code (${parsedResult?.language || "code"})`);
            console.log(`\n[Coding]`);
            console.log(isRepair ? "Code revised" : "Code generated");
          } else if (toolName === "execute_code") {
            const statusDesc = parsedResult?.timedOut ? "TIMED OUT" : `exit: ${parsedResult?.exitCode ?? (parsedResult?.success ? 0 : 1)}`;
            console.log(`Sandbox output (${statusDesc})`);
            console.log(`\n[Sandbox]`);
            console.log(`Execution ${isSuccess ? "succeeded" : "failed"}`);
          } else if (toolName === "engineering_formula") {
            const resVal = parsedResult?.result !== undefined ? parsedResult.result : JSON.stringify(parsedResult);
            console.log(`Formula: ${parsedResult?.formula} -> Result: ${resVal} ${parsedResult?.unit || ""}`);
            console.log(`\n[Tool]`);
            console.log(`Engineering formula result: ${resVal} ${parsedResult?.unit || ""}`);
          } else if (toolName === "unit_conversion") {
            console.log(`Converted: ${parsedResult?.value} ${parsedResult?.from_unit} = ${parsedResult?.result} ${parsedResult?.to_unit}`);
            console.log(`\n[Tool]`);
            console.log(`Unit conversion result: ${parsedResult?.result} ${parsedResult?.to_unit}`);
          } else if (toolName === "threshold_check") {
            console.log(`Check: ${parsedResult?.summary || parsedResult?.status_code}`);
            console.log(`\n[Tool]`);
            console.log(`Threshold status: ${parsedResult?.status_code}`);
          } else if (toolName === "statistics") {
            console.log(`Mean: ${parsedResult?.mean}, Median: ${parsedResult?.median}, Min: ${parsedResult?.minimum}, Max: ${parsedResult?.maximum}`);
            console.log(`\n[Tool]`);
            console.log(`Statistics calculated: Mean = ${parsedResult?.mean}`);
          } else if (toolName === "trend_analysis") {
            console.log(`Trend: ${parsedResult?.trend} (${parsedResult?.percentage_change}%)`);
            console.log(`\n[Tool]`);
            console.log(`Trend evaluated: ${parsedResult?.trend}`);
          } else {
            console.log(typeof parsedResult === "object" ? JSON.stringify(parsedResult) : String(parsedResult));
          }

          const toolDoneMsg = isSuccess
            ? toolName === "retrieve_information"
              ? "✓ Knowledge retrieved"
              : toolName === "calculator"
              ? "✓ Calculation completed"
              : toolName === "text_transform"
              ? "✓ Text transformed"
              : toolName === "coding"
              ? "✓ Code generated by Qwen2.5-Coder"
              : toolName === "execute_code"
              ? "✓ Code executed in isolated sandbox"
              : toolName === "engineering_formula"
              ? "✓ Engineering formula calculated"
              : toolName === "unit_conversion"
              ? "✓ Unit conversion completed"
              : toolName === "threshold_check"
              ? "✓ Threshold check completed"
              : toolName === "statistics"
              ? "✓ Statistical analysis completed"
              : toolName === "trend_analysis"
              ? "✓ Trend analysis completed"
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

          // Bounded observation storage to prevent unbounded state memory usage
          let boundedOutput = parsedResult;
          if (typeof parsedResult === "string" && parsedResult.length > 8000) {
            boundedOutput = `${parsedResult.slice(0, 8000)}... [truncated]`;
          }

          stepRecord = {
            type: "tool",
            action: "tool",
            tool: toolName,
            toolName,
            reason: decision.reason,
            input: decision.input,
            output: boundedOutput,
            observation: boundedOutput,
            status: isSuccess ? "completed" : "failed",
            executionTimeMs: Date.now() - startTime,
          };
        } catch (execErr) {
          console.log(`[Tool Result]`);
          console.log(`Error: ${execErr.message}`);
          if (toolName === "execute_code") {
            console.log(`\n[Sandbox]`);
            console.log(`Execution failed`);
          }
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

      let newFacts = [];
      if (toolName === "retrieve_information" && stepRecord.status === "completed") {
        const obs = stepRecord.observation;
        if (Array.isArray(obs?.results) && obs.results.length > 0) {
          newFacts = obs.results.map((r) => ({
            query: decision.input?.query,
            source: r.filename || r.sourceName || r.source || "Document",
            page: r.page || 1,
            text: r.text || r.content || "",
            content: r.content || r.text || "",
            score: r.score,
          }));
        } else if (obs?.content) {
          newFacts = [
            {
              query: decision.input?.query,
              source: "Document",
              page: 1,
              text: obs.content,
              content: obs.content,
            },
          ];
        }

        const previousRetrievalCount = (state.steps || []).filter(
          (s) => (s.toolName || s.tool) === "retrieve_information" && s.status === "completed"
        ).length;
        const currentRetrievalCount = previousRetrievalCount + 1;
        console.log(`\n[Agent State]`);
        console.log(`Retrieved facts/evidence count: ${currentRetrievalCount}`);
      }

      const isExecCodeFail = toolName === "execute_code" && stepRecord.status === "failed";
      const retryInc = isExecCodeFail ? 1 : 0;

      // Track schema error count for bounded correction (max 1 correction attempt)
      const isSchemaError =
        stepRecord.status === "failed" &&
        (stepRecord.observation?.code === "INVALID_ARGUMENT_TYPE" ||
          (stepRecord.observation?.error && /schema|expected|validation|missing or invalid/i.test(stepRecord.observation.error)));
      const newSchemaErrorCount = isSchemaError ? (state.schemaErrorCount || 0) + 1 : (state.schemaErrorCount || 0);

      if (isSchemaError && newSchemaErrorCount >= 2) {
        console.warn(`[agentGraph] Schema validation error retry limit reached for ${toolName}. Terminating gracefully.`);
        return {
          steps: [stepRecord],
          toolExecutionCount: state.toolExecutionCount + 1,
          status: AGENT_STATUS.COMPLETED,
          finalResponse: `Could not complete ${toolName}: invalid parameters provided after correction attempt (${stepRecord.observation?.error || "schema error"}).`,
          currentAction: {
            action: AGENT_ACTION_TYPES.FINAL,
            type: AGENT_ACTION_TYPES.FINAL,
            answer: `Could not complete ${toolName}: invalid parameters provided after correction attempt (${stepRecord.observation?.error || "schema error"}).`,
            reason: "Schema error retry limit reached.",
          },
          workflow: {
            type: effectiveWorkflow,
            status: WORKFLOW_STATUS.COMPLETED,
            currentStep: "final",
          },
        };
      }

      const nextState = {
        steps: [stepRecord],
        toolExecutionCount: state.toolExecutionCount + 1,
        schemaErrorCount: newSchemaErrorCount,
        status: AGENT_STATUS.PLANNING,
        workflow: {
          type: effectiveWorkflow,
          completedSteps: [toolName],
          retryCount: (state.workflow?.retryCount || 0) + retryInc,
        },
      };

      // Record successful tool result in executedToolSignatures
      if (stepRecord.status === "completed") {
        nextState.executedToolSignatures = {
          [actionFingerprint]: stepRecord.output,
        };
      }

      if (newFacts.length > 0) {
        nextState.retrievedFacts = newFacts;
      }

      return nextState;
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

    return workflow.compile(effectiveCheckpointer ? { checkpointer: effectiveCheckpointer } : {});
  }
}

export const agentGraphService = new AgentGraphService();
export default agentGraphService;
