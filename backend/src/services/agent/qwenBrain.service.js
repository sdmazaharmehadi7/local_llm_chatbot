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
Choose a tool ONLY when strictly necessary.
Return final when the task is complete or can be answered directly.
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

Strict Agent Tool Selection Policy:
1. MINIMAL TOOL USAGE: Use the minimum number of tools strictly necessary. If a question can be answered using general knowledge, conversational response, or already observed context, return "final" immediately without calling any tools.
2. NO UNRELATED TOOL CALLS: Do not call a tool simply because it is available. Never call calculator or text_transform on questions that do not specifically require them.
3. RETRIEVAL POLICY: Call "retrieve_information" when the user asks about specific documents, files, manuals, SOPs, policies, procedures, regulations, safety requirements, or domain facts that must be looked up.
4. CALCULATOR POLICY: Call "calculator" ONLY when explicit mathematical computation or arithmetic evaluation is required (e.g. +, -, *, /, %, equations, formulas, or computing numbers from retrieved data). Do NOT call calculator for non-mathematical, text, or document questions.
5. TEXT TRANSFORM POLICY: Call "text_transform" ONLY when the user explicitly requests text formatting or manipulation (e.g. uppercase, lowercase, word count, character count, reverse, trim). Do NOT call text_transform to answer questions or process queries.
6. MULTI-STEP ORDER: When a request requires both document information and mathematical calculation, FIRST retrieve the necessary data using "retrieve_information", observe the result, and THEN call "calculator" on the retrieved numbers. Never invert this order.

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
      const lines = [`- Tool: "${t.name}"`];
      if (t.purpose) {
        lines.push(`  Purpose: ${t.purpose}`);
      } else if (t.description) {
        lines.push(`  Purpose: ${t.description}`);
      }
      if (t.whenToUse) {
        lines.push(`  When to Use: ${t.whenToUse}`);
      }
      if (t.whenNotToUse) {
        lines.push(`  When NOT to Use: ${t.whenNotToUse}`);
      }
      lines.push(`  Parameters: ${JSON.stringify(props)}`);
      lines.push(`  Required: ${JSON.stringify(req)}`);
      return lines.join("\n");
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

/**
 * Validate that a proposed tool decision complies with the Agent Tool Selection Policy.
 * Prevents unnecessary tool calls (e.g. calculator or text_transform on document questions).
 *
 * @param {object} decision - Proposed decision { action, tool, input, ... }
 * @param {object} taskState - Current task state including userRequest and steps
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateToolSelectionPolicy(decision, taskState = {}) {
  if (!decision || decision.action !== AGENT_ACTION_TYPES.TOOL) {
    return { valid: true };
  }

  const toolName = decision.tool || decision.toolName;
  const userRequest = (taskState.userRequest || "").trim();
  const steps = taskState.steps || [];

  const isDocumentQuestion =
    /\b(document|documents|file|files|pdf|sop|manual|manuals|policy|policies|procedure|procedures|regulation|regulations|safety requirement|safety requirements|prv|cdu|crude distillation|valve|inspection interval|acceptance criteria)\b/i.test(
      userRequest
    );

  // 1. DOCUMENT / RETRIEVAL POLICY:
  // For queries asking about documents, files, SOPs, manuals, policies, or safety requirements:
  // retrieve_information must be called first; unrelated tools (calculator or text_transform) must not precede retrieval.
  if (steps.length === 0 && isDocumentQuestion && (toolName === "calculator" || toolName === "text_transform")) {
    return {
      valid: false,
      reason: `For document queries, retrieve_information must be used first to gather context before calling other tools.`,
    };
  }

  // 2. TEXT TRANSFORM POLICY:
  // Do not call text_transform unless user explicitly requested text formatting or manipulation
  if (toolName === "text_transform") {
    const hasExplicitTransformRequest =
      /\b(uppercase|upper case|lowercase|lower case|capital|all caps|capitalize|word count|count words|character count|char count|count characters|reverse text|reverse string|reverse the|trim whitespace|trim text)\b/i.test(
        userRequest
      );

    if (!hasExplicitTransformRequest) {
      return {
        valid: false,
        reason: `text_transform cannot be called because the user did not explicitly request text formatting or transformation.`,
      };
    }
  }

  // 3. CALCULATOR POLICY:
  // Do not call calculator unless arithmetic computation is required
  if (toolName === "calculator") {
    const hasMathInRequest =
      /(\d+\s*[\+\-\*\/\^%]\s*\d+)|(\b(calculate|computation|compute|math|sum|difference|multiply|multiplication|divide|division|arithmetic|percentage|percent|formula|equation|sqrt|blowdown|tolerance|deviation|calc|count|increment)\b)/i.test(
        userRequest
      );

    const hasMathInInput =
      typeof decision.input?.expression === "string" &&
      /(\d+\s*[\+\-\*\/\^%]\s*\d+)|(sqrt|abs|round|floor|ceil|min|max|pow)/i.test(decision.input.expression);

    const hasMathFromObservation = steps.length > 0;

    if (!hasMathInRequest && !hasMathInInput && !hasMathFromObservation) {
      return {
        valid: false,
        reason: `Calculator cannot be called because the request does not require mathematical calculation.`,
      };
    }
  }

  return { valid: true };
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

      let decision = parseResult.decision;

      // 3. Enforce Agent Tool Selection Policy (prevent unnecessary tool calls)
      const policyCheck = validateToolSelectionPolicy(decision, taskState);
      if (!policyCheck.valid) {
        console.warn(`[agent] Tool policy violation (${policyCheck.reason}). Retrying with policy correction prompt...`);
        const policyMessages = [
          ...messages,
          { role: "assistant", content: rawOutput || "" },
          {
            role: "user",
            content: `Error: Tool policy violation - ${policyCheck.reason}. As per Agent Tool Selection Policy:
1. Use the minimum number of tools strictly necessary.
2. Do not call calculator unless arithmetic is required.
3. Do not call text_transform unless user explicitly requested text transformation.
4. Use retrieve_information when document knowledge or external facts are needed.
5. If no tool is needed, return final directly.
Please return ONLY the correct valid JSON action.`,
          },
        ];

        try {
          rawOutput = await this._callLlm(policyMessages);
        } catch {
          if (typeof this.brainLlmClient !== "function") {
            rawOutput = await sendChatToOllama(policyMessages, AGENT_BRAIN_MODEL, {
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

        const repairedResult = parseBrainOutput(rawOutput);
        if (repairedResult.valid) {
          const repairedPolicy = validateToolSelectionPolicy(repairedResult.decision, taskState);
          if (repairedPolicy.valid) {
            decision = repairedResult.decision;
          }
        }

        // Safe fallback if model still failed policy validation after retry:
        const finalPolicyCheck = validateToolSelectionPolicy(decision, taskState);
        if (!finalPolicyCheck.valid) {
          const isDocQuestion = /\b(document|documents|file|files|pdf|sop|manual|manuals|policy|policies|procedure|procedures|regulation|regulations|safety requirement|safety requirements|prv|cdu|crude distillation|valve)\b/i.test(userRequest);
          if (isDocQuestion && steps.length === 0) {
            console.warn(`[agent] Overriding policy-violating tool with retrieve_information for document question.`);
            decision = {
              action: AGENT_ACTION_TYPES.TOOL,
              type: AGENT_ACTION_TYPES.TOOL,
              tool: "retrieve_information",
              toolName: "retrieve_information",
              input: { query: userRequest },
              reason: `Retrieving relevant document context for: "${userRequest}".`,
            };
          } else if (decision.tool === "calculator" || decision.tool === "text_transform") {
            console.warn(`[agent] Overriding unnecessary tool call with final action.`);
            decision = {
              action: AGENT_ACTION_TYPES.FINAL,
              type: AGENT_ACTION_TYPES.FINAL,
              answer: `I am ready to assist with your question: "${userRequest}".`,
              response: `I am ready to assist with your question: "${userRequest}".`,
              reason: `No tools required for this request.`,
            };
          }
        }
      }

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
