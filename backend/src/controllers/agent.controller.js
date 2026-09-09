/**
 * Agent Controller
 *
 * Exposes endpoints for managing and executing agent tasks.
 */

import { runAgentTask } from "../services/agent/agent.service.js";
import agentStateService from "../services/agent/agentState.service.js";
import toolRegistry from "../services/agent/toolRegistry.service.js";

/**
 * POST /api/agent/tasks
 * Submit a multi-step task to the Agent orchestrator.
 */
export async function createAgentTask(req, res) {
  try {
    const { message, chatId, workspaceId, options } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: "Field 'message' is required and must be a non-empty string.",
      });
    }

    const userId = req.userId || "user-local-admin";

    const taskResult = await runAgentTask({
      message: message.trim(),
      userId,
      chatId: chatId || null,
      workspaceId: workspaceId || "default",
      options: options || {},
    });

    return res.status(taskResult.success ? 200 : 422).json(taskResult);
  } catch (err) {
    console.error("[agent.controller] Error creating agent task:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error during agent task execution.",
    });
  }
}

/**
 * GET /api/agent/tasks/:taskId
 * Retrieve status, execution steps, and audit log for a task.
 */
export async function getAgentTask(req, res) {
  try {
    const { taskId } = req.params;
    if (!taskId) {
      return res.status(400).json({ success: false, error: "Task ID is required." });
    }

    const taskState = await agentStateService.getTaskState(taskId);
    if (!taskState) {
      return res.status(404).json({ success: false, error: "Task not found." });
    }

    return res.json({
      success: true,
      task: taskState,
    });
  } catch (err) {
    console.error(`[agent.controller] Error fetching task ${req.params.taskId}:`, err);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
}

/**
 * GET /api/agent/tools
 * List all registered tools and their specifications.
 */
export async function listAgentTools(_req, res) {
  try {
    const tools = toolRegistry.getTools();
    return res.json({
      success: true,
      tools,
      count: tools.length,
    });
  } catch (err) {
    console.error("[agent.controller] Error listing tools:", err);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
}

export default {
  createAgentTask,
  getAgentTask,
  listAgentTools,
};
