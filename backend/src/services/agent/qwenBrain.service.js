/**
 * Qwen3:8b Brain Utilities
 *
 * Provides system prompts, formatting, structured JSON output parsing,
 * and tool selection policy validation for the sovereign LangGraph agent.
 *
 * GUARANTEES:
 * - Powered explicitly by local Qwen3:8b via Ollama
 * - Safe structured-output parser strips markdown fences and hidden thinking tokens (<think>)
 * - Single-turn correction retry for malformed JSON outputs
 * - Tool selection policy prevents unnecessary tool invocations (calculator/retrieval/transform)
 * - Zero cloud LLMs, zero telemetry
 */

import { AGENT_ACTION_TYPES } from "./agent.types.js";

export const AGENT_BRAIN_MODEL = "qwen3:8b";

export const AGENT_BRAIN_SYSTEM_PROMPT = `You are the decision-making brain of a local sovereign agentic AI system.
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
3. RETRIEVAL POLICY: Call "retrieve_information" when the user asks about specific documents, files, manuals, SOPs, policies, procedures, regulations, safety requirements, or domain facts that must be looked up in the Knowledge Base or chat attachments. Do NOT call retrieve_information for general conversational questions, system identity or purpose questions (e.g. "What is the purpose of this system?"), or standard math/text tasks.
4. CALCULATOR POLICY: Call "calculator" ONLY when explicit mathematical computation or arithmetic evaluation is required (e.g. +, -, *, /, %, equations, formulas, or computing numbers from retrieved data). Do NOT call calculator for non-mathematical, text, or document questions.
5. TEXT TRANSFORM POLICY: Call "text_transform" ONLY when the user explicitly requests text formatting or manipulation (e.g. uppercase, lowercase, word count, character count, reverse, trim). Do NOT call text_transform to answer questions or process queries.
6. CODING POLICY: Call "coding" ONLY when the user explicitly requests writing, implementing, generating, refactoring, or debugging code or software functions (e.g. "Write a Java function to reverse a string", "Implement binary search in Python", "Debug this script"). Do NOT call "coding" for general, conceptual, architectural, or definition questions (e.g. "Explain what an API is", "What is OOP?"), general questions, arithmetic, or document retrieval.
7. MULTI-STEP ORDER: When a request requires both document information and mathematical calculation, FIRST retrieve the necessary data using "retrieve_information", observe the result, and THEN call "calculator" on the retrieved numbers. Never invert this order.

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
      lines.push(`  Parameters: ${JSON.stringify(props)}`);
      if (req.length > 0) {
        lines.push(`  Required: ${JSON.stringify(req)}`);
      }
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
      const toolName = s.toolName || s.tool;
      let obs = s.observation;
      if (obs === undefined || obs === null) {
        obs = s.output?.result !== undefined ? s.output.result : s.output?.error;
      }
      const statusText = s.status === "failed" ? " [FAILED]" : "";

      // Format retrieval observations with explicit document sources, page numbers, and similarity
      if (toolName === "retrieve_information" && typeof obs === "object" && obs !== null) {
        const results = Array.isArray(obs.results) ? obs.results : [];
        const sources = Array.isArray(obs.sources) ? obs.sources : [];
        const excerpts = [];

        if (results.length > 0) {
          for (const r of results) {
            const scoreStr = typeof r.score === "number" ? ` (similarity: ${r.score.toFixed(2)})` : "";
            const header = `[Document: ${r.filename || r.sourceName || "Document"}, Page: ${r.page || 1}${scoreStr}]`;
            excerpts.push(`${header}\n${r.text || ""}`);
          }
        } else if (obs.content) {
          excerpts.push(obs.content);
        }

        const sourceSummary = sources.length > 0
          ? `\n  Sources: ${sources.map((src) => `${src.filename || src.name} (p. ${src.page || 1})`).join(", ")}`
          : "";

        const joinedExcerpts = excerpts.length > 0
          ? excerpts.join("\n\n---\n\n")
          : "No relevant documents found matching query.";

        const boundedExcerpts =
          joinedExcerpts.length > 3500 ? `${joinedExcerpts.slice(0, 3500)}... [truncated]` : joinedExcerpts;

        return `Step ${idx + 1}:
  Action: Called tool "retrieve_information" with input ${JSON.stringify(s.input || {})}
  Observation${statusText}: Retrieved ${results.length || sources.length} relevant excerpts${sourceSummary}
${boundedExcerpts}`;
      }

      // Format coding tool observations
      if (toolName === "coding" && typeof obs === "object" && obs !== null) {
        const lang = obs.language || "code";
        const code = obs.code || "";
        const boundedCode = code.length > 3500 ? `${code.slice(0, 3500)}... [truncated]` : code;
        return `Step ${idx + 1}:
  Action: Called tool "coding" (Qwen2.5-Coder) for task: ${JSON.stringify(s.input?.task || s.input || {})}
  Observation${statusText}: Generated ${lang} solution:
${boundedCode}`;
      }

      const obsStr = typeof obs === "object" ? JSON.stringify(obs) : String(obs || "No output");
      const boundedObs = obsStr.length > 1000 ? `${obsStr.slice(0, 1000)}... [truncated]` : obsStr;

      return `Step ${idx + 1}:
  Action: Called tool "${toolName}" with input ${JSON.stringify(s.input || {})}
  Observation${statusText}: ${boundedObs}`;
    })
    .join("\n\n");
}

/**
 * Safely parse and validate structured JSON returned by Qwen3:8b.
 * Strips thinking tokens (<think>), markdown fences, and isolates the JSON object.
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

  let parsed = null;

  // 1. Try parsing directly in case it is already valid JSON
  try {
    const directParsed = JSON.parse(text);
    if (directParsed && typeof directParsed === "object" && !Array.isArray(directParsed)) {
      parsed = directParsed;
    }
  } catch {
    // Not directly valid JSON, attempt cleanup
  }

  // 2. If not already parsed, handle markdown code fence wrappers or outer text
  if (!parsed) {
    if (/^\s*```(?:json)?/i.test(text)) {
      const fenceMatch = text.match(/^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i);
      if (fenceMatch) {
        text = fenceMatch[1].trim();
      }
    } else {
      const firstBrace = text.indexOf("{");
      const lastBrace = text.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        text = text.substring(firstBrace, lastBrace + 1).trim();
      }
    }

    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { valid: false, error: `JSON parse error: ${err.message}`, raw: rawOutput };
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { valid: false, error: "Model response must be a JSON object.", raw: rawOutput };
  }

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
  if (steps.length === 0 && isDocumentQuestion && (toolName === "calculator" || toolName === "text_transform" || toolName === "coding")) {
    return {
      valid: false,
      reason: `For document queries, retrieve_information must be used first to gather context before calling other tools.`,
    };
  }

  // 2. TEXT TRANSFORM POLICY:
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

  // 4. RETRIEVAL POLICY GUARD:
  if (toolName === "retrieve_information") {
    // Normal chat / conversational questions must NOT trigger retrieval unless document context is asked
    const isGeneralConversational =
      /^(hi|hello|hey|greetings|how are you|who are you|what can you do|what is the purpose of this system|what is this system|tell me a joke)\b/i.test(
        userRequest
      );
    const mentionsDocumentsOrFiles =
      /\b(document|documents|file|files|pdf|kb|knowledge|sop|manual|manuals|policy|policies|guideline|guidelines|procedure|procedures|regulation|regulations|safety requirement|safety requirements|prv|cdu)\b/i.test(
        userRequest
      );

    if (isGeneralConversational && !mentionsDocumentsOrFiles) {
      return {
        valid: false,
        reason: `retrieve_information is not needed for general conversational or system identity questions when no document context is requested.`,
      };
    }
  }

  // 5. CODING POLICY GUARD:
  if (toolName === "coding") {
    // Normal / conceptual questions must NOT invoke the coding tool (e.g. "Explain what an API is")
    const isConceptualOrExplanation =
      /^(explain|what is|what are|what does|how does|why is|difference between|overview of|define)\b/i.test(
        userRequest
      );
    const hasExplicitCodeGenerationIntent =
      /\b(write|create|implement|generate|code|function|script|class|method|snippet|algorithm|debug|refactor|fix code|compile|syntax)\b/i.test(
        userRequest
      );

    if (isConceptualOrExplanation && !hasExplicitCodeGenerationIntent) {
      return {
        valid: false,
        reason: `The coding tool cannot be called for conceptual, definition, or explanation questions (e.g. 'Explain what an API is'). Answer directly using general knowledge.`,
      };
    }

    if (isDocumentQuestion && steps.length === 0) {
      return {
        valid: false,
        reason: `For document queries, retrieve_information must be used instead of the coding tool.`,
      };
    }
  }

  return { valid: true };
}

export default {
  AGENT_BRAIN_MODEL,
  AGENT_BRAIN_SYSTEM_PROMPT,
  formatAvailableTools,
  formatStepHistory,
  parseBrainOutput,
  validateToolSelectionPolicy,
};
