/**
 * Agent Tool Executor Service
 *
 * Safe mediator responsible for:
 * 1. Resolving tools via ToolRegistry
 * 2. Enforcing permissions
 * 3. Validating inputs against schemas
 * 4. Executing tools within execution limits and timeouts
 * 5. Normalizing execution results and error formats
 * 6. Protecting against oversized output payloads
 */

import toolRegistry from "./toolRegistry.service.js";
import { AGENT_LIMITS } from "./agent.types.js";

/**
 * Executes a tool with comprehensive safety checks and telemetry.
 *
 * @param {object} params
 * @param {string} params.toolName - Name of registered tool
 * @param {object} params.input - Input payload
 * @param {object} [params.context={}] - Caller context (userId, chatId, workspaceId, permissions)
 * @returns {Promise<{
 *   success: boolean,
 *   toolName: string,
 *   result?: any,
 *   metadata?: object,
 *   error?: string,
 *   executionTimeMs: number
 * }>}
 */
export async function executeTool({ toolName, input = {}, context = {} }) {
  const startTime = Date.now();

  // 1. Verify tool exists in Tool Registry (never bypass)
  const tool = toolRegistry.getTool(toolName);
  if (!tool) {
    return {
      success: false,
      toolName: toolName || "unknown",
      error: `Tool "${toolName}" is not registered or allowed.`,
      executionTimeMs: Date.now() - startTime,
    };
  }

  // 2. Check permission authorization
  if (Array.isArray(tool.permissions) && tool.permissions.length > 0) {
    const userPermissions = Array.isArray(context.permissions)
      ? new Set(context.permissions)
      : new Set(["read:documents", "execute:tools"]); // Default sovereign permissions

    const hasAll = tool.permissions.every((p) => userPermissions.has(p));
    if (!hasAll) {
      return {
        success: false,
        toolName,
        error: `Permission denied: execution requires [${tool.permissions.join(", ")}].`,
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  // 3. Validate tool input
  const validation = toolRegistry.validateToolInput(toolName, input);
  if (!validation.valid) {
    return {
      success: false,
      toolName,
      error: `Input validation failed for tool "${toolName}": ${validation.error}`,
      executionTimeMs: Date.now() - startTime,
    };
  }

  // 4. Execute tool safely with timeout
  try {
    const timeoutMs = context.timeoutMs || AGENT_LIMITS.MAX_EXECUTION_TIME_MS || 30000;
    const executionPromise = tool.execute(input, context);

    let timerId;
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => {
        reject(new Error(`Tool "${toolName}" timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    });

    const rawResult = await Promise.race([executionPromise, timeoutPromise]).finally(() => {
      clearTimeout(timerId);
    });

    const executionTimeMs = Date.now() - startTime;

    // 5. Enforce result size limit
    const serialized = JSON.stringify(rawResult ?? "");
    if (serialized && serialized.length > AGENT_LIMITS.MAX_RESULT_SIZE) {
      return {
        success: false,
        toolName,
        error: `Tool "${toolName}" output exceeded maximum allowed size (${serialized.length} > ${AGENT_LIMITS.MAX_RESULT_SIZE} bytes).`,
        executionTimeMs,
      };
    }

    // 6. Normalize success result
    return {
      success: true,
      toolName,
      result: rawResult,
      metadata: {
        timestamp: new Date().toISOString(),
      },
      executionTimeMs,
    };
  } catch (err) {
    return {
      success: false,
      toolName,
      error: err.message || "An unexpected error occurred during tool execution.",
      executionTimeMs: Date.now() - startTime,
    };
  }
}

export default { executeTool };
