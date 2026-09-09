/**
 * Agent Planner Service
 *
 * Modular planning service that decides the next action in an agent workflow.
 *
 * GUARANTEES & PRINCIPLES:
 * - Deterministic, structured decisions: { action: "tool", ... } or { action: "final", ... }
 * - NEVER executes a tool directly (planner only decides, executor executes)
 * - Safe rule-based decomposition for calculator, text_transform, and retrieval
 * - Pluggable architecture allowing future model-based planners to be plugged in seamlessly
 */

import { AGENT_ACTION_TYPES } from "./agent.types.js";

// Mathematical intent patterns
const MATH_KEYWORDS_REGEX =
  /\b(calculate|compute|solve|math|percentage|rate|sum|difference|product|division|quotient|average|mean|multiply|multiplication|divided|ratio)\b|[\d\s]+[\+\-\*\/\^%][\d\s]+/i;

// Text transform patterns
const TEXT_TRANSFORM_REGEX =
  /\b(uppercase|lowercase|word count|count words|character count|char count|summarize|trim|reverse string|reverse text)\b/i;

// Document retrieval patterns
const RETRIEVAL_KEYWORDS_REGEX =
  /\b(find|search|lookup|retrieve|get|information about|document|manual|sop|policy|guideline|inspection|report|safety|ppe|procedure|according to|what does the document say)\b/i;

/**
 * Extract mathematical expression from user query.
 *
 * @param {string} text
 * @returns {string|null}
 */
function extractMathExpression(text) {
  if (!text) return null;

  // Handle specific pattern: "17 of 100 inspections" -> "(17 / 100) * 100" or "17 / 100"
  const rateMatch = text.match(/(\d+(?:\.\d+)?)\s+(?:out\s+of|of)\s+(\d+(?:\.\d+)?)/i);
  if (rateMatch) {
    const isRateOrPercentage = /\b(percentage|rate|percent|%)\b/i.test(text);
    return isRateOrPercentage
      ? `(${rateMatch[1]} / ${rateMatch[2]}) * 100`
      : `${rateMatch[1]} / ${rateMatch[2]}`;
  }

  // Handle explicit equations: "25 * 0.17", "sqrt(144) + 10", etc.
  const rawClean = text
    .replace(/^(calculate|compute|solve|what is|find the value of)\s+/i, "")
    .replace(/[?!=]+$/, "")
    .trim();

  if (/^[\d\s\+\-\*\/\^\%\(\)\.\,a-z_]+$/i.test(rawClean) && /\d/.test(rawClean)) {
    return rawClean;
  }

  // Try matching any isolated math expression inside the text
  const match = text.match(/(\d+[\d\s\+\-\*\/\^\%\(\)\.]*\d+)/);
  if (match) {
    return match[1].trim();
  }

  return null;
}

/**
 * Extract text transformation parameters.
 *
 * @param {string} text
 * @returns {{ operation: string, text: string }|null}
 */
function extractTextTransform(text) {
  const lower = text.toLowerCase();

  let operation = null;
  if (lower.includes("uppercase")) operation = "uppercase";
  else if (lower.includes("lowercase")) operation = "lowercase";
  else if (lower.includes("word count") || lower.includes("count words")) operation = "word_count";
  else if (lower.includes("character count") || lower.includes("char count")) operation = "char_count";
  else if (lower.includes("summarize")) operation = "summarize";
  else if (lower.includes("trim")) operation = "trim";
  else if (lower.includes("reverse")) operation = "reverse";

  if (!operation) return null;

  // Extract target text: look for quotes or text after "text:" or "for:"
  const quoteMatch = text.match(/["']([^"']+)["']/);
  if (quoteMatch) {
    return { operation, text: quoteMatch[1] };
  }

  const afterColonMatch = text.match(/(?:text|string|content):\s*(.+)$/i);
  if (afterColonMatch) {
    return { operation, text: afterColonMatch[1].trim() };
  }

  // Fallback: strip the command part
  const stripped = text
    .replace(/^(convert|transform|turn|get|find|calculate)?\s*(the)?\s*(uppercase|lowercase|word count|count words|character count|summarize|trim|reverse)\s*(of|for|on)?\s*/i, "")
    .trim();

  return { operation, text: stripped || text };
}

/**
 * Synthesize final answer after tool executions.
 *
 * @param {object} taskState
 * @returns {string}
 */
function synthesizeFinalResponse(taskState) {
  const { userRequest, steps } = taskState;
  const lastStep = steps[steps.length - 1];

  if (!lastStep) {
    return "Task completed successfully.";
  }

  if (lastStep.status === "failed") {
    return `Unable to complete request due to error in tool "${lastStep.toolName}": ${
      lastStep.output?.error || "Execution failed"
    }`;
  }

  const result = lastStep.output?.result;

  // Formatting based on tool
  if (lastStep.toolName === "calculator") {
    const val = result?.value !== undefined ? result.value : result;
    const isRate = /\b(failure rate|rate|percentage|percent)\b/i.test(userRequest);
    if (isRate && typeof val === "number") {
      return `The calculated rate is ${val}% (expression evaluated: ${lastStep.input?.expression}).`;
    }
    return `The calculated result is ${val}.`;
  }

  if (lastStep.toolName === "text_transform") {
    const op = lastStep.input?.operation;
    if (op === "word_count") {
      return `The text contains ${result?.wordCount ?? result} words.`;
    }
    if (op === "char_count") {
      return `The text contains ${result?.charCount ?? result} characters.`;
    }
    if (op === "summarize") {
      return `Summary: ${result?.summary ?? result}`;
    }
    return `Transformed text: ${result?.result ?? result}`;
  }

  if (lastStep.toolName === "retrieve_information" || lastStep.tool === "retrieve_information") {
    if (result?.content && typeof result.content === "string" && result.content.trim()) {
      let finalAnswer = `Based on verified documentation:\n\n${result.content.trim()}`;
      if (Array.isArray(result.sources) && result.sources.length > 0) {
        const sourceLines = result.sources.map((s) => {
          const pagePart = s.pageText ? ` (${s.pageText})` : s.page ? ` (Page ${s.page})` : "";
          return `- ${s.filename || "Document"}${pagePart}`;
        });
        finalAnswer += `\n\nSources:\n${sourceLines.join("\n")}`;
      }
      return finalAnswer;
    }
    const items = result?.results || [];
    if (items.length === 0) {
      return "No relevant documents or records were found matching your inquiry.";
    }
    const excerpts = items
      .slice(0, 3)
      .map(
        (it, idx) =>
          `[${idx + 1}] Document: ${it.filename} (Page ${it.page})\n${it.text.trim()}`
      )
      .join("\n\n");
    return `Based on verified documentation:\n\n${excerpts}`;
  }

  return `Task completed: ${JSON.stringify(result)}`;
}

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

    const { userRequest, steps } = taskState;
    const availableToolNames = new Set(availableTools.map((t) => t.name));

    // If tools have already executed successfully in the previous step,
    // evaluate whether the task is complete.
    if (steps.length > 0) {
      const lastStep = steps[steps.length - 1];
      if (lastStep.status === "completed") {
        return {
          type: AGENT_ACTION_TYPES.FINAL,
          action: AGENT_ACTION_TYPES.FINAL,
          reason: `Successfully executed ${lastStep.toolName || lastStep.tool} and satisfied the user request.`,
          response: synthesizeFinalResponse(taskState),
        };
      }
      if (lastStep.status === "failed") {
        return {
          type: AGENT_ACTION_TYPES.FINAL,
          action: AGENT_ACTION_TYPES.FINAL,
          reason: `Tool execution failed: ${lastStep.output?.error || "Unknown error"}.`,
          response: `The task could not be completed because tool "${lastStep.toolName || lastStep.tool}" encountered an error: ${
            lastStep.output?.error || "Unknown failure"
          }`,
        };
      }
    }

    // Step 0: Initial planning based on user request

    // 1. Check for Calculation Intent
    if (MATH_KEYWORDS_REGEX.test(userRequest) && availableToolNames.has("calculator")) {
      const expression = extractMathExpression(userRequest);
      if (expression) {
        return {
          type: AGENT_ACTION_TYPES.TOOL,
          action: AGENT_ACTION_TYPES.TOOL,
          tool: "calculator",
          toolName: "calculator",
          reason: "The user requested a numerical calculation or rate computation.",
          input: { expression },
        };
      }
    }

    // 2. Check for Text Transformation Intent
    if (
      TEXT_TRANSFORM_REGEX.test(userRequest) &&
      availableToolNames.has("text_transform")
    ) {
      const extracted = extractTextTransform(userRequest);
      if (extracted) {
        return {
          type: AGENT_ACTION_TYPES.TOOL,
          action: AGENT_ACTION_TYPES.TOOL,
          tool: "text_transform",
          toolName: "text_transform",
          reason: `The user requested a deterministic "${extracted.operation}" text operation.`,
          input: extracted,
        };
      }
    }

    // 3. Check for Retrieval Intent
    if (
      RETRIEVAL_KEYWORDS_REGEX.test(userRequest) &&
      availableToolNames.has("retrieve_information")
    ) {
      return {
        type: AGENT_ACTION_TYPES.TOOL,
        action: AGENT_ACTION_TYPES.TOOL,
        tool: "retrieve_information",
        toolName: "retrieve_information",
        reason: "The user requested factual information from indexed organizational documents or manuals.",
        input: {
          query: userRequest,
          chatId: taskState.chatId,
          userId: taskState.userId,
          workspaceId: taskState.workspaceId,
        },
      };
    }

    // 4. Default: Conclude directly without tools if task is pure conversation/greetings
    return {
      type: AGENT_ACTION_TYPES.FINAL,
      action: AGENT_ACTION_TYPES.FINAL,
      reason: "No tool invocation required for this request.",
      response: `I have received your request: "${userRequest}". No additional tool execution is required.`,
    };
  }
}

export const agentPlannerService = new AgentPlannerService();
export default agentPlannerService;
