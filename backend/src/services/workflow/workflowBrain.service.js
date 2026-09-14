/**
 * Sovereign Workflow Brain Utilities (6 Controlled Industrial Workflows)
 *
 * System prompt, workflow classification, structured JSON output parsing,
 * and tool selection policy validation for the 6-Workflow Agent.
 *
 * GUARANTEES:
 * - 6 controlled industrial workflows:
 *     1. knowledge_retrieval (Qwen3 -> Retrieval -> Qwen3 -> Final)
 *     2. retrieval_calculation (Qwen3 -> Retrieval -> Qwen3 -> Calculator -> Qwen3 -> Final)
 *     3. vision_calculation (Qwen3 -> Vision -> Qwen3 -> Calculator -> Qwen3 -> Final)
 *     4. vision_knowledge (Qwen3 -> Vision -> Qwen3 -> Retrieval -> Qwen3 -> Final)
 *     5. coding_sandbox (Qwen3 -> Coding -> Sandbox -> Qwen3 -> Final, max 2 repairs)
 *     6. general (Fallback / multi-tool / direct answer)
 * - Reuses shared tool selection policies and formatting utilities from qwenBrain.service.js
 */

import { AGENT_ACTION_TYPES, WORKFLOW_TYPES } from "../agent/agent.types.js";
import {
  validateToolSelectionPolicy as baseValidateToolSelectionPolicy,
  formatAvailableTools,
  formatStepHistory,
  formatAccumulatedEvidence,
  formatReasoningState,
} from "../agent/qwenBrain.service.js";

/**
 * Workflow-specific tool selection policy.
 * Protects against unnecessary knowledge retrieval when values are already provided in the prompt.
 */
export function validateToolSelectionPolicy(decision, taskState = {}) {
  const userRequest = taskState.userRequest || "";
  const toolName = decision?.tool || decision?.toolName;

  const hasSuctionNumber = /\bsuction(?:\s+pressure)?(?:\s+of|\s*[:=])?\s*\d+(?:\.\d+)?/i.test(userRequest);
  const hasDischargeNumber = /\bdischarge(?:\s+pressure)?(?:\s+of|\s*[:=])?\s*\d+(?:\.\d+)?/i.test(userRequest);

  if (toolName === "calculator" && (decision?.workflow === WORKFLOW_TYPES.CALCULATION || (hasSuctionNumber && hasDischargeNumber))) {
    return { valid: true };
  }

  if (toolName === "retrieve_information" && hasSuctionNumber && hasDischargeNumber) {
    return {
      valid: false,
      reason: "All required values (suction and discharge pressures) are already present in the user request. Do not call retrieve_information; proceed directly to calculator.",
    };
  }

  return baseValidateToolSelectionPolicy(decision, taskState);
}

export const AGENT_BRAIN_MODEL = "qwen3:8b";

export const WORKFLOW_BRAIN_SYSTEM_PROMPT = `You are the decision-making brain of the Sovereign 6-Workflow Industrial Agent.
You do not execute tools yourself.
You can only request tools from the provided tool registry.
Return exactly one structured JSON action.
Return final when the task is complete or can be answered directly.
Never invent tools.
Never output hidden reasoning.

Six Controlled Industrial Workflows & Execution Patterns:
When planning the task, identify which execution pattern applies:
1. "knowledge_retrieval" (Workflow 1): Factual information from organizational Knowledge Base / documents only (Qwen3 -> Retrieval -> Qwen3 -> Final).
2. "retrieval_calculation" (Workflow 2): Factual values retrieved from Knowledge Base and subsequently calculated (Qwen3 -> Retrieval -> Qwen3 -> Calculator -> Qwen3 -> Final).
3. "vision_calculation" (Workflow 3): Numerical info extracted from an image and verified/calculated (Qwen3 -> Vision -> Qwen3 -> Calculator -> Qwen3 -> Final).
4. "vision_knowledge" (Workflow 4): Image analysis combined with organizational Knowledge Base information (Qwen3 -> Vision -> Qwen3 -> Retrieval -> Qwen3 -> Final).
5. "coding_sandbox" (Workflow 5): Code generation and container execution (Qwen3 -> Coding -> Sandbox -> Qwen3 -> Final, with max 2 repair attempts on execution failure).
6. "calculation": Direct arithmetic or formula calculation when all numeric values are already explicitly provided in the user request (Qwen3 -> Calculator -> Qwen3 -> Final).
7. "general" (Workflow 6): Fallback / dynamic multi-tool reasoning or direct conceptual explanation when no predefined workflow matches (Qwen3 -> dynamic tools / direct -> Final).

Workflow Selection Priority:
1. Does the task require code generation + execution? -> "coding_sandbox"
2. Does the task require image analysis + calculation? -> "vision_calculation"
3. Does the task require image analysis + organizational knowledge? -> "vision_knowledge"
4. Does the task require calculation where all numeric values are already provided in the request? -> "calculation" (use calculator directly; do NOT retrieve)
5. Does the task require Knowledge Base information + calculation? -> "retrieval_calculation"
6. Does the task require Knowledge Base information only? -> "knowledge_retrieval"
7. Otherwise -> "general" (fallback / existing agent loop)

Response Schema:
If a tool is needed:
{
  "workflow": "knowledge_retrieval" | "retrieval_calculation" | "vision_calculation" | "vision_knowledge" | "coding_sandbox" | "calculation" | "general",
  "action": "tool",
  "tool": "<registered_tool_name>",
  "reason": "<short 1-sentence reasoning for selecting this tool>",
  "input": { ... }
}

If task is complete or can be answered directly without tools:
{
  "workflow": "knowledge_retrieval" | "retrieval_calculation" | "vision_calculation" | "vision_knowledge" | "coding_sandbox" | "calculation" | "general",
  "action": "final",
  "reason": "<short 1-sentence summary of reasoning>",
  "answer": "<final answer for user with citations and calculation steps>"
}

TOOL SELECTION AND MULTI-TOOL POLICY:
1. GENERAL TOOL SELECTION:
   - Determine whether the task requires one or more tools.
   - The workflow system supports multiple sequential tool/workflow executions when required.
   - Use the minimum number of tools necessary, but never skip a required tool.

2. RETRIEVAL (retrieve_information):
   - Use when information must be fetched from the organizational knowledge base.
   - Do not retrieve unnecessarily when all required information is already provided by the user.

3. CALCULATOR (calculator):
   - Whenever arithmetic or formulas are needed, use the Calculator tool. Do not do mental math.
   - Provide only mathematical expressions in 'expression'.

4. UNIT CONVERTER (unit_converter):
   - Use for physical unit conversions.

5. VISION (vision):
   - Extract readings/values from provided images.

6. CODING & SANDBOX (coding, execute_code):
   - Generate code and run it inside the isolated sandbox. Repair on failure (max 2 repairs).`;

/**
 * Analyze actual task requirements to determine if data is already available
 * or if a direct calculation or specific workflow path should be selected.
 *
 * For example:
 * "According to the retrieved equipment data, the pump has a suction pressure of 2.4 bar and a discharge pressure of 7.8 bar. What is the pressure differential across the pump?"
 *
 * Detects:
 *   suction = 2.4 bar
 *   discharge = 7.8 bar
 *   operation = subtraction
 *
 * Workflow: calculation
 * Tool: calculator (7.8 - 2.4)
 */
export function analyzeTaskRequirements(userRequest = "") {
  const req = (userRequest || "").trim();
  if (!req) return null;

  // Pattern 1: Suction and discharge pressures present with differential/calculation request
  const suctionMatch = req.match(/\bsuction(?:\s+pressure)?(?:\s+of|\s*[:=])?\s*(\d+(?:\.\d+)?)\s*([a-zA-Z%]+)?/i);
  const dischargeMatch = req.match(/\bdischarge(?:\s+pressure)?(?:\s+of|\s*[:=])?\s*(\d+(?:\.\d+)?)\s*([a-zA-Z%]+)?/i);

  const hasDifferentialOrMath =
    /\b(differential|difference|diff|delta|subtraction|subtract|calculate|computation|compute|math)\b/i.test(req) ||
    req.includes("-");

  if (suctionMatch && dischargeMatch && hasDifferentialOrMath) {
    const suctionVal = suctionMatch[1];
    const suctionUnit = suctionMatch[2] || "bar";
    const dischargeVal = dischargeMatch[1];
    const dischargeUnit = dischargeMatch[2] || "bar";

    const detectLines = [
      "→ Detect:",
      `suction = ${suctionVal} ${suctionUnit}`,
      `discharge = ${dischargeVal} ${dischargeUnit}`,
      "operation = subtraction",
    ];

    return {
      workflow: WORKFLOW_TYPES.CALCULATION,
      firstTool: "calculator",
      expression: `${dischargeVal} - ${suctionVal}`,
      detectionSummary: detectLines.join("\n"),
      detectedValues: {
        suction: `${suctionVal} ${suctionUnit}`,
        discharge: `${dischargeVal} ${dischargeUnit}`,
        operation: "subtraction",
      },
      skipRetrieval: true,
      reason: `Direct calculation of pressure differential using provided suction (${suctionVal} ${suctionUnit}) and discharge (${dischargeVal} ${dischargeUnit}) values.`,
    };
  }

  // Pattern 2: Explicit arithmetic expression provided in request (e.g. "What is 25 * 40?")
  const pureMathMatch = req.match(/^\s*(?:calculate|what is|compute)?\s*(\d+(?:\.\d+)?\s*[\+\-\*\/\^%]\s*\d+(?:\.\d+)?)\s*\??\s*$/i);
  if (pureMathMatch) {
    return {
      workflow: WORKFLOW_TYPES.CALCULATION,
      firstTool: "calculator",
      expression: pureMathMatch[1].trim(),
      detectionSummary: `→ Detect:\noperation = ${pureMathMatch[1].trim()}`,
      skipRetrieval: true,
      reason: `Direct mathematical calculation of expression: ${pureMathMatch[1].trim()}`,
    };
  }

  return null;
}

/**
 * Dynamically determine and refine the active workflow type.
 */
export function determineWorkflow({ userRequest = "", steps = [], images = [], brainWorkflow = null, nextTool = null } = {}) {
  const validWorkflows = Object.values(WORKFLOW_TYPES);
  const explicit = typeof brainWorkflow === "string" && validWorkflows.includes(brainWorkflow.trim().toLowerCase())
    ? brainWorkflow.trim().toLowerCase()
    : null;

  const allTools = steps.map((s) => s.toolName || s.tool).concat(nextTool ? [nextTool] : []);
  const hasCoding = allTools.includes("coding") || allTools.includes("execute_code");
  const hasVision = allTools.includes("vision") || (Array.isArray(images) && images.length > 0);
  const hasRetrieval = allTools.includes("retrieve_information");
  const hasCalc = allTools.includes("calculator");

  // Check task analysis on initial step or if no tools executed yet
  if (!hasRetrieval && !hasVision && !hasCoding) {
    const analysis = analyzeTaskRequirements(userRequest);
    if (analysis && analysis.workflow && (!explicit || explicit === WORKFLOW_TYPES.GENERAL || explicit === WORKFLOW_TYPES.CALCULATION)) {
      return analysis.workflow;
    }
  }

  // If explicit matches a specific workflow pattern, prioritize it unless step progression refines it
  if (hasCoding) {
    return WORKFLOW_TYPES.CODING_SANDBOX;
  }

  if (hasVision && hasCalc) {
    return WORKFLOW_TYPES.VISION_CALCULATION;
  }

  if (hasVision && hasRetrieval) {
    return WORKFLOW_TYPES.VISION_KNOWLEDGE;
  }

  if (hasRetrieval && hasCalc) {
    return WORKFLOW_TYPES.RETRIEVAL_CALCULATION;
  }

  if (explicit && explicit !== WORKFLOW_TYPES.GENERAL) {
    return explicit;
  }

  if (hasRetrieval) {
    const hasMathIntent = /(\d+\s*[\+\-\*\/\^%]\s*\d+)|(\b(calculate|computation|compute|math|sum|difference|differential|diff|multiply|divide|percentage|percent|formula|equation)\b)/i.test(userRequest);
    if (hasMathIntent) {
      return WORKFLOW_TYPES.RETRIEVAL_CALCULATION;
    }
    return WORKFLOW_TYPES.KNOWLEDGE_RETRIEVAL;
  }

  if (hasCalc && !hasRetrieval && !hasVision && !hasCoding) {
    return explicit || WORKFLOW_TYPES.CALCULATION;
  }

  if (explicit) {
    return explicit;
  }

  return WORKFLOW_TYPES.GENERAL;
}

/**
 * Parse structured JSON output from Qwen3 for Workflow Agent.
 */
export function parseWorkflowBrainOutput(rawOutput) {
  if (!rawOutput || typeof rawOutput !== "string") {
    return {
      valid: false,
      error: "Empty response received from agent brain.",
    };
  }

  let cleaned = rawOutput
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();

  const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonBlockMatch) {
    cleaned = jsonBlockMatch[1].trim();
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (_firstErr) {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const extracted = cleaned.slice(firstBrace, lastBrace + 1);
      try {
        parsed = JSON.parse(extracted);
      } catch (secondErr) {
        return {
          valid: false,
          error: `Failed to parse structured JSON from agent brain: ${secondErr.message}`,
          rawOutput,
        };
      }
    } else {
      return {
        valid: false,
        error: "Agent brain response did not contain a valid JSON object.",
        rawOutput,
      };
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      valid: false,
      error: "Brain output must be a JSON object with 'action' field.",
      rawOutput,
    };
  }

  const action = typeof parsed.action === "string" ? parsed.action.trim().toLowerCase() : null;
  if (!action || (action !== AGENT_ACTION_TYPES.TOOL && action !== AGENT_ACTION_TYPES.FINAL)) {
    return {
      valid: false,
      error: `Invalid action '${parsed.action}'. Must be '${AGENT_ACTION_TYPES.TOOL}' or '${AGENT_ACTION_TYPES.FINAL}'.`,
      rawOutput,
    };
  }

  const validWorkflows = Object.values(WORKFLOW_TYPES);
  let workflowType =
    typeof parsed.workflow === "string" && validWorkflows.includes(parsed.workflow.trim().toLowerCase())
      ? parsed.workflow.trim().toLowerCase()
      : null;

  if (action === AGENT_ACTION_TYPES.TOOL) {
    const toolName = parsed.tool || parsed.toolName;
    if (!toolName || typeof toolName !== "string" || !toolName.trim()) {
      return {
        valid: false,
        error: "Tool action requires a valid 'tool' string specifying registered capability.",
        rawOutput,
      };
    }

    const input =
      parsed.input !== undefined && parsed.input !== null && typeof parsed.input === "object" && !Array.isArray(parsed.input)
        ? parsed.input
        : {};

    const actionReason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : `Executing tool: ${toolName.trim()}`;

    return {
      valid: true,
      decision: {
        action: AGENT_ACTION_TYPES.TOOL,
        type: AGENT_ACTION_TYPES.TOOL,
        workflow: workflowType,
        tool: toolName.trim(),
        toolName: toolName.trim(),
        input,
        reason: actionReason,
      },
    };
  }

  // Final action
  const answer =
    typeof parsed.answer === "string"
      ? parsed.answer.trim()
      : typeof parsed.response === "string"
      ? parsed.response.trim()
      : "";

  const finalReason =
    typeof parsed.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim()
      : "Synthesized final answer from retrieved information.";

  return {
    valid: true,
    decision: {
      action: AGENT_ACTION_TYPES.FINAL,
      type: AGENT_ACTION_TYPES.FINAL,
      workflow: workflowType || WORKFLOW_TYPES.GENERAL,
      answer,
      response: answer,
      reason: finalReason,
    },
  };
}

export {
  formatAvailableTools,
  formatStepHistory,
  formatAccumulatedEvidence,
  formatReasoningState,
};

export default {
  AGENT_BRAIN_MODEL,
  WORKFLOW_BRAIN_SYSTEM_PROMPT,
  analyzeTaskRequirements,
  determineWorkflow,
  parseWorkflowBrainOutput,
  validateToolSelectionPolicy,
  formatAvailableTools,
  formatStepHistory,
  formatAccumulatedEvidence,
  formatReasoningState,
};
