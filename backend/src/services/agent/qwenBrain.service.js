/**
 * Qwen3:8b Agent Brain Service
 *
 * Real LLM decision-making brain for the SIH 26117 Sovereign Local AI Workbench.
 *
 * GUARANTEES & PRINCIPLES:
 * - Sovereign decision engine powered explicitly by local Qwen3:8b.
 * - NEVER executes tools directly (Brain only decides; Executor validates & executes).
 * - Enforces strict structured JSON outputs: { action: "tool", ... } or { action: "final", ... }.
 * - Safe structured-output parser strips markdown fences and hidden thinking tokens.
 * - Single-turn correction retry for malformed JSON outputs before safe error fallback.
 * - Lightweight bounded context optimized for Apple Silicon (16 GB M2 Mac).
 * - Never spawns or starts Ollama processes; relies on external Ollama service abstraction.
 */

import { AGENT_ACTION_TYPES, AGENT_LIMITS } from "./agent.types.js";
import { sendChatToOllama } from "../ollama.service.js";

export const AGENT_BRAIN_MODEL = "qwen3:8b";

export const AGENT_BRAIN_SYSTEM_PROMPT = `You are the decision-making brain of a local agentic AI system.
You do not execute tools yourself.
You can only request tools from the provided tool registry.
Return exactly one structured JSON action.
Choose a tool when an action is required.
Return final when the task is complete.
Never invent tools.
Never output hidden reasoning.

Response Schema:
If a tool is needed:
{
  "action": "tool",
  "tool": "<registered_tool_name>",
  "reason": "<short 1-sentence reasoning for selecting this tool>",
  "input": { ... }
}

If task is complete or can be answered directly without tools:
{
  "action": "final",
  "reason": "<short 1-sentence summary of reasoning>",
  "answer": "<final answer for user>"
}

Strict Constraints:
1. Return ONLY the raw JSON object. Never include markdown code fences, comments, or thinking tags.
2. action must be either "tool" or "final".
3. The tool name MUST be one of the registered tools provided in the prompt.
4. Input arguments must strictly adhere to the tool's schema.
5. Never execute or invent shell, filesystem, or network commands.`;

/**
 * Format registered tools into a compact specification string.
 *
 * @param {Array<object>} tools
 * @returns {string}
 */
export function formatAvailableTools(tools = []) {
  if (!Array.isArray(tools) || tools.length === 0) {
    return "No tools available.";
  }

  return tools
    .map((t) => {
      const schema = t.inputSchema || t.schema || {};
      const props = schema.properties || {};
      const req = schema.required || [];
      return `- Tool: "${t.name}"
  Description: ${t.description || "No description provided."}
  Parameters: ${JSON.stringify(props)}
  Required: ${JSON.stringify(req)}`;
    })
    .join("\n\n");
}

/**
 * Format previous execution steps into compact observation records.
 *
 * @param {Array<object>} steps
 * @returns {string}
 */
export function formatStepHistory(steps = []) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return "None (this is step 1).";
  }

  return steps
    .map((s, idx) => {
      let obs = s.observation;
      if (obs === undefined || obs === null) {
        obs = s.output?.result !== undefined ? s.output.result : s.output?.error;
      }
      const obsStr = typeof obs === "object" ? JSON.stringify(obs) : String(obs || "No output");
      // Bound each observation to 1000 characters to prevent memory blowup on 16GB Mac
      const boundedObs = obsStr.length > 1000 ? `${obsStr.slice(0, 1000)}... [truncated]` : obsStr;
      const statusText = s.status === "failed" ? " [FAILED]" : "";

      return `Step ${idx + 1}:
  Action: Called tool "${s.toolName || s.tool}" with input ${JSON.stringify(s.input || {})}
  Observation${statusText}: ${boundedObs}`;
    })
    .join("\n\n");
}

/**
 * Safely parse and validate structured JSON returned by Qwen3:8b.
 * Strips thinking tokens, markdown fences, and isolates the JSON object.
 *
 * @param {string} rawOutput
 * @returns {{ valid: boolean, decision?: object, error?: string, raw?: string }}
 */
export function parseBrainOutput(rawOutput) {
  if (!rawOutput || typeof rawOutput !== "string") {
    return { valid: false, error: "Empty or non-string output received from model.", raw: rawOutput };
  }

  let text = rawOutput.trim();

  // Strip Qwen3 <think>...</think> reasoning tags if present
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  } else {
    // If not fenced, extract the outer JSON object {...}
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      text = text.substring(firstBrace, lastBrace + 1).trim();
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { valid: false, error: `JSON parse error: ${err.message}`, raw: rawOutput };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { valid: false, error: "Model response must be a JSON object.", raw: rawOutput };
  }

  // Validate action
  const action = parsed.action;
  if (action !== "tool" && action !== "final") {
    return {
      valid: false,
      error: `Invalid action "${action}". Expected "tool" or "final".`,
      raw: rawOutput,
    };
  }

  // Handle TOOL action
  if (action === "tool") {
    const toolName = parsed.tool || parsed.toolName;
    if (!toolName || typeof toolName !== "string" || !toolName.trim()) {
      return { valid: false, error: 'Missing or invalid "tool" name.', raw: rawOutput };
    }

    const input = parsed.input !== undefined && parsed.input !== null ? parsed.input : {};
    if (typeof input !== "object" || Array.isArray(input)) {
      return { valid: false, error: 'Tool "input" must be an object.', raw: rawOutput };
    }

    const toolReason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : `Executing tool: ${toolName.trim()}`;

    return {
      valid: true,
      decision: {
        action: AGENT_ACTION_TYPES.TOOL,
        type: AGENT_ACTION_TYPES.TOOL,
        tool: toolName.trim(),
        toolName: toolName.trim(),
        input,
        reason: toolReason,
      },
    };
  }

  // Handle FINAL action
  if (action === "final") {
    const answer =
      typeof parsed.answer === "string"
        ? parsed.answer
        : typeof parsed.response === "string"
        ? parsed.response
        : parsed.answer !== undefined
        ? JSON.stringify(parsed.answer)
        : "Task completed.";

    const finalReason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim()
        : "Task completed.";

    return {
      valid: true,
      decision: {
        action: AGENT_ACTION_TYPES.FINAL,
        type: AGENT_ACTION_TYPES.FINAL,
        answer,
        response: answer,
        reason: finalReason,
      },
    };
  }

  return { valid: false, error: "Unrecognized response format.", raw: rawOutput };
}

class QwenBrainService {
  constructor() {
    this.brainLlmClient = null; // Mock hook for automated tests
  }

  /**
   * Set custom LLM client function for testing without Ollama inference.
   * @param {Function} clientFn
   */
  setBrainLlmClient(clientFn) {
    this.brainLlmClient = clientFn;
  }

  /**
   * Reset custom LLM client back to live Ollama inference.
   */
  resetBrainLlmClient() {
    this.brainLlmClient = null;
  }

  /**
   * Call the underlying LLM (or mock client).
   *
   * @param {Array<{role: string, content: string}>} messages
   * @returns {Promise<string>}
   */
  async _callLlm(messages) {
    if (typeof this.brainLlmClient === "function") {
      return this.brainLlmClient(messages);
    }

    return sendChatToOllama(messages, AGENT_BRAIN_MODEL, {
      format: "json",
      think: false,
      options: {
        temperature: 0.1,
        num_predict: 2048,
        think: false,
      },
      timeoutMs: 120_000,
    });
  }

  /**
   * Decide the next structured action for an Agent task using Qwen3:8b.
   *
   * @param {object} params
   * @param {object} params.taskState - Current state of the task
   * @param {Array<object>} params.availableTools - Registered tools metadata
   * @returns {Promise<{
   *   action: "tool"|"final"|"error",
   *   type: "tool"|"final"|"error",
   *   tool?: string,
   *   toolName?: string,
   *   input?: object,
   *   answer?: string,
   *   response?: string,
   *   reason: string
   * }>}
   */
  async decideNextStep({ taskState, availableTools = [] }) {
    const userRequest = taskState.userRequest || "";
    const steps = taskState.steps || [];
    const currentStepNum = steps.length + 1;
    const maxSteps = AGENT_LIMITS.MAX_AGENT_STEPS || 8;

    const formattedTools = formatAvailableTools(availableTools);
    const formattedHistory = formatStepHistory(steps);

    const promptContent = `User Request: "${userRequest}"

Available Tools:
${formattedTools}

Execution History:
${formattedHistory}

Current Step: ${currentStepNum} of ${maxSteps}

Decide the next action. Return ONLY a single JSON object.`;

    const messages = [
      { role: "system", content: AGENT_BRAIN_SYSTEM_PROMPT },
      { role: "user", content: promptContent },
    ];

    try {
      // 1. Initial LLM generation with fallback if grammar constraint causes issue
      let rawOutput;
      try {
        rawOutput = await this._callLlm(messages);
      } catch (callErr) {
        if (typeof this.brainLlmClient === "function") {
          throw callErr;
        }
        console.warn(`[agent] Primary JSON-formatted call failed (${callErr.message}). Retrying without format constraint...`);
        rawOutput = await sendChatToOllama(messages, AGENT_BRAIN_MODEL, {
          think: false,
          options: {
            temperature: 0.1,
            num_predict: 2048,
            think: false,
          },
          timeoutMs: 120_000,
        });
      }

      let parseResult = parseBrainOutput(rawOutput);

      // 2. Single-turn correction retry if initial output was malformed
      if (!parseResult.valid) {
        console.warn(`[agent] Qwen3 output malformed (${parseResult.error}). Retrying with correction prompt...`);
        const correctionMessages = [
          ...messages,
          { role: "assistant", content: rawOutput || "" },
          {
            role: "user",
            content: `Error: ${parseResult.error}. Please return ONLY a valid JSON object matching the schema: {"action": "tool", "tool": "...", "input": {...}} OR {"action": "final", "answer": "..."}. No markdown, no explanation.`,
          },
        ];

        try {
          rawOutput = await this._callLlm(correctionMessages);
        } catch {
          if (typeof this.brainLlmClient !== "function") {
            rawOutput = await sendChatToOllama(correctionMessages, AGENT_BRAIN_MODEL, {
              think: false,
              options: {
                temperature: 0.1,
                num_predict: 2048,
                think: false,
              },
              timeoutMs: 120_000,
            });
          }
        }
        parseResult = parseBrainOutput(rawOutput);
      }

      if (!parseResult.valid) {
        return {
          action: AGENT_ACTION_TYPES.ERROR,
          type: AGENT_ACTION_TYPES.ERROR,
          reason: `Agent brain failed to produce valid structured JSON: ${parseResult.error}`,
        };
      }

      const decision = parseResult.decision;

      // Ensure caller context identifiers from taskState are securely attached to retrieve_information
      if (decision.action === AGENT_ACTION_TYPES.TOOL && decision.tool === "retrieve_information" && taskState) {
        if (taskState.chatId && !decision.input.chatId) decision.input.chatId = taskState.chatId;
        if (taskState.userId && !decision.input.userId) decision.input.userId = taskState.userId;
        if (taskState.workspaceId && !decision.input.workspaceId) decision.input.workspaceId = taskState.workspaceId;
      }

      return decision;
    } catch (err) {
      return {
        action: AGENT_ACTION_TYPES.ERROR,
        type: AGENT_ACTION_TYPES.ERROR,
        reason: err.message || "Failed to communicate with Qwen3:8b agent brain.",
      };
    }
  }
}

export const qwenBrainService = new QwenBrainService();
export default qwenBrainService;
