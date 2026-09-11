/**
 * Framework Agent Controller
 *
 * REST and SSE endpoints for the LangGraph-based experimental agent.
 * Mounted at /api/agent/framework/*
 */

import { runFrameworkAgentTask } from "../services/agent/framework/frameworkAgent.service.js";
import { getFrameworkToolsMetadata } from "../services/agent/framework/frameworkTools.js";
import agentStateService from "../services/agent/agentState.service.js";

/**
 * POST /api/agent/framework/tasks
 * Execute a multi-step task via the LangGraph experimental agent.
 */
export async function createFrameworkAgentTask(req, res) {
  try {
    const { message, chatId, workspaceId, options, stream } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: "Invalid agent request. Please provide a clear task description.",
      });
    }

    const userId = req.userId || "user-local-admin";
    const wantsStream =
      stream === true ||
      req.query?.stream === "true" ||
      (req.headers.accept && req.headers.accept.includes("text/event-stream"));

    if (wantsStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }

      let isTaskFinished = false;
      const abortController = new AbortController();
      if (res.on) {
        res.on("close", () => {
          if (!isTaskFinished && !res.writableEnded) {
            abortController.abort();
          }
        });
      }

      const sendSse = (eventName, data) => {
        if (!res.writableEnded) {
          const payload =
            typeof data === "object" && data !== null
              ? { type: eventName, ...data }
              : { type: eventName, value: data };
          res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
        }
      };

      try {
        sendSse("agent_start", {
          message: "Analysing your question with LangGraph...",
          status: "planning",
          framework: "langgraph",
        });

        const taskResult = await runFrameworkAgentTask({
          message: message.trim(),
          userId,
          chatId: chatId || null,
          workspaceId: workspaceId || "default",
          options: {
            ...(options || {}),
            signal: abortController.signal,
            onProgress: (evt) => {
              const status = evt.status;
              if (status === "planning") {
                sendSse("reasoning", {
                  status: "planning",
                  message: evt.message || "Evaluating task with LangGraph...",
                  reason: evt.reason || "Evaluating task...",
                });
              } else if (status === "tool") {
                sendSse("tool_start", {
                  status: "tool",
                  tool: evt.tool,
                  message: evt.message || `Using tool: ${evt.tool}`,
                  reason: evt.reason,
                });
              } else if (status === "tool_complete") {
                sendSse("tool_result", {
                  status: "tool_complete",
                  tool: evt.tool,
                  success: evt.success,
                  message: evt.message || "Tool execution completed.",
                });
              } else if (status === "analyzing") {
                sendSse("reasoning", {
                  status: "analyzing",
                  tool: evt.tool,
                  message: evt.message || "Evaluating tool output...",
                  reason: evt.reason,
                });
              } else if (status === "preparing_answer") {
                sendSse("reasoning", {
                  status: "preparing_answer",
                  message: evt.message || "Generating response...",
                  reason: evt.reason,
                });
              } else if (status === "completed") {
                sendSse("reasoning", {
                  status: "completed",
                  message: evt.message || "Response ready",
                });
              } else if (status === "error") {
                sendSse("error", {
                  status: "error",
                  error: evt.error,
                  message: evt.error,
                });
              } else {
                sendSse("reasoning", evt);
              }
            },
            onChunk: (chunk) => {
              if (chunk && chunk.text) {
                sendSse("answer_chunk", {
                  text: chunk.text,
                });
              }
            },
          },
        });

        sendSse("agent_complete", {
          message: "Completed",
          status: "completed",
          framework: "langgraph",
          taskId: taskResult.taskId,
          response: taskResult.response,
          steps: taskResult.steps,
          success: taskResult.success,
        });

        sendSse("agent_result", {
          ...taskResult,
          framework: "langgraph",
        });
      } catch (streamErr) {
        sendSse("error", {
          status: "error",
          error: streamErr.message || "LangGraph agent execution failed.",
          message: streamErr.message || "LangGraph agent execution failed.",
        });
      } finally {
        isTaskFinished = true;
        if (!res.writableEnded) {
          res.end();
        }
      }
      return;
    }

    // Non-streaming response
    const taskResult = await runFrameworkAgentTask({
      message: message.trim(),
      userId,
      chatId: chatId || null,
      workspaceId: workspaceId || "default",
      options: options || {},
    });

    return res.status(taskResult.success ? 200 : 422).json({
      ...taskResult,
      framework: "langgraph",
    });
  } catch (err) {
    console.error("[frameworkAgent.controller] Error creating task:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error during LangGraph agent execution.",
    });
  }
}

/**
 * GET /api/agent/framework/tasks/:taskId
 * Retrieve status, execution steps, and audit log for a framework task.
 */
export async function getFrameworkAgentTask(req, res) {
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
      framework: "langgraph",
      task: taskState,
    });
  } catch (err) {
    console.error(`[frameworkAgent.controller] Error fetching task ${req.params.taskId}:`, err);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
}

/**
 * GET /api/agent/framework/tools
 * List all registered LangChain tools in the framework catalog.
 */
export async function listFrameworkAgentTools(_req, res) {
  try {
    const tools = getFrameworkToolsMetadata();
    return res.json({
      success: true,
      framework: "langgraph",
      tools,
      count: tools.length,
    });
  } catch (err) {
    console.error("[frameworkAgent.controller] Error listing tools:", err);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
}

export default {
  createFrameworkAgentTask,
  getFrameworkAgentTask,
  listFrameworkAgentTools,
};
