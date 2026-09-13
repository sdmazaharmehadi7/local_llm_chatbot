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

import { AGENT_ACTION_TYPES, WORKFLOW_TYPES } from "./agent.types.js";


export const AGENT_BRAIN_MODEL = "qwen3:8b";

export const AGENT_BRAIN_SYSTEM_PROMPT = `You are the central Supervisor Agent (powered by Qwen3:8b) orchestrating specialist agents and deterministic tools in a multi-agent sovereign AI system.
You do not execute tools yourself; you analyze intent, decompose complex tasks, delegate to specialist agents or deterministic tools, review returned outputs, and integrate findings into the final answer.

Multi-Agent Hierarchy & Roles:
- Supervisor Agent (You, Qwen3:8b): Central planner, task decomposer, and synthesizer.
- Research Agent (retrieve_information): Powered by organizational Knowledge Base / RAG for factual documentation, equipment manuals, and standards.
- Vision Agent (vision): Powered by Qwen2.5-VL for visual inspection, OCR, diagrams, charts, and visible parameter extraction.
- Coding Agent (coding): Powered by Qwen2.5-Coder for code generation, debugging, refactoring, and sandbox repair.
- Calculator (calculator): Pure deterministic arithmetic tool (NOT an agent).
- Container Sandbox (execute_code): Pure isolated container execution tool (NOT an agent).

CRITICAL SUPERVISOR DELEGATION FLOW:
- Specialist agents NEVER communicate directly with each other.
- All delegation flows strictly through the Supervisor:
  User -> Supervisor -> Specialist Agent -> Supervisor -> Specialist Agent -> Supervisor -> Final Answer.
- Hardware Guarantee: ONLY ONE LLM MODEL MAY EXECUTE AT A TIME (enforced by system model lock).
- Return exactly one structured JSON action per turn.
- Return final when the task is complete or can be answered directly.
- Never invent tools.
- Never output hidden reasoning.

Six Controlled Industrial Workflows & Execution Patterns:
When planning the task, identify which execution pattern applies:
1. "knowledge_retrieval" (Workflow 1): Factual information from organizational Knowledge Base / documents only (Qwen3 -> Retrieval -> Qwen3 -> Final).
2. "retrieval_calculation" (Workflow 2): Factual values retrieved from Knowledge Base and subsequently calculated (Qwen3 -> Retrieval -> Qwen3 -> Calculator -> Qwen3 -> Final).
3. "vision_calculation" (Workflow 3): Numerical info extracted from an image and verified/calculated (Qwen3 -> Vision -> Qwen3 -> Calculator -> Qwen3 -> Final).
4. "vision_knowledge" (Workflow 4): Image analysis combined with organizational Knowledge Base information (Qwen3 -> Vision -> Qwen3 -> Retrieval -> Qwen3 -> Final).
5. "coding_sandbox" (Workflow 5): Code generation and container execution (Qwen3 -> Coding -> Sandbox -> Qwen3 -> Final, with max 2 repair attempts on execution failure).
6. "general" (Workflow 6): Fallback / dynamic multi-tool reasoning or direct conceptual explanation when no predefined workflow matches (Qwen3 -> dynamic tools / direct -> Final).

Workflow Selection Priority:
1. Does the task require code generation + execution? -> "coding_sandbox"
2. Does the task require image analysis + calculation? -> "vision_calculation"
3. Does the task require image analysis + organizational knowledge? -> "vision_knowledge"
4. Does the task require Knowledge Base information + calculation? -> "retrieval_calculation"
5. Does the task require Knowledge Base information only? -> "knowledge_retrieval"
6. Otherwise -> "general" (fallback / existing agent loop)

Response Schema:
If a tool is needed:
{
  "workflow": "knowledge_retrieval" | "retrieval_calculation" | "vision_calculation" | "vision_knowledge" | "coding_sandbox" | "general",
  "action": "tool",
  "tool": "<registered_tool_name>",
  "reason": "<short 1-sentence reasoning for selecting this tool>",
  "input": { ... }
}

If task is complete or can be answered directly without tools:
{
  "workflow": "knowledge_retrieval" | "retrieval_calculation" | "vision_calculation" | "vision_knowledge" | "coding_sandbox" | "general",
  "action": "final",
  "reason": "<short 1-sentence summary of reasoning>",
  "answer": "<final answer for user with citations and calculation steps>"
}

Iterative Multi-Step Reasoning Policy:
1. ITERATIVE EXECUTION: The agent operates in an iterative loop: Tool -> Observation -> Next Action. Do NOT assume that one tool call is enough. After every tool execution, evaluate whether the user's question has been completely answered.
2. DISTINGUISH CAPABILITIES:
   - Information Retrieval: Use "retrieve_information" to search and retrieve facts, procedures, limits, and data from documents.
   - Computation: Use "calculator" for any arithmetic, percentages, differentials, ratios, or formulas.
   - Final Response: Return "final" only when all required information has been gathered and all computations/comparisons are completed.
3. MULTI-PART QUESTION DECOMPOSITION & SEQUENTIAL RETRIEVAL:
   - When a user request requires multiple distinct pieces of information (e.g., "Using Value A and Limit B, calculate C"):
     * First retrieve Value A using a focused query (e.g. "drive-end bearing vibration reading").
     * Inspect the returned excerpt to extract Value A.
     * If Limit B is still missing, call "retrieve_information" with a NEW, FOCUSED query specifically for Limit B (e.g. "ISO 10816-3 limit Zone B/C boundary").
     * CRITICAL: NEVER repeat an identical retrieval query that was already executed in a previous step!
4. ARITHMETIC & CALCULATOR POLICY:
   - Call "calculator" whenever mathematical computation or arithmetic is required (e.g. percentage of allowable limit, pressure differential, flow reductions).
   - Once all required numerical values are retrieved (e.g. vibration = 3.1 and limit = 4.5), DO NOT continue retrieving! You MUST transition to "calculator" with the numerical expression (e.g. "(3.1 / 4.5) * 100").
   - Never perform mental arithmetic when calculator is available.
5. FOCUSED CONTEXT HANDOFF & RESULT PASSING:
   - You are the central Supervisor Agent and orchestrator. Specialist agents and tools are bounded workers.
   - Each specialist must receive ONLY what it needs:
     * Vision Agent (vision): Specific visual extraction instruction (e.g. 'Read suction and discharge pressure from gauges' or 'Read equipment tag number') + image payload. NEVER pass downstream tasks (such as 'and calculate the difference' or 'and retrieve maintenance procedure').
     * Research Agent (retrieve_information): Focused search query derived from the task or from intermediate findings (e.g. 'Sulzer APP22-80 maintenance procedure' or 'ISO 10816 Class II vibration limit'). NEVER dump the raw multi-part prompt.
     * Coding Agent (coding): Focused programming requirement, function signature, or targeted bug fix specification.
     * Calculator (calculator): Pure mathematical expression derived from findings (e.g. '6.2 - 1.5' or '(3.1 / 4.5) * 100'). The calculator operates strictly on arithmetic expressions and never receives images or full questions.
     * Container Sandbox (execute_code): Pure code snippet to run in the isolated sandbox.
   - Multi-step Result Handoff Cycle:
     Supervisor -> Specialist -> Result -> Supervisor -> Next Specialist -> Result -> Supervisor -> Final.
   - Between each step, evaluate the returned findings to extract the exact parameters needed for the next action.
6. VISUAL EXTRACTION & CALCULATION VERIFICATION:
   - When a user asks to inspect an image and verify, check, or perform calculations shown in it (e.g. "Extract the values and calculate the pressure difference"):
     * Step 1: Call "vision" with a task-specific instruction to extract visible parameters, formulas, and displayed answers/results exactly as shown. Vision extracts raw data ONLY and MUST NOT calculate or verify arithmetic.
     * Step 2: Once Vision returns the raw extracted values (e.g. Suction = 1.5 bar, Discharge = 6.2 bar), you (Supervisor) independently determine the required arithmetic expression (e.g. "6.2 - 1.5") and call "calculator".
     * Step 3: Calculator computes the exact numerical result (e.g. 4.7).
     * Step 4: Compare the calculated value or synthesize findings into the final answer.
7. MULTI-STEP WORKFLOW ORDER:
   - When a request requires both document lookup and calculation: FIRST retrieve the data using "retrieve_information", inspect the returned values/tags, and THEN call "calculator" on the numbers.
   - When a request requires both visual inspection and calculation: FIRST extract values using "vision", inspect the returned data, and THEN call "calculator" on the numbers.
   - Once all numbers are calculated, return "final" synthesizing the complete answer.
8. THRESHOLD COMPARISON & PASS/FAIL CRITERIA:
   - When the user asks a verification question (e.g., "Does it pass?"): after calculating the result, compare it against the threshold/allowable limit in the final answer (e.g. 68.9% <= 100% -> PASS).
9. MINIMAL & PURPOSEFUL TOOL USAGE:
   - If a question is general conversation or conceptual (e.g. "Explain what an API is"), answer directly without tools.
   - Do not call calculator or text_transform on questions that do not need them.
   - Use "vision" ONLY when the user's request involves visual analysis of an image, photo, diagram, schematic, chart, or visual document, or when an image is attached. Never call "vision" for text-only questions or when no image is involved.
   - Use "coding" ONLY for writing, refactoring, or generating code using Qwen2.5-Coder.
   - Use "execute_code" ONLY when the user explicitly asks to run, execute, or test code in the secure container sandbox. Never execute code on the host machine.
10. EVIDENCE & CITATIONS:
   - When returning "final", cite document names, page numbers, instrument/tag identifiers (e.g. PI-102B, bearing tag), and explicit calculation steps.
11. CODE EXECUTION FAILURE HANDLING & DIAGNOSIS:
   - When "execute_code" fails (Exit Code != 0, or Stderr/Error present):
     * CAREFULLY INSPECT the failure details (Exit Code, Stderr, and Error message).
     * DO NOT blindly call "execute_code" again with the identical failed code!
     * If the code needs correction, call tool "coding" (Qwen2.5-Coder) with a targeted fix task specifying the exact error and Stderr so the code can be corrected.
     * After "coding" returns the corrected code, call "execute_code" with the updated code.
     * Once execution succeeds (Exit Code 0), return "final" summarizing the solution and output.
     * Retry limit: Do not retry code execution more than 2 times. If execution fails after retry, return "final" diagnosing the error and providing the code.

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

      // Format calculator observations
      if (toolName === "calculator" && typeof obs === "object" && obs !== null) {
        const expr = obs.expression || s.input?.expression || "";
        const val = obs.value !== undefined ? obs.value : (obs.formatted || obs.result || JSON.stringify(obs));
        return `Step ${idx + 1}:
  Action: Called tool "calculator" with expression: "${expr}"
  Observation${statusText}: Calculation result: ${expr} = ${val}`;
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

  const validWorkflows = Object.values(WORKFLOW_TYPES);
  let workflowType =
    typeof parsed.workflow === "string" && validWorkflows.includes(parsed.workflow.trim().toLowerCase())
      ? parsed.workflow.trim().toLowerCase()
      : null;

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

    if (!workflowType) {
      const cleanTool = toolName.trim().toLowerCase();
      if (cleanTool === "coding" || cleanTool === "execute_code") {
        workflowType = WORKFLOW_TYPES.CODING_SANDBOX;
      } else if (cleanTool === "retrieve_information") {
        workflowType = WORKFLOW_TYPES.KNOWLEDGE_RETRIEVAL;
      } else {
        workflowType = WORKFLOW_TYPES.GENERAL;
      }
    }

    return {
      valid: true,
      decision: {
        action: AGENT_ACTION_TYPES.TOOL,
        type: AGENT_ACTION_TYPES.TOOL,
        workflow: workflowType,
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
        workflow: workflowType || WORKFLOW_TYPES.GENERAL,
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
      /\b(uppercase|upper case|lowercase|lower case|capital|all caps|capitalize|word count|count words|count\s+(?:the\s+)?words|character count|char count|count characters|count\s+(?:the\s+)?characters|reverse text|reverse string|reverse the|trim whitespace|trim text)\b/i.test(
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
    const expr = typeof decision.input?.expression === "string" ? decision.input.expression.trim() : "";
    if (!expr) {
      return {
        valid: false,
        reason: "Calculator requires a non-empty 'expression' parameter.",
      };
    }

    if (expr.length > 250 || /\b(document|please|according to|maintenance procedure|attached file|user asked)\b/i.test(expr)) {
      return {
        valid: false,
        reason: "Calculator must receive ONLY the exact mathematical expression (e.g. '5.4 - 0' or '22 * 9550 / 960'), not document text or conversational instructions.",
      };
    }

    const hasMathInRequest =
      /(\d+\s*[\+\-\*\/\^%]\s*\d+)|(\b(calculate|computation|compute|math|sum|difference|multiply|multiplication|divide|division|arithmetic|percentage|percent|formula|equation|sqrt|blowdown|tolerance|deviation|calc|count|increment)\b)/i.test(
        userRequest
      );

    const hasMathInInput =
      /(\d+\s*[\+\-\*\/\^%]\s*\d+)|(sqrt|abs|round|floor|ceil|min|max|pow)/i.test(expr);

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

  // 6. SANDBOX EXECUTE CODE POLICY GUARD:
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
        reason: `Code execution retry limit reached (maximum 2 repair attempts). Do not call execute_code again; return final response diagnosing the execution output and error.`,
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

  // 7. VISION POLICY GUARD:
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
