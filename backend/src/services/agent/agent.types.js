/**
 * Sovereign Agent Types & Limits (LangGraph Engine)
 *
 * Defines unified status constants, action types, and execution bounds.
 */

export const AGENT_STATUS = Object.freeze({
  IDLE: "idle",
  PLANNING: "planning",
  EXECUTING: "executing",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const AGENT_ACTION_TYPES = Object.freeze({
  TOOL: "tool",
  FINAL: "final",
  ERROR: "error",
});

export const AGENT_LIMITS = Object.freeze({
  MAX_AGENT_STEPS: 8,
  MAX_TOOL_EXECUTIONS: 5,
  MAX_EXECUTION_TIME_MS: 60_000,
  MAX_CONSECUTIVE_IDENTICAL_ACTIONS: 3,
  MAX_RESULT_SIZE: 100_000,
});

export default {
  AGENT_STATUS,
  AGENT_ACTION_TYPES,
  AGENT_LIMITS,
};
