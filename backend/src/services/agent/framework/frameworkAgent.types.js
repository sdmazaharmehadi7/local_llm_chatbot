/**
 * Framework Agent Types & Limits
 *
 * Defines status constants, action types, and execution bounds for the
 * LangGraph-based experimental agent implementation.
 */

export const FRAMEWORK_AGENT_STATUS = Object.freeze({
  IDLE: "idle",
  PLANNING: "planning",
  EXECUTING: "executing",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
});

export const FRAMEWORK_ACTION_TYPES = Object.freeze({
  TOOL: "tool",
  FINAL: "final",
  ERROR: "error",
});

export const FRAMEWORK_AGENT_LIMITS = Object.freeze({
  MAX_GRAPH_STEPS: 8,
  MAX_TOOL_EXECUTIONS: 5,
  MAX_EXECUTION_TIME_MS: 60_000,
  MAX_CONSECUTIVE_IDENTICAL_ACTIONS: 3,
});

export default {
  FRAMEWORK_AGENT_STATUS,
  FRAMEWORK_ACTION_TYPES,
  FRAMEWORK_AGENT_LIMITS,
};
