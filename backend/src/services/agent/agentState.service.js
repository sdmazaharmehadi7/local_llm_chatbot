/**
 * Agent State Service
 *
 * Tracks the step-by-step state, tool executions, and audit trail of Agent tasks.
 * Synchronizes in-memory state with MongoDB AgentTask persistence when available.
 */

import crypto from "crypto";
import AgentTask from "../../models/AgentTask.js";
import { AGENT_STATUS } from "./agent.types.js";

class AgentStateService {
  constructor() {
    this.inMemoryTasks = new Map();
  }

  /**
   * Initialize a new task state.
   *
   * @param {object} params
   * @param {string} [params.taskId]
   * @param {string} params.userId
   * @param {string} [params.chatId=null]
   * @param {string} [params.workspaceId="default"]
   * @param {string} params.userRequest
   * @returns {Promise<object>} Initial task state
   */
  async createTaskState({
    taskId = crypto.randomUUID(),
    userId,
    chatId = null,
    workspaceId = "default",
    userRequest,
  }) {
    const now = new Date();
    const state = {
      taskId,
      userId,
      chatId,
      workspaceId,
      userRequest,
      status: AGENT_STATUS.PLANNING,
      currentStep: 0,
      steps: [],
      toolResults: [],
      finalResponse: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    this.inMemoryTasks.set(taskId, state);

    // Persist to MongoDB asynchronously without blocking if DB is available
    try {
      if (AgentTask && AgentTask.db && AgentTask.db.readyState === 1) {
        await AgentTask.create({
          _id: taskId,
          taskId,
          userId,
          chatId,
          workspaceId,
          userRequest,
          status: state.status,
          currentStep: 0,
          steps: [],
          toolResults: [],
        });
      }
    } catch (err) {
      console.warn(`[agentState] Warning persisting task ${taskId} to MongoDB:`, err.message);
    }

    return state;
  }

  /**
   * Get the current state of a task.
   *
   * @param {string} taskId
   * @returns {Promise<object|null>}
   */
  async getTaskState(taskId) {
    if (this.inMemoryTasks.has(taskId)) {
      return this.inMemoryTasks.get(taskId);
    }

    // Attempt lookup from MongoDB if not found in memory
    try {
      if (AgentTask && AgentTask.db && AgentTask.db.readyState === 1) {
        const dbDoc = await AgentTask.findOne({
          $or: [{ _id: taskId }, { taskId }],
        });
        if (dbDoc) {
          const state = dbDoc.toJSON();
          this.inMemoryTasks.set(taskId, state);
          return state;
        }
      }
    } catch (err) {
      console.warn(`[agentState] Error querying task ${taskId} from MongoDB:`, err.message);
    }

    return null;
  }

  /**
   * Record an execution step in the task state.
   *
   * @param {string} taskId
   * @param {object} stepData
   * @returns {Promise<object>} Updated task state
   */
  async recordStep(taskId, stepData) {
    const state = await this.getTaskState(taskId);
    if (!state) {
      throw new Error(`Cannot record step for non-existent task "${taskId}".`);
    }

    const stepNumber = state.steps.length + 1;
    const formattedStep = {
      stepNumber,
      action: stepData.action || "tool",
      toolName: stepData.toolName || null,
      reason: stepData.reason || null,
      input: stepData.input !== undefined ? stepData.input : null,
      output: stepData.output !== undefined ? stepData.output : null,
      status: stepData.status || "completed",
      executionTimeMs: stepData.executionTimeMs || 0,
      timestamp: new Date(),
    };

    state.steps.push(formattedStep);
    state.currentStep = stepNumber;
    state.updatedAt = new Date();

    this.inMemoryTasks.set(taskId, state);

    // Sync to MongoDB
    try {
      if (AgentTask && AgentTask.db && AgentTask.db.readyState === 1) {
        await AgentTask.updateOne(
          { $or: [{ _id: taskId }, { taskId }] },
          {
            $set: {
              currentStep: stepNumber,
              updatedAt: state.updatedAt,
            },
            $push: {
              steps: formattedStep,
            },
          }
        );
      }
    } catch (err) {
      console.warn(`[agentState] Error syncing step to MongoDB for task ${taskId}:`, err.message);
    }

    return state;
  }

  /**
   * Record a tool execution result.
   *
   * @param {string} taskId
   * @param {object} toolResult
   */
  async recordToolResult(taskId, toolResult) {
    const state = await this.getTaskState(taskId);
    if (!state) return;

    state.toolResults.push(toolResult);
    state.updatedAt = new Date();
    this.inMemoryTasks.set(taskId, state);

    try {
      if (AgentTask && AgentTask.db && AgentTask.db.readyState === 1) {
        await AgentTask.updateOne(
          { $or: [{ _id: taskId }, { taskId }] },
          {
            $set: { updatedAt: state.updatedAt },
            $push: { toolResults: toolResult },
          }
        );
      }
    } catch (err) {
      console.warn(`[agentState] Error syncing toolResult to MongoDB for ${taskId}:`, err.message);
    }
  }

  /**
   * Update task status.
   *
   * @param {string} taskId
   * @param {string} status
   * @param {object} [extraFields={}]
   */
  async updateTaskStatus(taskId, status, extraFields = {}) {
    const state = await this.getTaskState(taskId);
    if (!state) return null;

    state.status = status;
    state.updatedAt = new Date();
    Object.assign(state, extraFields);

    this.inMemoryTasks.set(taskId, state);

    try {
      if (AgentTask && AgentTask.db && AgentTask.db.readyState === 1) {
        await AgentTask.updateOne(
          { $or: [{ _id: taskId }, { taskId }] },
          {
            $set: {
              status,
              updatedAt: state.updatedAt,
              ...extraFields,
            },
          }
        );
      }
    } catch (err) {
      console.warn(`[agentState] Error updating status in MongoDB for ${taskId}:`, err.message);
    }

    return state;
  }

  /**
   * Mark task as completed with final response.
   *
   * @param {string} taskId
   * @param {string} finalResponse
   */
  async completeTask(taskId, finalResponse) {
    return this.updateTaskStatus(taskId, AGENT_STATUS.COMPLETED, { finalResponse });
  }

  /**
   * Mark task as failed with error details.
   *
   * @param {string} taskId
   * @param {string} errorMessage
   */
  async failTask(taskId, errorMessage) {
    return this.updateTaskStatus(taskId, AGENT_STATUS.FAILED, {
      error: errorMessage,
      finalResponse: `Task could not be completed: ${errorMessage}`,
    });
  }

  /**
   * Clear in-memory cache (for testing isolation).
   */
  clear() {
    this.inMemoryTasks.clear();
  }
}

export const agentStateService = new AgentStateService();
export default agentStateService;
