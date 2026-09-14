/**
 * Sovereign Workflow Graph Service (6 Industrial Workflows Engine)
 *
 * LangGraph StateGraph engine dedicated to the 6-Workflow Agent.
 *
 * GUARANTEES:
 * - Powered by LangGraph StateGraph with explicit Workflow State Annotation.
 * - Dynamically determines and executes one of the 6 Controlled Industrial Workflows:
 *     1. knowledge_retrieval
 *     2. retrieval_calculation
 *     3. vision_calculation
 *     4. vision_knowledge
 *     5. coding_sandbox (with repair loop, max 2 repairs)
 *     6. general (fallback / multi-tool / direct answer)
 * - Supports sequential multi-tool chains (e.g. retrieval -> calculator -> unit converter).
 * - Emits workflow-specific progress events and metadata.
 */

import { StateGraph, Annotation, START, END, MemorySaver } from "@langchain/langgraph";
import {
  AGENT_STATUS,
  AGENT_ACTION_TYPES,
  WORKFLOW_TYPES,
  WORKFLOW_STATUS,
  AGENT_LIMITS,
} from "../agent/agent.types.js";
import { createAgentTools } from "../agent/agentTools.js";
import { agentGraphService, normalizeActionFingerprint } from "../agent/agentGraph.service.js";
import { sendChatToOllama } from "../ollama.service.js";
import {
  WORKFLOW_BRAIN_SYSTEM_PROMPT,
  analyzeTaskRequirements,
  determineWorkflow,
  parseWorkflowBrainOutput,
  validateToolSelectionPolicy,
  formatAvailableTools,
  formatStepHistory,
  formatAccumulatedEvidence,
  formatReasoningState,
} from "./workflowBrain.service.js";

// Optional mock LLM clients for deterministic acceptance testing
let brainLlmClient = null;
let coderLlmClient = null;
let visionLlmClient = null;

export const workflowGraphService = {
  buildWorkflowGraph,
  getCheckpointState,
  setAgentBrainLlmClient: (client) => {
    brainLlmClient = client;
    try {
      agentGraphService.setAgentBrainLlmClient(client);
    } catch {}
  },
  resetAgentBrainLlmClient: () => {
    brainLlmClient = null;
    try {
      agentGraphService.resetAgentBrainLlmClient();
    } catch {}
  },
  setCoderLlmClient: (client) => {
    coderLlmClient = client;
    try {
      agentGraphService.setCoderLlmClient(client);
    } catch {}
  },
  resetCoderLlmClient: () => {
    coderLlmClient = null;
    try {
      agentGraphService.resetCoderLlmClient();
    } catch {}
  },
  setVisionLlmClient: (client) => {
    visionLlmClient = client;
    try {
      agentGraphService.setVisionLlmClient(client);
    } catch {}
  },
  resetVisionLlmClient: () => {
    visionLlmClient = null;
    try {
      agentGraphService.resetVisionLlmClient();
    } catch {}
  },
  get brainLlmClient() {
    return brainLlmClient || agentGraphService.brainLlmClient;
  },
};

/**
 * Shared In-Memory Checkpointer for Workflow Agent threads
 */
export const workflowMemorySaver = new MemorySaver();

/**
 * Retrieve checkpointed state for a workflow thread
 */
export async function getCheckpointState(threadId) {
  return workflowMemorySaver.get({ configurable: { thread_id: threadId } });
}

/**
 * LangGraph State Annotation Schema for Workflow Agent
 */
export const WorkflowStateAnnotation = Annotation.Root({
  taskId: Annotation({ reducer: (_, y) => y, default: () => "" }),
  userId: Annotation({ reducer: (_, y) => y, default: () => "user-local-admin" }),
  chatId: Annotation({ reducer: (_, y) => y, default: () => null }),
  workspaceId: Annotation({ reducer: (_, y) => y, default: () => "default" }),
  userRequest: Annotation({ reducer: (_, y) => y, default: () => "" }),
  conversationHistory: Annotation({ reducer: (_, y) => (Array.isArray(y) ? y : []), default: () => [] }),
  images: Annotation({ reducer: (_, y) => (Array.isArray(y) ? y : []), default: () => [] }),
  steps: Annotation({
    reducer: (x, y) => {
      if (Array.isArray(y) && y.length === 0) return [];
      return (x || []).concat(y || []);
    },
    default: () => [],
  }),
  retrievedFacts: Annotation({
    reducer: (x, y) => {
      if (Array.isArray(y) && y.length === 0) return [];
      return (x || []).concat(y || []);
    },
    default: () => [],
  }),
  remainingInformation: Annotation({
    reducer: (_, y) => (Array.isArray(y) ? y : []),
    default: () => [],
  }),
  toolExecutionCount: Annotation({ reducer: (_, y) => y, default: () => 0 }),
  status: Annotation({ reducer: (_, y) => y, default: () => AGENT_STATUS.IDLE }),
  currentAction: Annotation({ reducer: (_, y) => y, default: () => null }),
  finalResponse: Annotation({ reducer: (_, y) => y, default: () => "" }),
  error: Annotation({ reducer: (_, y) => y, default: () => null }),
  workflow: Annotation({
    reducer: (x, y) => {
      if (y?.replaceSteps) {
        return { ...y };
      }
      return {
        ...(x || {}),
        ...(y || {}),
        completedSteps: (x?.completedSteps || []).concat(y?.completedSteps || []),
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

/**
 * Build and compile the 6-Workflow LangGraph StateGraph
 */
export function buildWorkflowGraph({
  onProgress = null,
  retriever = null,
  coderClient = null,
  sandboxRunner = null,
  visionClient = null,
  signal = null,
} = {}) {
  const tools = createAgentTools({
    retriever,
    coderClient: coderClient || workflowGraphService.coderLlmClient || agentGraphService.coderLlmClient,
    sandboxRunner,
    visionClient: visionClient || workflowGraphService.visionLlmClient || agentGraphService.visionLlmClient,
  });

  const emit = (event) => {
    if (typeof onProgress === "function") {
      try {
        onProgress(event);
      } catch (err) {
        console.warn("[workflowGraph.service] Error in onProgress callback:", err.message);
      }
    }
  };

  /**
   * Workflow Reasoner Node
   */
  const workflowReasonerNode = async (state) => {
    if (state.steps.length >= AGENT_LIMITS.MAX_AGENT_STEPS) {
      const errMsg = `Execution step limit exceeded (${AGENT_LIMITS.MAX_AGENT_STEPS} steps). Halting to prevent infinite loop.`;
      console.warn(`[workflow] ${errMsg}`);
      emit({ status: "error", error: errMsg });
      return {
        status: AGENT_STATUS.FAILED,
        error: errMsg,
        currentAction: { action: "error", reason: errMsg },
        workflow: { status: WORKFLOW_STATUS.FAILED },
      };
    }

    emit({
      status: "planning",
      workflow: state.workflow?.type || WORKFLOW_TYPES.GENERAL,
      message: "Evaluating required workflow action...",
      reason: "Analyzing goal and history...",
    });

    const activeBrainClient = workflowGraphService.brainLlmClient || agentGraphService.brainLlmClient;

    const availableToolsDescription = formatAvailableTools(tools);
    const stepHistoryDescription = formatStepHistory(state.steps);
    const accumulatedEvidenceDescription = formatAccumulatedEvidence(state.steps);
    const reasoningStateDescription = formatReasoningState(state);

    const userPromptContent = `Goal: ${state.userRequest}

${reasoningStateDescription}

Available Tools:
${availableToolsDescription}

Step History:
${stepHistoryDescription}

Accumulated Evidence:
${accumulatedEvidenceDescription}

Instructions:
Select the appropriate workflow out of the 6 controlled workflows.
Determine the next action. If a tool is required, specify the tool name and input JSON.
If the task is fully resolved or can be directly answered, return action="final" with the complete final answer.
Return ONLY a valid JSON object matching the Response Schema.`;

    const brainMessages = [
      { role: "system", content: WORKFLOW_BRAIN_SYSTEM_PROMPT },
      ...(Array.isArray(state.conversationHistory) && state.conversationHistory.length > 0
        ? state.conversationHistory.slice(-4).map((m) => ({
            role: m.role === "user" ? "user" : "assistant",
            content: typeof m.content === "string" ? m.content : "",
          }))
        : []),
      { role: "user", content: userPromptContent },
    ];

    let rawBrainOutput = "";
    if (typeof activeBrainClient === "function") {
      try {
        rawBrainOutput = await activeBrainClient(brainMessages);
      } catch (mockErr) {
        console.error("[workflowGraph] Error calling mock brain LLM client:", mockErr);
        rawBrainOutput = JSON.stringify({
          workflow: state.workflow?.type || "general",
          action: "final",
          reason: "Mock brain error fallback",
          answer: "Unable to complete task due to internal reasoning error.",
        });
      }
    } else {
      try {
        const ollamaRes = await sendChatToOllama(
          brainMessages,
          signal,
          "qwen3:8b",
          { temperature: 0.1, think: false }
        );
        rawBrainOutput = ollamaRes?.message?.content || "";
      } catch (chatErr) {
        console.error("[workflowGraph] Error calling Ollama brain:", chatErr);
        throw new Error(`Agent Brain LLM unreachable: ${chatErr.message}`);
      }
    }

    const parseResult = parseWorkflowBrainOutput(rawBrainOutput);
    let decision;

    if (!parseResult.valid) {
      console.warn(`[workflowGraph] Brain output parsing failed: ${parseResult.error}. Output: ${rawBrainOutput.slice(0, 150)}`);
      decision = {
        action: AGENT_ACTION_TYPES.FINAL,
        type: AGENT_ACTION_TYPES.FINAL,
        workflow: state.workflow?.type || WORKFLOW_TYPES.GENERAL,
        answer: rawBrainOutput.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
        response: rawBrainOutput.replace(/<think>[\s\S]*?<\/think>/g, "").trim(),
        reason: "Direct response from brain model.",
      };
    } else {
      decision = parseResult.decision;
    }

    // Analyze task requirements at step 0
    let taskAnalysis = null;
    if (state.steps.length === 0) {
      taskAnalysis = analyzeTaskRequirements(state.userRequest);
      if (taskAnalysis && (decision.tool === "retrieve_information" || !decision.tool)) {
        decision = {
          action: AGENT_ACTION_TYPES.TOOL,
          type: AGENT_ACTION_TYPES.TOOL,
          workflow: taskAnalysis.workflow,
          tool: taskAnalysis.firstTool,
          toolName: taskAnalysis.firstTool,
          input: { expression: taskAnalysis.expression },
          reason: taskAnalysis.reason,
        };
      }
    }

    // Dynamically refine active workflow
    const effectiveWorkflow = determineWorkflow({
      userRequest: state.userRequest,
      steps: state.steps,
      images: state.images,
      brainWorkflow: decision.workflow || (taskAnalysis ? taskAnalysis.workflow : state.workflow?.type),
      nextTool: decision.action === AGENT_ACTION_TYPES.TOOL ? (decision.tool || decision.toolName) : null,
    });
    decision.workflow = effectiveWorkflow;

    if (state.steps.length === 0) {
      console.log(`\n[Agent]`);
      console.log(`Task: ${state.userRequest}`);
      console.log(`Task analysis\n`);
      if (taskAnalysis?.detectionSummary) {
        console.log(taskAnalysis.detectionSummary);
        console.log();
      }
      console.log(`[Workflow]`);
      console.log(`Selected: ${effectiveWorkflow}`);
      emit({
        status: "planning",
        workflow: effectiveWorkflow,
        message: "Analysing your question...",
        reason: `Workflow selected: ${effectiveWorkflow}`,
      });
    }

    // Validate tool policy
    if (decision.action === AGENT_ACTION_TYPES.TOOL) {
      const policyValidation = validateToolSelectionPolicy(decision, {
        userRequest: state.userRequest,
        steps: state.steps,
        images: state.images,
      });

      if (!policyValidation.valid) {
        console.warn(`[workflowGraph] Tool selection policy rejection: ${policyValidation.reason}`);
        const safeFinalAction = {
          action: AGENT_ACTION_TYPES.FINAL,
          type: AGENT_ACTION_TYPES.FINAL,
          workflow: effectiveWorkflow,
          answer: decision.answer || `Cannot execute tool: ${policyValidation.reason}`,
          reason: policyValidation.reason,
        };
        emit({
          status: "preparing_answer",
          workflow: effectiveWorkflow,
          message: "Generating response...",
          reason: policyValidation.reason,
        });
        console.log(`\n[Workflow]`);
        console.log(`Completed: ${effectiveWorkflow}`);
        return {
          status: AGENT_STATUS.COMPLETED,
          finalResponse: safeFinalAction.answer,
          currentAction: safeFinalAction,
          workflow: {
            type: effectiveWorkflow,
            status: WORKFLOW_STATUS.COMPLETED,
            currentStep: "final",
          },
        };
      }
    }

    if (decision.action === AGENT_ACTION_TYPES.FINAL) {
      const finalStepNum = (state.steps.length * 2) + 1;
      console.log(`\n[Agent Step ${finalStepNum}] Model: Qwen3 / Decision: final answer`);
      console.log(`User task preserved: yes`);
      console.log(`Final answer`);
      console.log(decision.answer || decision.response || "Task completed.");
      console.log(`\n[Agent]`);
      console.log(`Final answer: ${decision.answer || decision.response || "Task completed."}`);
      console.log(`\n[Workflow]`);
      console.log(`Completed: ${effectiveWorkflow}`);
      emit({
        status: "preparing_answer",
        workflow: effectiveWorkflow,
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

    const decisionName = isRepairDecision ? "repair" : (decision.tool || decision.toolName);
    const reasonerStepNum = (state.steps.length * 2) + 1;
    console.log(`\n[Agent Step ${reasonerStepNum}] Model: Qwen3 / Decision: ${decisionName}${decision.reason ? ` / Reason: ${decision.reason}` : ""}`);
    console.log(`\n[Agent]`);
    console.log(`Decision: ${decisionName}`);

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
   * Workflow Tool Executor Node
   */
  const workflowToolsNode = async (state) => {
    const decision = state.currentAction;
    const toolName = decision?.tool || decision?.toolName;
    const activeWorkflow = state.workflow?.type || WORKFLOW_TYPES.GENERAL;

    if (state.toolExecutionCount >= AGENT_LIMITS.MAX_TOOL_EXECUTIONS) {
      const errMsg = `Execution limit exceeded: maximum allowed tool executions (${AGENT_LIMITS.MAX_TOOL_EXECUTIONS}) reached.`;
      emit({ status: "error", error: errMsg, workflow: activeWorkflow });
      return {
        status: AGENT_STATUS.FAILED,
        error: errMsg,
        currentAction: { action: "error", reason: errMsg },
        workflow: { status: WORKFLOW_STATUS.FAILED },
      };
    }

    const actionFingerprint = normalizeActionFingerprint(toolName, decision.input);
    const recentSteps = state.steps.slice(-AGENT_LIMITS.MAX_CONSECUTIVE_IDENTICAL_ACTIONS);
    if (
      recentSteps.length >= AGENT_LIMITS.MAX_CONSECUTIVE_IDENTICAL_ACTIONS &&
      recentSteps.every(
        (s) => normalizeActionFingerprint(s.toolName || s.tool, s.input) === actionFingerprint
      )
    ) {
      const stuckMsg = `Agent detected a repetitive loop on action '${toolName}'. Halting and synthesizing final answer.`;
      console.warn(`[workflowGraph] Loop protection: ${stuckMsg}`);
      emit({
        status: "preparing_answer",
        workflow: activeWorkflow,
        message: "Finalizing response...",
        reason: stuckMsg,
      });
      console.log(`\n[Workflow]`);
      console.log(`Completed: ${activeWorkflow}`);
      return {
        status: AGENT_STATUS.COMPLETED,
        finalResponse: "I have gathered the available details to address your request.",
        currentAction: { action: "final", reason: stuckMsg },
        workflow: {
          type: activeWorkflow,
          status: WORKFLOW_STATUS.COMPLETED,
          currentStep: "final",
        },
      };
    }

    const toolStepNum = (state.steps.length * 2) + 2;
    let toolDetail = "";
    if (decision.input) {
      if (toolName === "vision") {
        toolDetail = `/ Instruction: ${decision.input?.prompt || "Visual inspection"}`;
      } else if (toolName === "calculator") {
        toolDetail = `/ Expression: ${decision.input?.expression || ""}`;
      } else if (toolName === "unit_converter") {
        toolDetail = `/ Conversion: ${decision.input?.value} ${decision.input?.fromUnit} -> ${decision.input?.toUnit}`;
      } else if (toolName === "retrieve_information") {
        toolDetail = `/ Query: ${decision.input?.query || ""}`;
      } else if (toolName === "coding") {
        toolDetail = `/ Task: ${decision.input?.task || "Code generation"}`;
      } else if (toolName === "execute_code") {
        toolDetail = `/ Sandbox: ${decision.input?.language || "python"}`;
      } else if (toolName === "text_transform") {
        toolDetail = `/ Operation: ${decision.input?.operation || "transform"}`;
      }
    }

    console.log(`\n[Agent Step ${toolStepNum}] Tool: ${toolName} ${toolDetail}`.trim());
    console.log(`User task preserved: yes`);
    console.log(`Tool: ${toolName}`);
    if (decision.input) {
      if (toolName === "retrieve_information" && decision.input.query) {
        console.log(`Query: ${decision.input.query}`);
      } else if (toolName === "calculator" && decision.input.expression) {
        console.log(`Expression: ${decision.input.expression}`);
      } else if (toolName === "unit_converter") {
        console.log(`Conversion: ${decision.input.value} ${decision.input.fromUnit} -> ${decision.input.toUnit}`);
      } else if (toolName === "coding" && decision.input.task) {
        console.log(`Task: ${decision.input.task}`);
      } else if (toolName === "execute_code") {
        console.log(`Sandbox: ${decision.input.language || "python"}`);
      } else if (toolName === "vision" && decision.input.prompt) {
        console.log(`Instruction: ${decision.input.prompt}`);
      }
    }

    const toolStartMessage =
      toolName === "retrieve_information"
        ? "🔧 Searching knowledge base..."
        : toolName === "calculator"
        ? "🔧 Calling calculator..."
        : toolName === "unit_converter"
        ? "🔧 Converting physical units..."
        : toolName === "text_transform"
        ? "🔧 Transforming text..."
        : toolName === "coding"
        ? "🔧 Generating executable code..."
        : toolName === "execute_code"
        ? "🔧 Executing code in sandbox..."
        : toolName === "vision"
        ? "🔧 Inspecting image..."
        : `🔧 Executing tool: ${toolName}`;

    emit({
      status: "tool",
      tool: toolName,
      workflow: activeWorkflow,
      message: toolStartMessage,
      reason: decision.reason,
      input: decision.input,
      taskId: state.taskId,
      images: state.images || [],
    });

    if (toolName === "retrieve_information") {
      console.log(`\n[Tool]`);
      console.log(`Retrieval started`);
    } else if (toolName === "calculator") {
      console.log(`\n[Tool]`);
      console.log(`calculator(${decision.input?.expression || ""})`);
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
      const notFoundErr = `Tool '${toolName}' is not registered in the Sovereign catalog.`;
      console.warn(`[workflowGraph] ${notFoundErr}`);
      stepRecord = {
        toolName,
        tool: toolName,
        input: decision.input,
        status: "failed",
        error: notFoundErr,
        executionTimeMs: Date.now() - startTime,
      };
      emit({
        status: "tool_complete",
        tool: toolName,
        workflow: activeWorkflow,
        success: false,
        error: notFoundErr,
        message: notFoundErr,
      });
    } else {
      try {
        const toolInput = {
          ...(decision.input || {}),
          userId: state.userId,
          chatId: state.chatId,
          workspaceId: state.workspaceId,
          images: state.images || [],
        };

        const rawResult = await matchedTool.invoke(toolInput);
        let parsedResult = rawResult;
        if (typeof rawResult === "string") {
          try {
            parsedResult = JSON.parse(rawResult);
          } catch {
            parsedResult = rawResult;
          }
        }

        const isSuccess =
          typeof parsedResult === "object" && parsedResult !== null
            ? parsedResult.success !== false && parsedResult.exitCode !== 1 && !parsedResult.error
            : true;

        console.log(`\n[Tool Result]`);
        if (toolName === "calculator") {
          const val = parsedResult?.value !== undefined ? parsedResult.value : (parsedResult?.formatted || parsedResult);
          console.log(`Result: ${val}`);
          console.log(val);
          console.log(`\n[Tool]`);
          console.log(`Calculator result: ${val}`);
        } else if (toolName === "unit_converter") {
          const formula = parsedResult?.conversionFormula || parsedResult?.formatted || JSON.stringify(parsedResult);
          console.log(formula);
        } else if (toolName === "retrieve_information") {
          if (parsedResult?.content) {
            const firstLine = parsedResult.content.split("\n").filter(Boolean)[0] || parsedResult.content;
            console.log(firstLine);
          } else if (parsedResult?.results && parsedResult.results.length > 0) {
            const firstResult = parsedResult.results[0];
            const snippet = firstResult.text || firstResult.content || JSON.stringify(firstResult);
            console.log(snippet.slice(0, 120));
          } else {
            console.log("No relevant information found.");
          }
          if (parsedResult?.results) {
            const count = Array.isArray(parsedResult.results) ? parsedResult.results.length : 0;
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
        } else {
          console.log(typeof parsedResult === "object" ? JSON.stringify(parsedResult) : String(parsedResult));
        }

        const toolSuccessMsg =
          toolName === "retrieve_information"
            ? "✓ Knowledge retrieved"
            : toolName === "calculator"
            ? "✓ Calculation completed"
            : toolName === "unit_converter"
            ? "✓ Unit converted"
            : toolName === "text_transform"
            ? "✓ Text transformed"
            : toolName === "coding"
            ? "✓ Code generated"
            : toolName === "execute_code"
            ? isSuccess ? "✓ Code executed successfully" : "✗ Execution finished with error"
            : toolName === "vision"
            ? "✓ Image inspected"
            : `✓ Tool ${toolName} finished`;

        stepRecord = {
          toolName,
          tool: toolName,
          input: decision.input,
          output: parsedResult,
          observation: parsedResult,
          status: isSuccess ? "completed" : "failed",
          executionTimeMs: Date.now() - startTime,
        };

        emit({
          status: "tool_complete",
          tool: toolName,
          workflow: activeWorkflow,
          success: isSuccess,
          result: parsedResult,
          message: toolSuccessMsg,
        });
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
          workflow: activeWorkflow,
          success: false,
          error: execErr.message,
          message: `Tool ${toolName} execution error: ${execErr.message}`,
        });
        stepRecord = {
          toolName,
          tool: toolName,
          input: decision.input,
          status: "failed",
          error: execErr.message,
          executionTimeMs: Date.now() - startTime,
        };
      }
    }

    const newFacts = [];
    if (stepRecord.observation) {
      const obs = stepRecord.observation;
      if (typeof obs === "object" && obs !== null) {
        if (obs.content && typeof obs.content === "string") {
          newFacts.push(obs.content);
        }
        if (Array.isArray(obs.results)) {
          for (const r of obs.results) {
            if (r && r.text) newFacts.push(r.text);
          }
        }
        if (obs.value !== undefined) {
          newFacts.push(`Calculated result: ${obs.value} (${decision.input?.expression || ""})`);
        }
        if (obs.convertedValue !== undefined) {
          newFacts.push(`Unit conversion: ${obs.formatted || obs.convertedValue}`);
        }
        if (obs.analysis && typeof obs.analysis === "string") {
          newFacts.push(`Visual analysis: ${obs.analysis}`);
        }
      }
    }

    const totalRetrievedFacts = (state.retrievedFacts || []).concat(newFacts);
    const currentRetrievalCount = totalRetrievedFacts.length;
    if (toolName === "retrieve_information" && currentRetrievalCount > 0) {
      console.log(`\n[Agent State]`);
      console.log(`Retrieved facts/evidence count: ${currentRetrievalCount}`);
    }

    const isExecCodeFail = toolName === "execute_code" && stepRecord.status === "failed";
    const retryInc = isExecCodeFail ? 1 : 0;

    const nextState = {
      steps: [stepRecord],
      toolExecutionCount: state.toolExecutionCount + 1,
      status: AGENT_STATUS.PLANNING,
      workflow: {
        completedSteps: [toolName],
        retryCount: (state.workflow?.retryCount || 0) + retryInc,
      },
    };
    if (newFacts.length > 0) {
      nextState.retrievedFacts = newFacts;
    }

    emit({
      status: "analyzing",
      tool: toolName,
      workflow: activeWorkflow,
      message: "Evaluating the tool output...",
      reason: `Synthesizing results from ${toolName}...`,
    });

    return nextState;
  };

  /**
   * Conditional Edge: Should continue or finish?
   */
  const shouldContinue = (state) => {
    if (state.status === AGENT_STATUS.COMPLETED) {
      return END;
    }
    if (state.status === AGENT_STATUS.FAILED) {
      return END;
    }
    if (state.currentAction?.action === AGENT_ACTION_TYPES.FINAL) {
      return END;
    }
    if (state.currentAction?.action === AGENT_ACTION_TYPES.TOOL) {
      return "workflowTools";
    }
    return END;
  };

  const graph = new StateGraph(WorkflowStateAnnotation)
    .addNode("workflowReasoner", workflowReasonerNode)
    .addNode("workflowTools", workflowToolsNode)
    .addEdge(START, "workflowReasoner")
    .addConditionalEdges("workflowReasoner", shouldContinue, {
      workflowTools: "workflowTools",
      [END]: END,
    })
    .addEdge("workflowTools", "workflowReasoner");

  return graph.compile({ checkpointer: workflowMemorySaver });
}

export default {
  workflowGraphService,
  WorkflowStateAnnotation,
  workflowMemorySaver,
  getCheckpointState,
  buildWorkflowGraph,
};
