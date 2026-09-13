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

export const AGENT_BRAIN_SYSTEM_PROMPT = `You are the decision-making brain of a local sovereign agentic AI system.
You do not execute tools yourself.
You can only request tools from the provided tool registry.
Return exactly one structured JSON action.
Return final when the task is complete or can be answered directly.
Never invent tools.
Never output hidden reasoning.

Eleven Controlled Industrial Workflows & Execution Patterns:
When planning the task, identify which primary workflow applies:
1. "document_analysis" (Workflow 1): Uploaded document analysis, summarization, extraction, or review directly from the provided document context (Qwen3 -> Document Content -> optional calculation/tools -> Final).
2. "data_analysis" (Workflow 2): Structured, tabular, or industrial measurement dataset analysis (Qwen3 -> Statistics/Trend Analysis/Calculator -> Qwen3 -> Final).
3. "compliance_check" (Workflow 3): Specification, threshold, standard, or equipment limit comparison (Qwen3 -> optional Retrieval -> Threshold Check Tool -> Qwen3 -> Final). Never invent limits.
4. "multi_step_analysis" (Workflow 4): Complex tasks requiring multiple sequential capabilities across domains (e.g. Vision -> Retrieval -> Engineering Formula -> Threshold Check -> Final).
5. "engineering" (Workflow 5): Primarily engineering calculations, standard formulas, or unit conversions (Qwen3 -> Engineering Tools -> Qwen3 -> Final).
6. "knowledge_retrieval" (Workflow 6): Factual information lookup from organizational Knowledge Base / persistent documentation only (Qwen3 -> Retrieval -> Qwen3 -> Final).
7. "retrieval_calculation" (Workflow 7): Factual values retrieved from Knowledge Base and subsequently calculated (Qwen3 -> Retrieval -> Qwen3 -> Calculator/Engineering Tools -> Qwen3 -> Final).
8. "vision_calculation" (Workflow 8): Numerical info extracted from an image and verified/calculated (Qwen3 -> Vision -> Qwen3 -> Calculator/Engineering Tools -> Qwen3 -> Final).
9. "vision_knowledge" (Workflow 9): Image analysis combined with organizational Knowledge Base information (Qwen3 -> Vision -> Qwen3 -> Retrieval -> Qwen3 -> Final).
10. "coding_sandbox" (Workflow 10): Code generation and container execution (Qwen3 -> Coding -> Sandbox -> Qwen3 -> Final, with max 2 repair attempts on execution failure).
11. "general" (Workflow 11): Fallback / dynamic multi-tool reasoning or direct conceptual explanation when no predefined workflow matches (Qwen3 -> dynamic tools / direct -> Final).

Workflow Selection Priority:
1. Does the task require analyzing or summarizing an attached/uploaded document directly? -> "document_analysis"
2. Does the task require statistical or trend analysis on structured or tabular industrial datasets? -> "data_analysis"
3. Does the task require verifying compliance against equipment specifications, standards, or limits? -> "compliance_check"
4. Does the task require multiple sequential capabilities (e.g. vision + retrieval + calculation + limit check)? -> "multi_step_analysis"
5. Does the task require code generation + execution? -> "coding_sandbox"
6. Does the task require image analysis + calculation? -> "vision_calculation"
7. Does the task require image analysis + organizational knowledge? -> "vision_knowledge"
8. Does the task require Knowledge Base information + calculation? -> "retrieval_calculation"
9. Does the task require Knowledge Base information only? -> "knowledge_retrieval"
10. Does the task require engineering formulas or unit conversions? -> "engineering"
11. Otherwise -> "general" (fallback / existing agent loop)

Response Schema:
If a tool is needed:
{
  "workflow": "document_analysis" | "data_analysis" | "compliance_check" | "multi_step_analysis" | "engineering" | "knowledge_retrieval" | "retrieval_calculation" | "vision_calculation" | "vision_knowledge" | "coding_sandbox" | "general",
  "action": "tool",
  "tool": "<registered_tool_name>",
  "reason": "<short 1-sentence reasoning for selecting this tool>",
  "input": { ... }
}

If task is complete or can be answered directly without tools:
{
  "workflow": "document_analysis" | "data_analysis" | "compliance_check" | "multi_step_analysis" | "engineering" | "knowledge_retrieval" | "retrieval_calculation" | "vision_calculation" | "vision_knowledge" | "coding_sandbox" | "general",
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
5. PROMPT ISOLATION & TOOL-SPECIFIC INSTRUCTIONS:
   - You are the SOLE Agent Brain and orchestrator. Specialist tools (vision, calculator, coding) are bounded workers, NOT autonomous agents. They must NEVER receive entire multi-tool user tasks or downstream instructions.
   - When calling "vision": Generate a fresh, task-specific visual instruction tailored to the exact visual perception needed (e.g. image description, OCR, table reading, or extracting raw parameters/formulas/displayed answers). NEVER pass downstream tasks (such as "use calculator", "verify each calculation", or "calculate percentage error") to the vision tool!
   - When calling "calculator": Formulate mathematical expressions derived from retrieved documents or visual extractions (e.g. "22 * 9550 / 960"). The calculator operates strictly on numerical expressions and never receives images.
   - When calling "coding": Provide programming tasks only. NEVER pass image context or visual data to Qwen2.5-Coder.
6. VISUAL EXTRACTION & CALCULATION VERIFICATION:
   - When a user asks to inspect an image and verify, check, or perform calculations shown in it (e.g. "Extract the values from all 3 examples and verify each calculation using the calculator"):
     * Step 1: Call "vision" with a task-specific instruction to extract visible parameters, formulas, and displayed answers/results exactly as shown. Vision extracts raw data ONLY and MUST NOT calculate or verify arithmetic.
     * Step 2: Once Vision returns the raw extracted values (e.g. P = 22 kW, N = 960 RPM, displayed answer = 218.9 Nm), you (Qwen3) independently determine the required arithmetic expression (e.g. "22 * 9550 / 960") and call "calculator".
     * Step 3: Calculator computes the exact numerical result (e.g. 218.85416666666666).
     * Step 4: Compare the calculated value against the image's displayed answer, reason over rounding and tolerances, and synthesize the final answer.
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
12. SHARED ENGINEERING TOOLS POLICY:
   - Engineering tools (engineering_formula, unit_conversion, threshold_check, statistics, trend_analysis) are global reusable capabilities available to ALL workflows.
   - Use "engineering_formula" for standard formulas (pressure_difference, percentage_difference, percentage_change, efficiency, electrical_power, mechanical_power, density, flow_rate, velocity, kinetic_energy, potential_energy). Never invent arbitrary formulas.
   - Use "unit_conversion" whenever input units differ or need conversion across pressure, temperature, length, mass, flow, energy, or power before calculation.
   - Use "threshold_check" to compare values deterministically against allowable engineering limits. Safety rule: The tool only performs the mathematical comparison; NEVER invent equipment or safety limits! If an engineering limit is missing, retrieve it from the Knowledge Base or state that it is unavailable.
   - Use "statistics" for mean, median, min, max, range, variance, and standard deviation over numerical datasets.
   - Use "trend_analysis" to evaluate chronological sequential readings for direction (increasing/decreasing/stable) and rate of change without unsupported speculation.
   - In cross-workflow tasks (e.g. Vision -> Engineering Formula, or KB -> Formula -> Threshold Check), dynamically compose these shared tools as needed.

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

  const otherToolSteps = steps.filter((s) => {
    const name = s.toolName || s.tool;
    return name !== "retrieve_information" && name !== "calculator";
  });

  if (otherToolSteps.length > 0) {
    lines.push("\nCompleted Tool Results & Values Stored in Task State:");
    otherToolSteps.forEach((s, idx) => {
      const name = s.toolName || s.tool;
      const obs = s.observation;
      let resVal = "completed";
      if (typeof obs === "object" && obs !== null) {
        if (obs.result !== undefined) {
          resVal = `${obs.result} ${obs.unit || ""}`.trim();
        } else if (obs.value !== undefined) {
          resVal = `${obs.value} ${obs.unit || ""}`.trim();
        } else if (obs.mean !== undefined) {
          resVal = `Mean=${obs.mean}, Min=${obs.minimum}, Max=${obs.maximum}, Range=${obs.range}`;
        } else if (obs.trend !== undefined) {
          resVal = `Trend=${obs.trend} (${obs.percentage_change}%)`;
        } else if (obs.status_code !== undefined) {
          resVal = `Status=${obs.status_code} (${obs.summary || ""})`;
        } else if (obs.code !== undefined && name === "coding") {
          resVal = `Code generated (${obs.language || "python"})`;
        } else if (obs.exitCode !== undefined && name === "execute_code") {
          resVal = `ExitCode=${obs.exitCode}, Output=${(obs.stdout || obs.stderr || "").trim().slice(0, 100)}`;
        } else {
          resVal = JSON.stringify(obs).slice(0, 150);
        }
      } else {
        resVal = String(obs).slice(0, 150);
      }
      lines.push(`  - Step (${name}): Input: ${JSON.stringify(s.input || {})} -> Result: ${resVal}`);
    });
    lines.push("  -> CRITICAL: The above tool outputs are ALREADY computed and stored in your task state. DO NOT repeat identical tool calls for these values. Move forward to the next calculation or final answer.");
  }

  return lines.join("\n");
}

/**
 * Deterministically classify the initial workflow with explicit task precedence.
 *
 * PRECEDENCE (Specific task requirements take precedence over broad semantic categories):
 * 1. CODING_SANDBOX: Explicit request to write/generate code AND execute it.
 * 2. DOCUMENT_ANALYSIS: Explicit uploaded document content / context attached to user message.
 * 3. MULTI_STEP_ANALYSIS: Cross-domain multi-capability workflow (e.g. image + KB + formula + check).
 * 4. VISION_KNOWLEDGE: Image/visual data present + organizational Knowledge Base lookup.
 * 5. VISION_CALCULATION: Image/visual data present + numerical calculation/verification.
 * 6. COMPLIANCE_CHECK: Specification, threshold, standard, or equipment limit comparison.
 * 7. RETRIEVAL_CALCULATION: Knowledge Base factual lookup AND subsequent calculation/payback/differential.
 * 8. DATA_ANALYSIS: Structured / tabular dataset or series of numbers with statistics/trend analysis.
 * 9. ENGINEERING: Direct engineering calculation (formula or unit conversion) without code.
 * 10. KNOWLEDGE_RETRIEVAL: Factual lookup from documentation / persistent Knowledge Base only.
 * 11. GENERAL: Conceptual explanation, direct conversation, or fallback.
 *
 * @param {object} params
 * @param {string} params.userRequest
 * @param {Array} [params.images=[]]
 * @param {Array} [params.conversationHistory=[]]
 * @returns {string} One of WORKFLOW_TYPES
 */
export function classifyInitialWorkflow({
  userRequest = "",
  images = [],
  conversationHistory = [],
} = {}) {
  const req = String(userRequest || "").trim();
  const hasImages = Array.isArray(images) ? images.length > 0 : Boolean(images);

  // 1. CODING_SANDBOX
  // Must win over ENGINEERING even if an engineering formula is mentioned (e.g. Reynolds number)
  const isCodingSandbox =
    /\b(write|generate|create|implement|author)\b.*\b(python|script|code|program)\b.*\b(run|execute|sandbox|calculate|compute)\b/i.test(req) ||
    /\b(execute|run)\b.*\b(python|script|code)\b/i.test(req) ||
    /\b(write and execute|write & execute)\b.*\b(python|script|code)\b/i.test(req) ||
    (/\b(python script|python code)\b/i.test(req) && /\b(calculate|compute|execute|run)\b/i.test(req));

  if (isCodingSandbox) {
    return WORKFLOW_TYPES.CODING_SANDBOX;
  }

  // 2. DOCUMENT_ANALYSIS
  // Must NOT route to persistent KB when user provided document context directly
  const hasInlineDocContext =
    /(\[DOCUMENT CONTEXT\]|\[ATTACHED DOCUMENT\]|Document Content:|Document Excerpt:)/i.test(req) ||
    (/\b(this uploaded|uploaded procedure|uploaded document|uploaded maintenance|uploaded inspection|attached report|attached procedure|attached document|this attached)\b/i.test(req) &&
      !/\b(compare with knowledge base|search the knowledge base)\b/i.test(req));

  if (hasInlineDocContext) {
    return WORKFLOW_TYPES.DOCUMENT_ANALYSIS;
  }

  // 3. MULTI_STEP_ANALYSIS
  // Genuinely complex cross-domain tasks (e.g. gauge image + KB retrieval + calculation + compliance check)
  const isMultiStep =
    hasImages &&
    /\b(gauge|dial|meter|reading)\b/i.test(req) &&
    /\b(rated|specification|manual|document|kb)\b/i.test(req) &&
    /\b(differential|difference|calculate|formula)\b/i.test(req) &&
    /\b(compliant|compare|specification|within|exceeds)\b/i.test(req);

  if (isMultiStep) {
    return WORKFLOW_TYPES.MULTI_STEP_ANALYSIS;
  }

  // 4. VISION_KNOWLEDGE
  if (hasImages && /\b(document|manual|sop|kb|knowledge|policy|procedure|specification|standard)\b/i.test(req)) {
    return WORKFLOW_TYPES.VISION_KNOWLEDGE;
  }

  // 5. VISION_CALCULATION
  if (hasImages && /\b(calculate|computation|compute|math|sum|difference|ratio|formula|value|reading)\b/i.test(req)) {
    return WORKFLOW_TYPES.VISION_CALCULATION;
  }

  // 6. DATA_ANALYSIS
  // Numerical array / dataset + statistics, trend, or multi-point evaluation
  const hasArrayLiteral = /\[\s*[\d\.\s,-]+\s*\]/.test(req);
  const hasSeries = /(\d+\.\d+[\s,]+){3,}/.test(req);
  const hasDatasetKeywords = /\b(dataset|measurements|readings|sensor readings|tabular|time series|sequential readings)\b/i.test(req);
  const hasDataAnalysisIntent =
    /\b(statistics|mean|average|median|variance|standard deviation|range|trend|trend analysis|stable trend|rate of change|extremes)\b/i.test(req) ||
    hasArrayLiteral;

  if ((hasArrayLiteral || (hasSeries && hasDatasetKeywords)) && hasDataAnalysisIntent) {
    return WORKFLOW_TYPES.DATA_ANALYSIS;
  }

  // 7. COMPLIANCE_CHECK
  // Checking a single measurement against an allowable limit or standard
  const isMultiParamFormula =
    /\b(discharge pressure\b.*\bsuction pressure|suction pressure\b.*\bdischarge pressure|inlet\b.*\boutlet)\b/i.test(req);

  const isComplianceCheck =
    !isMultiParamFormula &&
    (/\b(is this compliant|is compliant|is it compliant|compliance check|compliant\?|does this pass|does it pass|pass the safety|safety shutdown limit|within limit|within the limit|exceeds limit|exceed the limit|acceptable limit|allowable limit|zone [a-d]|according to .* is this compliant)\b/i.test(req) ||
    (/\b(vibration|temperature|pressure|flow)\b/i.test(req) && /\b(compliant|limit|threshold|pass|acceptable|shutdown)\b/i.test(req)));

  if (isComplianceCheck) {
    return WORKFLOW_TYPES.COMPLIANCE_CHECK;
  }

  // 8. RETRIEVAL_CALCULATION
  // Retrieval from KB/purchase note/manual AND calculation (e.g. C-301 purchase note daily loss and days to recover)
  const isRetrievalCalc =
    (/\b(purchase note|note|sop|manual|document|c-301|report|invoice)\b/i.test(req) || /\b(according to|from the)\b/i.test(req)) &&
    /\b(how many days|how long|calculate|compute|total loss|daily production loss|recover|payback|calculate\b.*\bdifference|percentage reduction|percentage change)\b/i.test(req);

  if (isRetrievalCalc) {
    return WORKFLOW_TYPES.RETRIEVAL_CALCULATION;
  }

  // 9. ENGINEERING
  // Pure formula calculation or unit conversion without code writing
  const isEngineering =
    isMultiParamFormula ||
    /\b(convert\s+\d+|unit conversion|psi to bar|bar to psi|celsius to|fahrenheit to|incompatible units)\b/i.test(req) ||
    /\b(pressure difference|delta p|percentage difference|percentage change|percentage reduction|efficiency|electrical power|mechanical power|density|flow rate|velocity)\b/i.test(req) ||
    (/\b(psi|bar|kpa|mpa)\b/i.test(req) && /\b(difference|convert|conversion|formula)\b/i.test(req));

  if (isEngineering) {
    return WORKFLOW_TYPES.ENGINEERING;
  }

  // 10. KNOWLEDGE_RETRIEVAL
  // Lookup from documentation/manuals/SOPs
  const isKnowledgeRetrieval =
    /\b(sop|manual|manuals|policy|policies|procedure|procedures|prv|cdu|p-204|e-204|c-301|eng-pmp|saf-pmp|ppe|overhaul|inspection frequency|set pressure|maintenance procedure|document|kb|knowledge base)\b/i.test(req) ||
    /\b(according to|what is the set pressure|what is the motor power|overhaul period)\b/i.test(req);

  if (isKnowledgeRetrieval) {
    return WORKFLOW_TYPES.KNOWLEDGE_RETRIEVAL;
  }

  // 11. GENERAL
  return WORKFLOW_TYPES.GENERAL;
}

/**
 * Safely parse and validate structured JSON returned by Qwen3:8b.
 * Strips thinking tokens (<think>), markdown fences, and isolates the JSON object.
 *
 * @param {string} rawOutput
 * @param {string} [initialWorkflow=null] - Pre-classified primary workflow
 * @returns {{ valid: boolean, decision?: object, error?: string, raw?: string }}
 */
export function parseBrainOutput(rawOutput, initialWorkflow = null) {
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

  // Enforce precedence: If an initial workflow with higher specificity exists (e.g. CODING_SANDBOX, COMPLIANCE_CHECK, RETRIEVAL_CALCULATION, DOCUMENT_ANALYSIS)
  // and parsed.workflow slipped into a generic bucket (e.g. "engineering" for coding, or "knowledge_retrieval" for compliance/calculation),
  // preserve the specific initial workflow!
  if (initialWorkflow && initialWorkflow !== WORKFLOW_TYPES.GENERAL) {
    const isSpecificInitial = [
      WORKFLOW_TYPES.CODING_SANDBOX,
      WORKFLOW_TYPES.DOCUMENT_ANALYSIS,
      WORKFLOW_TYPES.MULTI_STEP_ANALYSIS,
      WORKFLOW_TYPES.VISION_KNOWLEDGE,
      WORKFLOW_TYPES.VISION_CALCULATION,
      WORKFLOW_TYPES.COMPLIANCE_CHECK,
      WORKFLOW_TYPES.RETRIEVAL_CALCULATION,
      WORKFLOW_TYPES.DATA_ANALYSIS,
      WORKFLOW_TYPES.ENGINEERING,
    ].includes(initialWorkflow);

    if (isSpecificInitial) {
      if (!workflowType || workflowType === WORKFLOW_TYPES.GENERAL) {
        workflowType = initialWorkflow;
      } else if (initialWorkflow === WORKFLOW_TYPES.CODING_SANDBOX && workflowType === WORKFLOW_TYPES.ENGINEERING) {
        workflowType = WORKFLOW_TYPES.CODING_SANDBOX;
      } else if (initialWorkflow === WORKFLOW_TYPES.COMPLIANCE_CHECK && workflowType === WORKFLOW_TYPES.KNOWLEDGE_RETRIEVAL) {
        workflowType = WORKFLOW_TYPES.COMPLIANCE_CHECK;
      } else if (initialWorkflow === WORKFLOW_TYPES.RETRIEVAL_CALCULATION && workflowType === WORKFLOW_TYPES.KNOWLEDGE_RETRIEVAL) {
        workflowType = WORKFLOW_TYPES.RETRIEVAL_CALCULATION;
      } else if (initialWorkflow === WORKFLOW_TYPES.DOCUMENT_ANALYSIS && workflowType === WORKFLOW_TYPES.KNOWLEDGE_RETRIEVAL) {
        workflowType = WORKFLOW_TYPES.DOCUMENT_ANALYSIS;
      }
    }
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

    if (!workflowType) {
      if (initialWorkflow && initialWorkflow !== WORKFLOW_TYPES.GENERAL) {
        workflowType = initialWorkflow;
      } else {
        const cleanTool = toolName.trim().toLowerCase();
        if (cleanTool === "coding" || cleanTool === "execute_code") {
          workflowType = WORKFLOW_TYPES.CODING_SANDBOX;
        } else if (cleanTool === "retrieve_information") {
          workflowType = WORKFLOW_TYPES.KNOWLEDGE_RETRIEVAL;
        } else if (cleanTool === "vision") {
          workflowType = WORKFLOW_TYPES.VISION_CALCULATION;
        } else if (cleanTool === "threshold_check") {
          workflowType = WORKFLOW_TYPES.COMPLIANCE_CHECK;
        } else if (cleanTool === "statistics" || cleanTool === "trend_analysis") {
          workflowType = WORKFLOW_TYPES.DATA_ANALYSIS;
        } else if (cleanTool === "engineering_formula" || cleanTool === "unit_conversion") {
          workflowType = WORKFLOW_TYPES.ENGINEERING;
        } else {
          workflowType = WORKFLOW_TYPES.GENERAL;
        }
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

  const hasInlineDocumentContext =
    /(\[DOCUMENT CONTEXT\]|\[ATTACHED DOCUMENT\]|Document Content:|Document Excerpt:)/i.test(userRequest);

  const isDocumentQuestion =
    !hasExplicitCodeGenerationIntent &&
    !hasInlineDocumentContext &&
    /\b(document|documents|file|files|pdf|sop|manual|manuals|policy|policies|procedure|procedures|regulation|regulations|safety requirement|safety requirements|prv|cdu|crude distillation|valve|inspection interval|acceptance criteria|report|reports|inspection|equipment|pump|discharge|suction|pressure|flow rate|temperature|transmitter)\b/i.test(
      userRequest
    );

  const hasExplicitEngineeringIntent =
    /\b(formula|pressure difference|pressure diff|delta p|percentage difference|percentage change|efficiency|power|density|flow rate|velocity|kinetic energy|potential energy|convert|conversion|psi to bar|bar to psi|celsius|fahrenheit|threshold|limit check|exceeds limit|is within limit|statistics|mean|median|variance|standard deviation|trend|trend analysis)\b/i.test(
      userRequest
    );

  const hasExplicitDataAnalysisIntent =
    /\b(data|dataset|measurements|readings|sensor readings|tabular|csv|spreadsheet|values|statistics|mean|average|median|variance|standard deviation|trend|highest|lowest)\b/i.test(
      userRequest
    );

  const isDirectCalculationWithNumbers =
    (hasExplicitEngineeringIntent || hasExplicitDataAnalysisIntent) &&
    /\d+/.test(userRequest) &&
    !/\b(according to|sop|manual|manuals|policy|policies|guideline|guidelines|procedure|procedures|regulation|regulations|safety requirement|safety requirements|prv|cdu|crude distillation|acceptance criteria|report|reports|standard|standards)\b/i.test(userRequest);

  // 1. DOCUMENT / RETRIEVAL POLICY:
  if (steps.length === 0 && isDocumentQuestion && !isDirectCalculationWithNumbers && (toolName === "calculator" || toolName === "text_transform" || toolName === "coding")) {
    return {
      valid: false,
      reason: `For document queries, retrieve_information must be used first to gather context before calling other tools.`,
    };
  }

  // 2. TEXT TRANSFORM POLICY:
  if (toolName === "text_transform") {
    const hasExplicitTransformRequest =
      /\b(uppercase|upper case|lowercase|lower case|capital|all caps|capitalize|word count|count words|count\s+(?:the\s+)?words|character count|char count|count characters|count\s+(?:the\s+)?characters|reverse text|reverse string|reverse the|trim whitespace|trim text|summarize|summary)\b/i.test(
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

  // 8. ENGINEERING FORMULA POLICY GUARD:
  if (toolName === "engineering_formula") {
    const rawFormula = String(decision.input?.formula || "").trim().toLowerCase().replace(/[\s\-]+/g, "_");
    if (!rawFormula) {
      return {
        valid: false,
        reason: "engineering_formula requires a valid 'formula' name (e.g. 'pressure_difference', 'percentage_difference', 'percentage_change', 'efficiency', 'electrical_power', 'mechanical_power', 'density', 'flow_rate', 'velocity', 'kinetic_energy', 'potential_energy').",
      };
    }
  }

  // 9. UNIT CONVERSION POLICY GUARD:
  if (toolName === "unit_conversion") {
    const fromUnit = decision.input?.from_unit || decision.input?.fromUnit || decision.input?.from;
    const toUnit = decision.input?.to_unit || decision.input?.toUnit || decision.input?.to;
    if (!fromUnit || !toUnit) {
      return {
        valid: false,
        reason: "unit_conversion requires both 'from_unit' and 'to_unit' parameters.",
      };
    }
  }

  // 10. THRESHOLD CHECK POLICY GUARD:
  if (toolName === "threshold_check") {
    const val = decision.input?.value !== undefined ? decision.input?.value : decision.input?.val;
    const lim = decision.input?.limit !== undefined ? decision.input?.limit : decision.input?.threshold;
    if (val === undefined || Number.isNaN(Number(val))) {
      return {
        valid: false,
        reason: "threshold_check requires a numeric 'value' to check.",
      };
    }
    if (lim === undefined || Number.isNaN(Number(lim))) {
      return {
        valid: false,
        reason: "threshold_check requires a numeric 'limit' threshold. If the limit is unknown, retrieve it from the Knowledge Base or report it as unavailable; never invent safety limits.",
      };
    }
  }

  // 11. STATISTICS POLICY GUARD:
  if (toolName === "statistics") {
    const vals = decision.input?.values || decision.input?.data;
    if (!Array.isArray(vals) || vals.length === 0) {
      return {
        valid: false,
        reason: "statistics tool requires a non-empty 'values' array.",
      };
    }
  }

  // 12. TREND ANALYSIS POLICY GUARD:
  if (toolName === "trend_analysis") {
    const vals = decision.input?.values || decision.input?.data || decision.input?.series;
    if (!Array.isArray(vals) || vals.length < 2) {
      return {
        valid: false,
        reason: "trend_analysis tool requires an array of at least 2 sequential numerical values.",
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
  classifyInitialWorkflow,
  parseBrainOutput,
  validateToolSelectionPolicy,
};
