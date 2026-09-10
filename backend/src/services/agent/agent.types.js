/**
 * Agent Foundation Types & Configuration Constants
 *
 * Defines execution limits, task statuses, and standard action types
 * for sovereign on-premise agent workflows.
 */

export const AGENT_STATUS = Object.freeze({
  PLANNING: "PLANNING",
  EXECUTING: "EXECUTING",
  WAITING_FOR_TOOL: "WAITING_FOR_TOOL",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
});

export const AGENT_ACTION_TYPES = Object.freeze({
  TOOL: "tool",
  FINAL: "final",
  ERROR: "error",
});

export const AGENT_LIMITS = Object.freeze({
  MAX_AGENT_STEPS: parseInt(process.env.MAX_AGENT_STEPS, 10) || 8,
  MAX_TOOL_EXECUTIONS: parseInt(process.env.MAX_TOOL_EXECUTIONS, 10) || 8,
  MAX_EXECUTION_TIME_MS: parseInt(process.env.MAX_AGENT_EXECUTION_TIME_MS, 10) || 180000,
  MAX_RESULT_SIZE: parseInt(process.env.MAX_AGENT_RESULT_SIZE, 10) || 100000,
});
