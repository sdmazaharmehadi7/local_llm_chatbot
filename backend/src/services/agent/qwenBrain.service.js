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
  "answer": "<final answer for user with citations and calculation steps>"
}

TOOL SELECTION AND MULTI-TOOL POLICY:
1. GENERAL TOOL SELECTION:
   - Before answering, determine whether the task requires one or more tools.
   - Do NOT assume that only one tool should be used.
   - A single user request may require multiple tools in sequence.
   - The agent must select all tools required to complete the task accurately.
   - Use the minimum number of tools necessary, but never skip a required tool.

2. RETRIEVAL TOOL (retrieve_information):
   - Use when the answer depends on information stored in: Knowledge Base, documents, PDFs, uploaded technical data, equipment specifications, or previously indexed industrial information.
   - Do not invent missing values.
   - If required information must be retrieved, retrieve it before performing calculations or conversions that depend on it.

3. CALCULATOR TOOL POLICY (calculator):
   - Whenever the task requires arithmetic using values obtained from retrieval, documents, conversation context, or another tool, you MUST use the Calculator Tool.
   - Do NOT perform arithmetic mentally or directly in the LLM response.
   - Examples:
     * Retrieved: Suction pressure = 1.8 bar, Discharge pressure = 7.2 bar -> Calculator("7.2 - 1.8")
     * Retrieved: Flow = 120 m3/h, Operating time = 3 h -> Calculator("120 * 3")
     * Retrieved: Actual pressure = 8 bar, Limit = 10 bar -> Calculator for percentage difference.
   - The final answer must use the Calculator Tool result.

4. UNIT CONVERTER TOOL (unit_converter):
   - Use the Unit Converter Tool whenever the task requires converting one physical unit into another.
   - Handles common industrial units:
     * Pressure: bar, kPa, MPa, psi, atm, Pa
     * Temperature: °C, °F, K
     * Length: mm, cm, m, km, inch, ft
     * Flow: m3/h, L/min, L/s, m3/s, gpm
     * Mass: kg, g, tonne, lb
     * Volume: L, m3, gallon, ml
     * Energy: J, kJ, MJ, Wh, kWh, cal, kcal, btu
     * Power: W, kW, MW, hp
     * Speed: m/s, km/h, rpm, rps, rad/s
     * Time: seconds, minutes, hours, days
   - Do NOT perform unit conversion mentally when the Unit Converter Tool can perform it.
   - Examples:
     * "Convert 5.4 bar to psi" -> MUST call Unit Converter Tool.
     * "Convert the retrieved pump pressure of 5.4 bar to psi" -> Retrieve pressure if needed -> Call Unit Converter Tool -> Use converted value in final answer.

5. RETRIEVAL + CALCULATOR:
   - When the task requires retrieving values and then performing arithmetic:
     1. Retrieve the required values.
     2. Verify that all required values were retrieved.
     3. Construct the mathematical expression.
     4. Call Calculator Tool.
     5. Use the calculator result in the final answer.

6. RETRIEVAL + UNIT CONVERTER:
   - When the task requires retrieving a value and converting its unit:
     1. Retrieve the required value.
     2. Identify the source and target units.
     3. Call Unit Converter Tool.
     4. Use the conversion result in the final answer.

7. RETRIEVAL + CALCULATOR + UNIT CONVERTER:
   - A task may require three or more tools. Do NOT stop after retrieval.
   - Required sequence: 1. Retrieval -> 2. Calculator -> 3. Unit Converter -> 4. Final Answer.
   - Example: Retrieve (Discharge = 7.2 bar, Suction = 1.8 bar) -> Calculator(7.2 - 1.8 = 5.4 bar) -> Unit Converter(5.4 bar -> psi) -> Final Answer.

8. MULTI-TOOL TASK SELECTION:
   - Analyze the complete task before selecting tools. Build the required tool sequence before execution.
   - Determine: What information is required? Where does it come from? Does it need retrieval? Does arithmetic need to be performed? Does unit conversion need to be performed? Does an image need inspection? Does another tool need to process a previous tool's output?

9. TOOL DEPENDENCY RULE:
   - Tools may depend on the output of previous tools. When a tool requires information produced by another tool, execute them sequentially. Do not execute a dependent tool before its required input is available.

10. VISION + OTHER TOOLS (vision):
    - Do not send the entire task blindly to the Vision Tool if the image only provides values needed by another tool.
    - Workflow: Vision extracts raw parameters/measurements -> Calculator performs arithmetic -> Unit Converter converts units -> Final Answer.
    - Specialist tools are bounded workers. Never pass downstream calculation or conversion instructions to the Vision Tool.

11. CODING TOOL POLICY (coding):
    - Use when the user explicitly requests generating, writing, implementing, refactoring, or debugging code, functions, algorithms, or scripts.
    - Powered by specialized Qwen2.5-Coder.
    - Input parameters:
      * "task" (string, REQUIRED): Clear description of the programming task or function to write/debug.
      * "language" (string, optional): Target programming language (e.g. 'python', 'javascript', 'java', 'cpp', 'sh').
    - Do NOT use for conceptual explanations without code generation (e.g. 'Explain what an API is').
    - Example: {"action": "tool", "tool": "coding", "reason": "Write Python leap year verification function", "input": {"task": "Write a Python function to check whether a year is a leap year", "language": "python"}}

12. SECURE SANDBOX CODE EXECUTION (execute_code):
    - Use when the user explicitly requests executing, running, testing, or showing the output/result of code or scripts.
    - Runs in an isolated container sandbox with zero host access.
    - Input parameters:
      * "code" (string, REQUIRED): The source code to execute.
      * "language" (string, optional): Language runtime ('python', 'javascript', or 'sh', default: 'python').
    - Example: {"action": "tool", "tool": "execute_code", "reason": "Execute Python leap year script to obtain output", "input": {"code": "def is_leap(y):\n  return (y%4==0 and y%100!=0) or (y%400==0)\nprint(is_leap(2024))", "language": "python"}}

13. CODING + SANDBOX EXECUTION WORKFLOW:
    - When the user asks to write/create code AND run/execute it to show the output (e.g. "write python code for leap year and execute it to provide the output"):
      1. Step 1: Call "coding" with the task to generate the code.
      2. Step 2: Call "execute_code" passing the generated code from the coding tool observation.
      3. Step 3: Return "final" providing the code and the verified execution output.

14. TOOL OUTPUT TRUST:
    - Treat specialized tool output as authoritative for that operation.
    - Calculator output must be used for arithmetic.
    - Unit Converter output must be used for unit conversion.
    - Retrieval output must be used for retrieved factual values.
    - Coding output must be used for generated code.
    - Sandbox output must be used for execution results.
    - Do not replace a tool result with an independently generated value.

15. CANONICAL TOOL SELECTION EXAMPLES:
    - Example 1: "Calculate 25 × 4." -> Calculator only.
    - Example 2: "Convert 100 psi to bar." -> Unit Converter only.
    - Example 3: "What is the suction pressure of P-204?" -> Retrieval only.
    - Example 4: "What is the pressure differential of P-204?" -> Retrieval -> Calculator.
    - Example 5: "What is the discharge pressure of P-204 in psi?" -> Retrieval -> Unit Converter.
    - Example 6: "Calculate the pressure differential of P-204 and give the result in psi." -> Retrieval -> Calculator -> Unit Converter.
    - Example 7: "Read the pressure values from this image, calculate the differential, and convert it to psi." -> Vision -> Calculator -> Unit Converter.
    - Example 8: "Write a Python function to check for leap years." -> Coding only.
    - Example 9: "Write a Python script for checking a leap year and execute it to provide the output." -> Coding -> Execute_Code -> Final Answer.

16. IMPORTANT RULE:
    - Never avoid a specialized tool merely because the operation is simple.
    - Simple arithmetic still requires Calculator when Calculator is available.
    - Simple unit conversion still requires Unit Converter when Unit Converter is available.
    - Writing code requires Coding (Qwen2.5-Coder); running code requires Execute_Code.
    - The LLM is responsible for understanding the task, selecting and ordering tools, passing inputs, and synthesizing the final response.
    - The specialized tools are responsible for factual lookup (retrieval), arithmetic (calculator), unit conversion (unit converter), code generation (coding), code execution (execute_code), and visual extraction (vision).
    - The agent behaves as an orchestrator, not as a replacement for specialized tools.

Strict Constraints:
1. Return ONLY the raw JSON object. Never include markdown code fences, comments, or thinking tags.
2. action must be either "tool" or "final".
3. The tool name MUST be one of the registered tools provided in the prompt.
4. Input arguments must strictly adhere to the tool's schema. When calling a tool, ALWAYS provide required parameters in "input" (e.g. {"task": "..."} for coding, {"code": "..."} for execute_code).
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

      // Format calculator observations
      if (toolName === "calculator" && typeof obs === "object" && obs !== null) {
        const expr = obs.expression || s.input?.expression || "";
        const val = obs.value !== undefined ? obs.value : (obs.formatted || obs.result || JSON.stringify(obs));
        return `Step ${idx + 1}:
  Action: Called tool "calculator" with expression: "${expr}"
  Observation${statusText}: Calculation result: ${expr} = ${val}`;
      }

      // Format unit converter observations
      if (toolName === "unit_converter" && typeof obs === "object" && obs !== null) {
        const formula = obs.conversionFormula || `${obs.value || s.input?.value} ${obs.fromUnit || s.input?.fromUnit} = ${obs.formatted || obs.result || JSON.stringify(obs)}`;
        return `Step ${idx + 1}:
  Action: Called tool "unit_converter" with input ${JSON.stringify(s.input || {})}
  Observation${statusText}: Unit Conversion: ${formula}`;
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

      // Format sandbox execute_code tool observations
      if (toolName === "execute_code" && typeof obs === "object" && obs !== null) {
        const exitCode = obs.exitCode !== undefined ? obs.exitCode : (obs.success ? 0 : 1);
        const stdoutStr = obs.stdout ? `\n  Stdout:\n${obs.stdout.trim()}` : "";
        const stderrStr = obs.stderr ? `\n  Stderr:\n${obs.stderr.trim()}` : "";
        const errDetail = obs.error && !obs.stderr?.includes(obs.error) ? `\n  Error: ${obs.error.trim()}` : "";
        const timeoutNotice = obs.timedOut ? " [TIMED OUT]" : "";
        return `Step ${idx + 1}:
  Action: Called tool "execute_code" in isolated sandbox (${obs.language || "python"})
  Observation${statusText}${timeoutNotice}: Exit Code: ${exitCode}${stdoutStr}${stderrStr}${errDetail}`;
      }

      // Format vision tool observations
      if (toolName === "vision" && typeof obs === "object" && obs !== null) {
        const analysis = obs.analysis || obs.description || "";
        const boundedAnalysis =
          analysis.length > 3500 ? `${analysis.slice(0, 3500)}... [truncated]` : analysis;
        const measurements = Array.isArray(obs.extractedMeasurements) && obs.extractedMeasurements.length > 0
          ? `\n  Detected Measurements: ${obs.extractedMeasurements.join(", ")}`
          : "";
        return `Step ${idx + 1}:
  Action: Called tool "vision" (Qwen2.5-VL) for visual inspection: ${JSON.stringify(s.input?.prompt || s.input || {})}
  Observation${statusText}: Visual Analysis:
${boundedAnalysis}${measurements}`;
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
 * Format accumulated retrieved evidence across all steps into a structured,
 * model-readable document context block, analogous to the working attachment flow.
 *
 * @param {object} state
 * @returns {string}
 */
export function formatAccumulatedEvidence(state = {}) {
  const facts = state.retrievedFacts || [];
  const steps = state.steps || [];

  const allItems = [];

  // 1. First include explicit facts in state.retrievedFacts
  if (Array.isArray(facts) && facts.length > 0) {
    for (const f of facts) {
      allItems.push({
        query: f.query || "",
        source: f.source || f.filename || "Document",
        page: f.page || 1,
        text: (f.text || f.content || "").trim(),
      });
    }
  }

  // 2. Also inspect steps to ensure zero retrieval results are dropped
  for (const s of steps) {
    if ((s.toolName || s.tool) === "retrieve_information" && s.observation) {
      const obs = s.observation;
      const q = s.input?.query || "";
      if (Array.isArray(obs.results)) {
        for (const r of obs.results) {
          allItems.push({
            query: q,
            source: r.filename || r.sourceName || r.source || "Document",
            page: r.page || 1,
            text: (r.text || r.content || "").trim(),
          });
        }
      } else if (obs.content) {
        allItems.push({
          query: q,
          source: "Document",
          page: 1,
          text: obs.content.trim(),
        });
      }
    }
  }

  if (allItems.length === 0) {
    return "No document evidence has been retrieved yet.";
  }

  // Deduplicate by source + page + first 60 chars of text
  const seenKeys = new Set();
  const uniqueItems = [];
  for (const item of allItems) {
    if (!item.text) continue;
    const key = `${item.source}:::p${item.page}:::${item.text.slice(0, 60)}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueItems.push(item);
    }
  }

  if (uniqueItems.length === 0) {
    return "No document evidence has been retrieved yet.";
  }

  return uniqueItems
    .map((item, idx) => {
      const queryTag = item.query ? ` | Query: "${item.query}"` : "";
      return `[Evidence #${idx + 1} | Document: ${item.source}, Page: ${item.page}${queryTag}]\n${item.text}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Format active reasoning state to clearly present executed queries,
 * retrieved facts, and completed calculations to the Agent Brain.
 *
 * @param {object} state
 * @returns {string}
 */
export function formatReasoningState(state = {}) {
  const steps = state.steps || [];
  if (!Array.isArray(steps) || steps.length === 0) {
    return "Initial Step: No tools have been executed yet.";
  }

  const retrievalSteps = steps.filter((s) => (s.toolName || s.tool) === "retrieve_information");
  const calculatorSteps = steps.filter((s) => (s.toolName || s.tool) === "calculator");

  const lines = [];

  if (retrievalSteps.length > 0) {
    lines.push("Previous Retrieval Queries Already Performed:");
    retrievalSteps.forEach((s, idx) => {
      const q = s.input?.query || JSON.stringify(s.input || {});
      lines.push(`  - Query ${idx + 1}: "${q}"`);
    });
    lines.push("  -> CRITICAL: DO NOT repeat any of the above queries. If more data is needed, formulate a NEW, FOCUSED query for the specific missing item.");
  }

  if (calculatorSteps.length > 0) {
    lines.push("\nCompleted Calculations:");
    calculatorSteps.forEach((s, idx) => {
      const expr = s.input?.expression || "";
      const val = s.observation?.value !== undefined ? s.observation.value : (s.observation?.formatted || JSON.stringify(s.observation));
      lines.push(`  - Calc ${idx + 1}: ${expr} = ${val}`);
    });
  }

  const converterSteps = steps.filter((s) => (s.toolName || s.tool) === "unit_converter");
  if (converterSteps.length > 0) {
    lines.push("\nCompleted Unit Conversions:");
    converterSteps.forEach((s, idx) => {
      const obs = s.observation;
      const formula = obs?.conversionFormula || `${obs?.value || s.input?.value} ${obs?.fromUnit || s.input?.fromUnit} = ${obs?.formatted || obs?.result || JSON.stringify(obs)}`;
      lines.push(`  - Conv ${idx + 1}: ${formula}`);
    });
  }

  return lines.join("\n");
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

    let input = {};
    if (parsed.input && typeof parsed.input === "object" && !Array.isArray(parsed.input)) {
      input = { ...parsed.input };
    } else if (parsed.parameters && typeof parsed.parameters === "object" && !Array.isArray(parsed.parameters)) {
      input = { ...parsed.parameters };
    } else if (parsed.args && typeof parsed.args === "object" && !Array.isArray(parsed.args)) {
      input = { ...parsed.args };
    } else if (parsed.arguments && typeof parsed.arguments === "object" && !Array.isArray(parsed.arguments)) {
      input = { ...parsed.arguments };
    }

    // Also pick up known tool parameters if the model placed them directly at the root level of the JSON
    const knownParams = [
      "task", "language", "codeContext",
      "code", "timeoutMs",
      "query", "documentId", "sourceScope", "limit",
      "expression", "expr",
      "value", "fromUnit", "toUnit", "from", "to", "val",
      "prompt", "image",
      "text", "operation", "options",
    ];
    for (const param of knownParams) {
      if (parsed[param] !== undefined && input[param] === undefined) {
        input[param] = parsed[param];
      }
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

  const hasExplicitCodeGenerationIntent =
    /\b(write|create|implement|generate|code|function|script|class|method|snippet|algorithm|debug|refactor|fix code|compile|syntax)\b/i.test(
      userRequest
    );

  const isDocumentQuestion =
    !hasExplicitCodeGenerationIntent &&
    /\b(document|documents|file|files|pdf|sop|manual|manuals|policy|policies|procedure|procedures|regulation|regulations|safety requirement|safety requirements|prv|cdu|crude distillation|valve|inspection interval|acceptance criteria|report|reports|inspection|equipment|pump|discharge|suction|pressure|flow rate|temperature|transmitter)\b/i.test(
      userRequest
    );

  const hasImages =
    (Array.isArray(taskState.images) && taskState.images.length > 0) ||
    Boolean(taskState.image) ||
    Boolean(decision.input?.image);

  // 1. DOCUMENT / RETRIEVAL POLICY:
  if (steps.length === 0 && isDocumentQuestion && !hasImages && (toolName === "calculator" || toolName === "unit_converter" || toolName === "text_transform" || toolName === "coding")) {
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
      /(\d+\s*[\+\-\*\/\^%]\s*\d+)|(\b(calculate|computation|compute|math|sum|difference|differential|diff|multiply|multiplication|divide|division|arithmetic|percentage|percent|formula|equation|sqrt|blowdown|tolerance|deviation|calc|count|increment)\b)/i.test(
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

  // 4. UNIT CONVERTER POLICY:
  if (toolName === "unit_converter") {
    const hasConversionInRequest =
      /\b(convert|conversion|in\s+(?:psi|bar|kpa|mpa|atm|pa|°?c|°?f|k|mm|cm|m|km|inch|ft|feet|m3\/h|l\/min|l\/s|kg|g|tonne|lb|lbs|liter|litre|l|gallon|wh|kwh|j|kj|w|kw|hp|rpm|m\/s|km\/h|seconds|minutes|hours)\b|\bto\s+[a-zA-Z°]+)/i.test(
        userRequest
      );

    const hasConversionInInput =
      Boolean(decision.input?.fromUnit && decision.input?.toUnit);

    const hasContextFromObservation = steps.length > 0;

    if (!hasConversionInRequest && !hasConversionInInput && !hasContextFromObservation) {
      return {
        valid: false,
        reason: `unit_converter cannot be called because the request does not involve physical unit conversion.`,
      };
    }

    // Anti-repetition: Prevent identical unit conversion loops
    const currentInput = decision.input || {};
    const curVal = currentInput.value;
    const curFrom = String(currentInput.fromUnit || "").trim().toLowerCase();
    const curTo = String(currentInput.toUnit || "").trim().toLowerCase();
    const prevConversions = steps
      .filter((s) => (s.toolName || s.tool) === "unit_converter")
      .map((s) => `${s.input?.value}:::${String(s.input?.fromUnit || "").trim().toLowerCase()}:::${String(s.input?.toUnit || "").trim().toLowerCase()}`);
    const curKey = `${curVal}:::${curFrom}:::${curTo}`;
    if (prevConversions.includes(curKey)) {
      return {
        valid: false,
        reason: `Duplicate unit conversion: "${curKey}" was already performed in a previous step. Proceed to next step or final answer.`,
      };
    }
  }

  // 5. RETRIEVAL POLICY GUARD:
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

    // Anti-repetition: Prevent identical retrieval query loops
    const currentQuery = String(decision.input?.query || "").trim().toLowerCase();
    const cleanCurrent = currentQuery.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    if (cleanCurrent) {
      const prevQueries = steps
        .filter((s) => (s.toolName || s.tool) === "retrieve_information")
        .map((s) =>
          String(s.input?.query || "")
            .trim()
            .toLowerCase()
            .replace(/[^\w\s]/g, " ")
            .replace(/\s+/g, " ")
            .trim()
        );

      if (prevQueries.includes(cleanCurrent)) {
        return {
          valid: false,
          reason: `Duplicate retrieval query: "${decision.input?.query}" was already searched in a previous step. Do not repeat identical queries; specify a new focused query for any missing value or proceed to calculation.`,
        };
      }
    }
  }

  // 6. CODING POLICY GUARD:
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

  // 7. SANDBOX EXECUTE CODE POLICY GUARD:
  if (toolName === "execute_code") {
    const isConceptualOrExplanation =
      /^(explain|what is|what are|what does|how does|why is|difference between|overview of|define)\b/i.test(
        userRequest
      );
    const hasExplicitExecutionIntent =
      /\b(run|execute|test|eval|evaluate|output|print|exec|sandbox|terminal|shell)\b/i.test(
        userRequest
      );

    if (isConceptualOrExplanation && !hasExplicitExecutionIntent) {
      return {
        valid: false,
        reason: `The execute_code tool cannot be called for conceptual, definition, or explanation questions (e.g. 'Explain what an API is'). Answer directly using general knowledge.`,
      };
    }

    if (isDocumentQuestion && steps.length === 0) {
      return {
        valid: false,
        reason: `For document queries, retrieve_information must be used instead of execute_code.`,
      };
    }

    // Anti-repetition & Retry limit: Prevent identical blind retries of failed code
    const currentCode = String(decision.input?.code || "").trim();
    const previousExecuteSteps = steps.filter(
      (s) => (s.toolName || s.tool) === "execute_code"
    );

    if (previousExecuteSteps.length >= 3) {
      return {
        valid: false,
        reason: `Code execution retry limit reached (3 execution attempts). Do not call execute_code again; return final response diagnosing the execution output and error.`,
      };
    }

    if (previousExecuteSteps.length > 0 && currentCode) {
      const lastExecStep = previousExecuteSteps[previousExecuteSteps.length - 1];
      const lastObs = lastExecStep.observation || lastExecStep.output;
      const lastFailed =
        lastExecStep.status === "failed" ||
        (typeof lastObs === "object" &&
          lastObs !== null &&
          (lastObs.success === false ||
            (typeof lastObs.exitCode === "number" && lastObs.exitCode !== 0)));

      if (lastFailed) {
        const lastCode = String(lastExecStep.input?.code || "").trim();
        if (currentCode === lastCode) {
          return {
            valid: false,
            reason: `Identical code execution retry prevented: The code failed with an error in the previous execution step. Do not blindly re-execute the identical failed code. Diagnose the failure from Stderr/Error and call the coding tool to fix the code first.`,
          };
        }
      }
    }
  }

  // 8. VISION POLICY GUARD:
  if (toolName === "vision") {
    const isConceptualOrExplanation =
      /^(explain|what is|what are|what does|how does|why is|difference between|overview of|define)\b/i.test(
        userRequest
      );
    const hasImages =
      (Array.isArray(taskState.images) && taskState.images.length > 0) ||
      Boolean(taskState.image) ||
      Boolean(decision.input?.image);
    const mentionsVisuals =
      /\b(image|picture|photo|diagram|schematic|chart|graph|blueprint|drawing|visual|figure|ocr|snapshot|gauge|reading|inspect)\b/i.test(
        userRequest
      );

    if (isConceptualOrExplanation && !hasImages && !mentionsVisuals) {
      return {
        valid: false,
        reason: `The vision tool cannot be called for conceptual, definition, or explanation questions (e.g. 'Explain what an API is'). Answer directly using general knowledge.`,
      };
    }

    if (!hasImages && !mentionsVisuals) {
      return {
        valid: false,
        reason: `The vision tool cannot be called when no image is provided and the request does not involve visual inspection.`,
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
  formatAccumulatedEvidence,
  formatReasoningState,
  parseBrainOutput,
  validateToolSelectionPolicy,
};
