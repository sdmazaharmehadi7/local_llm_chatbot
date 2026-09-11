/**
 * Sovereign Agent Controller
 *
 * Exposes REST and SSE endpoints for the LangGraph-powered Sovereign Agent.
 */

import { runAgentTask } from "../services/agent/agent.service.js";
import { getAgentToolsMetadata } from "../services/agent/agentTools.js";

/**
 * POST /api/agent/tasks
 * Submit a task to the LangGraph Sovereign Agent.
 */
export async function createAgentTask(req, res) {
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
          message: "Analysing your question...",
          status: "planning",
          framework: "langgraph",
        });

        const taskResult = await runAgentTask({
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
                  message: evt.message || "Evaluating required action...",
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
                  message: evt.message || "Evaluating the tool output...",
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
          error: streamErr.message || "Agent execution failed.",
          message: streamErr.message || "Agent execution failed.",
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
    const taskResult = await runAgentTask({
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
    console.error("[agent.controller] Error creating agent task:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error during agent task execution.",
    });
  }
}

/**
 * GET /api/agent/tasks/:taskId
 * Retrieve status for a task.
 */
export async function getAgentTask(req, res) {
  try {
    const { taskId } = req.params;
    if (!taskId) {
      return res.status(400).json({ success: false, error: "Task ID is required." });
    }

    return res.json({
      success: true,
      framework: "langgraph",
      taskId,
      message: "Agent state is managed through the LangGraph execution cycle.",
    });
  } catch (err) {
    console.error(`[agent.controller] Error fetching task ${req.params.taskId}:`, err);
    return res.status(500).json({ success: false, error: "Internal server error." });
  }
}

/**
 * GET /api/agent/tools
 * List all registered LangChain tools in the sovereign catalog.
 */
export async function listAgentTools(_req, res) {
  try {
    const tools = getAgentToolsMetadata();
    return res.json({
      success: true,
      framework: "langgraph",
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
