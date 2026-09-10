/**
 * Agent Planner Service
 *
 * Modular planning service delegating to the Qwen3:8b Agent Brain.
 *
 * GUARANTEES & PRINCIPLES:
 * - Powered by Qwen3:8b as the real Agent Brain.
 * - Structured decisions: { action: "tool", ... } or { action: "final", ... }
 * - NEVER executes a tool directly (planner only decides, executor executes)
 * - Safe pluggable architecture for testing and runtime model switching
 */

import { AGENT_ACTION_TYPES } from "./agent.types.js";
import qwenBrainService from "./qwenBrain.service.js";

class AgentPlannerService {
  constructor() {
    this.customPlanner = null;
  }

  /**
   * Set a custom planning strategy (e.g. for future model-based planning).
   * @param {Function} plannerFn
   */
  setCustomPlanner(plannerFn) {
    this.customPlanner = plannerFn;
  }

  /**
   * Reset custom planner back to deterministic default.
   */
  resetPlanner() {
    this.customPlanner = null;
  }

  /**
   * Determine the next structured action for an Agent task.
   *
   * @param {object} params
   * @param {object} params.taskState - Current state of the task
   * @param {Array<object>} params.availableTools - Registered tools metadata
   * @returns {Promise<{
   *   action: "tool"|"final"|"error",
   *   toolName?: string,
   *   input?: object,
   *   reason: string,
   *   response?: string
   * }>}
   */
  async planNextStep({ taskState, availableTools = [] }) {
    if (typeof this.customPlanner === "function") {
      return this.customPlanner({ taskState, availableTools });
    }

    return qwenBrainService.decideNextStep({ taskState, availableTools });
  }
}

export const agentPlannerService = new AgentPlannerService();
export default agentPlannerService;
