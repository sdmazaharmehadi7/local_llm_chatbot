/**
 * Agent Service (Orchestrator)
 *
 * Core agent orchestrator responsible for:
 * - Managing the complete lifecycle of multi-step tasks
 * - Enforcing execution limits and preventing infinite loops
 * - Coordinating between Agent Planner, Tool Registry, and Tool Executor
 * - Recording step-by-step state and audit trails
 * - Delivering deterministic and controlled responses
 */

import crypto from "crypto";
import { AGENT_STATUS, AGENT_ACTION_TYPES, AGENT_LIMITS } from "./agent.types.js";
import toolRegistry from "./toolRegistry.service.js";
import agentPlannerService from "./agentPlanner.service.js";
import { executeTool } from "./agentExecutor.service.js";
import agentStateService from "./agentState.service.js";

// Built-in tools
import calculatorTool from "./tools/calculator.tool.js";
import textTransformTool from "./tools/textTransform.tool.js";
import retrievalTool from "./tools/retrieval.tool.js";

/**
 * Ensures standard built-in tools are registered.
 */
export function initializeBuiltInTools() {
  if (!toolRegistry.hasTool(calculatorTool.name)) {
    toolRegistry.registerTool(calculatorTool);
  }
  if (!toolRegistry.hasTool(textTransformTool.name)) {
    toolRegistry.registerTool(textTransformTool);
  }
  if (!toolRegistry.hasTool(retrievalTool.name)) {
    toolRegistry.registerTool(retrievalTool);
  }
}

// Auto-register built-in tools on load
initializeBuiltInTools();

/**
 * Execute an Agent task end-to-end.
 *
 * @param {object} params
 * @param {string} params.message - User instruction / prompt
 * @param {string} [params.taskId] - Unique task identifier
 * @param {string} [params.userId="user-local-admin"] - Authenticated user identifier
 * @param {string} [params.chatId=null] - Associated chat session ID
 * @param {string} [params.workspaceId="default"] - Active workspace ID
 * @param {object} [params.options={}] - Custom configuration / limit overrides
 * @returns {Promise<{
 *   success: boolean,
 *   taskId: string,
 *   status: string,
 *   response: string,
 *   steps: Array<object>,
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
  initializeBuiltInTools();

  if (!message || typeof message !== "string" || !message.trim()) {
    throw new Error("Task message is required.");
  }

  // 1. Initialize task state
  const state = await agentStateService.createTaskState({
    taskId,
    userId,
    chatId,
    workspaceId,
    userRequest: message.trim(),
  });

  const maxSteps = options.maxSteps || AGENT_LIMITS.MAX_AGENT_STEPS;
  const maxTools = options.maxTools || AGENT_LIMITS.MAX_TOOL_EXECUTIONS;
  const maxTimeMs = options.maxTimeMs || AGENT_LIMITS.MAX_EXECUTION_TIME_MS;

  let toolExecutionCount = 0;

  // 2. Orchestration loop
  while (
    state.status !== AGENT_STATUS.COMPLETED &&
    state.status !== AGENT_STATUS.FAILED &&
    state.status !== AGENT_STATUS.CANCELLED
  ) {
    // Check Step Limit
    if (state.steps.length >= maxSteps) {
      const errMsg = `Execution limit exceeded: maximum allowed steps (${maxSteps}) reached.`;
      await agentStateService.failTask(taskId, errMsg);
      break;
    }

    // Check Execution Time Limit
    if (Date.now() - startTime >= maxTimeMs) {
      const errMsg = `Execution time limit exceeded (${maxTimeMs}ms).`;
      await agentStateService.failTask(taskId, errMsg);
      break;
    }

    // Transition state to PLANNING
    await agentStateService.updateTaskStatus(taskId, AGENT_STATUS.PLANNING);

    // 3. Invoke Planner to decide next structured action
    const availableTools = toolRegistry.getTools();
    const decision = await agentPlannerService.planNextStep({
      taskState: state,
      availableTools,
    });

    // 4. Handle Decision: FINAL
    if (decision.action === AGENT_ACTION_TYPES.FINAL) {
      const finalResponse =
        decision.response || decision.reason || "Task completed successfully.";
      await agentStateService.completeTask(taskId, finalResponse);
      break;
    }

    // 5. Handle Decision: ERROR
    if (decision.action === AGENT_ACTION_TYPES.ERROR) {
      const errMsg = decision.reason || "Planning error occurred.";
      await agentStateService.failTask(taskId, errMsg);
      break;
    }

    // 6. Handle Decision: TOOL
    if (decision.action === AGENT_ACTION_TYPES.TOOL) {
      // Check Tool Executions Limit
      if (toolExecutionCount >= maxTools) {
        const errMsg = `Execution limit exceeded: maximum allowed tool executions (${maxTools}) reached.`;
        await agentStateService.failTask(taskId, errMsg);
        break;
      }

      await agentStateService.updateTaskStatus(taskId, AGENT_STATUS.EXECUTING);
      toolExecutionCount++;

      // Execute selected tool via Agent Executor
      const toolResult = await executeTool({
        toolName: decision.toolName,
        input: decision.input || {},
        context: {
          taskId,
          userId,
          chatId,
          workspaceId,
        },
      });

      // Record step in state
      await agentStateService.recordStep(taskId, {
        action: AGENT_ACTION_TYPES.TOOL,
        toolName: decision.toolName,
        reason: decision.reason,
        input: decision.input,
        output: toolResult,
        status: toolResult.success ? "completed" : "failed",
        executionTimeMs: toolResult.executionTimeMs || 0,
      });

      // Record tool result
      await agentStateService.recordToolResult(taskId, toolResult);
    }
  }

  const finalState = await agentStateService.getTaskState(taskId);
  const totalExecutionTimeMs = Date.now() - startTime;

  return {
    success: finalState.status === AGENT_STATUS.COMPLETED,
    taskId: finalState.taskId,
    status: finalState.status,
    response: finalState.finalResponse,
    steps: finalState.steps,
    executionTimeMs: totalExecutionTimeMs,
    ...(finalState.error ? { error: finalState.error } : {}),
  };
}

export default { runAgentTask, initializeBuiltInTools };
