/**
 * Sovereign Workflow Controller (6 Industrial Workflows)
 *
 * Exposes REST and SSE endpoints for the LangGraph-powered 6-Workflow Agent:
 *   POST   /workflow                 - Submit and execute a workflow task (JSON or SSE)
 *   POST   /workflow/tasks           - Alias for workflow execution
 *   GET    /workflow/tasks/:taskId   - Get workflow task status
 *   GET    /workflow/tools           - List registered workflow capabilities
 */

import fs from "fs";
import { runWorkflowTask } from "../services/agent/agent.service.js";
import { getAgentToolsMetadata } from "../services/agent/agentTools.js";
import { agentGraphService } from "../services/agent/agentGraph.service.js";
import File from "../models/File.js";
import Chat from "../models/Chat.js";

/**
 * POST /workflow or POST /api/workflow/tasks
 * Submit a task to the 6-Workflow LangGraph Agent.
 */
export async function createWorkflowTask(req, res) {
  try {
    const { message, chatId, workspaceId, options, stream, images, image, fileIds } = req.body || {};

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: "Invalid workflow request. Please provide a clear task description.",
      });
    }

    const userId = req.userId || "user-local-admin";

    // Multi-tenant check: Prevent cross-user chat access
    if (chatId && Chat && Chat.db && Chat.db.readyState === 1) {
      const chatDoc = await Chat.findOne({ _id: chatId }).lean();
      if (chatDoc && chatDoc.userId && chatDoc.userId !== userId) {
        return res.status(403).json({
          success: false,
          error: "Forbidden: Cannot access conversation belonging to another user.",
        });
      }
    }

    const taskImages = Array.isArray(images) && images.length > 0
      ? [...images]
      : (image ? [image] : (Array.isArray(options?.images) ? [...options.images] : []));

    // If fileIds are provided and no explicit base64 images passed, load images from database
    if (taskImages.length === 0 && Array.isArray(fileIds) && fileIds.length > 0) {
      try {
        if (File && File.db && File.db.readyState === 1) {
          const files = await File.find({ _id: { $in: fileIds } }).lean();
          for (const f of files) {
            const isImage = f.category === "image" || (f.mimeType && f.mimeType.startsWith("image/"));
            if (isImage && f.path && fs.existsSync(f.path)) {
              const b64 = fs.readFileSync(f.path).toString("base64");
              taskImages.push(`data:${f.mimeType || "image/png"};base64,${b64}`);
            }
          }
        }
      } catch (fErr) {
        console.warn("[workflow.controller] Could not load attached image files from fileIds:", fErr.message);
      }
    }

    const wantsStream =
      stream === true ||
      req.query?.stream === "true" ||
      (req.headers?.accept && req.headers.accept.includes("text/event-stream"));

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
          if (typeof res.flush === "function") {
            res.flush();
          }
        }
      };

      try {
        sendSse("workflow_start", {
          message: "Analysing your question...",
          status: "planning",
          framework: "langgraph-workflows",
        });
        sendSse("agent_start", {
          message: "Analysing your question...",
          status: "planning",
          framework: "langgraph-workflows",
        });

        const taskResult = await runWorkflowTask({
          message: message.trim(),
          userId,
          chatId: chatId || null,
          workspaceId: workspaceId || "default",
          images: taskImages,
          options: {
            ...(options || {}),
            signal: abortController.signal,
            onProgress: (evt) => {
              const status = evt.status;
              if (status === "planning") {
                sendSse("reasoning", {
                  status: "planning",
                  workflow: evt.workflow,
                  message: evt.message || "Evaluating required workflow action...",
                  reason: evt.reason || "Evaluating task...",
                });
              } else if (status === "tool") {
                sendSse("tool_start", {
                  status: "tool",
                  tool: evt.tool,
                  workflow: evt.workflow,
                  message: evt.message || `Using tool: ${evt.tool}`,
                  reason: evt.reason,
                });
              } else if (status === "tool_complete") {
                sendSse("tool_result", {
                  status: "tool_complete",
                  tool: evt.tool,
                  workflow: evt.workflow,
                  success: evt.success,
                  message: evt.message || "Tool execution completed.",
                  result: evt.result,
                });
              } else if (status === "analyzing") {
                sendSse("reasoning", {
                  status: "analyzing",
                  tool: evt.tool,
                  workflow: evt.workflow,
                  message: evt.message || "Evaluating the tool output...",
                  reason: evt.reason,
                });
              } else if (status === "preparing_answer") {
                sendSse("reasoning", {
                  status: "preparing_answer",
                  workflow: evt.workflow,
                  message: evt.message || "Generating response...",
                  reason: evt.reason,
                });
              } else if (status === "completed") {
                sendSse("reasoning", {
                  status: "completed",
                  workflow: evt.workflow,
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

        sendSse("workflow_complete", {
          message: "Completed",
          status: "completed",
          framework: "langgraph-workflows",
          workflow: taskResult.workflow,
          taskId: taskResult.taskId,
          response: taskResult.response,
          steps: taskResult.steps,
          success: taskResult.success,
        });

        sendSse("agent_complete", {
          message: "Completed",
          status: "completed",
          framework: "langgraph-workflows",
          workflow: taskResult.workflow,
          taskId: taskResult.taskId,
          response: taskResult.response,
          steps: taskResult.steps,
          success: taskResult.success,
        });

        sendSse("workflow_result", {
          ...taskResult,
          framework: "langgraph-workflows",
        });

        sendSse("agent_result", {
          ...taskResult,
          framework: "langgraph-workflows",
        });
      } catch (streamErr) {
        sendSse("error", {
          status: "error",
          error: streamErr.message || "Workflow execution failed.",
          message: streamErr.message || "Workflow execution failed.",
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
    const taskResult = await runWorkflowTask({
      message: message.trim(),
      userId,
      chatId: chatId || null,
      workspaceId: workspaceId || "default",
      images: taskImages,
      options: options || {},
    });

    return res.status(taskResult.success ? 200 : 422).json({
      ...taskResult,
      framework: "langgraph-workflows",
    });
  } catch (err) {
    console.error("[workflow.controller] Error creating workflow task:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Internal server error during workflow task execution.",
    });
  }
}

/**
 * GET /workflow/tasks/:taskId or GET /api/workflow/tasks/:taskId
 */
export async function getWorkflowTask(req, res) {
  try {
    const { taskId } = req.params;
    if (!taskId) {
      return res.status(400).json({ success: false, error: "Task ID is required." });
    }

    const userId = req.userId || "user-local-admin";
    const threadId = req.query?.chatId
      ? `${userId}:${req.query.chatId}`
      : `${userId}:adhoc:${taskId}`;

    let checkpointState = null;
    try {
      const stateObj = await agentGraphService.getCheckpointState(threadId);
      if (stateObj && stateObj.values) {
        checkpointState = {
          taskId: stateObj.values.taskId,
          status: stateObj.values.status,
          workflow: stateObj.values.workflow,
          stepsCount: (stateObj.values.steps || []).length,
          hasFinalResponse: Boolean(stateObj.values.finalResponse),
        };
      }
    } catch (_stateErr) {
      // Thread not found yet
    }

    return res.json({
      success: true,
      taskId,
      threadId,
      state: checkpointState,
    });
  } catch (err) {
    console.error("[workflow.controller] Error getting workflow task:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Could not retrieve workflow task status.",
    });
  }
}

/**
 * GET /workflow/tools or GET /api/workflow/tools
 */
export async function listWorkflowTools(_req, res) {
  try {
    const tools = getAgentToolsMetadata();
    return res.json({
      success: true,
      count: tools.length,
      tools,
      framework: "langgraph-workflows",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to list workflow tools.",
    });
  }
}

export default {
  createWorkflowTask,
  getWorkflowTask,
  listWorkflowTools,
};
