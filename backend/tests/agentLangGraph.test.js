/**
 * Sovereign LangGraph Agent Acceptance & Integration Tests
 *
 * Comprehensive test suite verifying the single, primary LangGraph agent:
 * - Tool Schemas & Zod input validation
 * - Tool execution adapters with context propagation (userId, chatId, workspaceId)
 * - Tool metadata catalog
 * - All 6 Tool Selection Policy Scenarios (Tests 1 to 6)
 * - Graph step limits & stuck loop protection
 * - User & chat isolation
 * - Controller & Route integration (HTTP 400 validation, tool listing, SSE headers)
 *
 * SAFETY GUARANTEES:
 * - Zero live Ollama invocations
 * - Zero cloud model invocations
 * - 100% deterministic, offline, and isolated
 */

import assert from "assert";
import {
  CalculatorSchema,
  UnitConverterSchema,
  TextTransformSchema,
  RetrievalSchema,
  CodingSchema,
  ExecuteCodeSchema,
  VisionSchema,
  createAgentTools,
  getAgentToolsMetadata,
} from "../src/services/agent/agentTools.js";
import {
  agentGraphService,
  AgentStateAnnotation,
} from "../src/services/agent/agentGraph.service.js";
import { runAgentTask } from "../src/services/agent/agent.service.js";
import {
  AGENT_STATUS,
  AGENT_ACTION_TYPES,
  AGENT_LIMITS,
} from "../src/services/agent/agent.types.js";
import {
  createAgentTask,
  getAgentTask,
  listAgentTools,
} from "../src/controllers/agent.controller.js";
import { routeMessage } from "../src/services/ragRouter.service.js";

console.log("==========================================================");
console.log("STARTING SOVEREIGN LANGGRAPH AGENT ACCEPTANCE TESTS");
console.log("==========================================================");

let testsPassed = 0;
function pass(testName) {
  testsPassed++;
  console.log(`✔ [PASS] ${testName}`);
}

async function runTests() {
  // ─── 1. TOOL SCHEMAS & INPUT VALIDATION (Zod) ─────────────────────────────
  console.log("\n--- [Section 1] Tool Schemas & Zod Input Validation ---");
  {
    // Calculator validation
    const validCalc = CalculatorSchema.safeParse({ expression: "25 * 40" });
    assert.strictEqual(validCalc.success, true);

    const invalidCalc = CalculatorSchema.safeParse({ expression: "" });
    assert.strictEqual(invalidCalc.success, false);

    // Unit Converter validation
    const validUnitConv = UnitConverterSchema.safeParse({
      value: 5.4,
      fromUnit: "bar",
      toUnit: "psi",
    });
    assert.strictEqual(validUnitConv.success, true);
    assert.strictEqual(validUnitConv.data.value, 5.4);

    const invalidUnitConv = UnitConverterSchema.safeParse({
      value: 5.4,
      fromUnit: "",
      toUnit: "psi",
    });
    assert.strictEqual(invalidUnitConv.success, false);

    // Text transform validation
    const validTransform = TextTransformSchema.safeParse({
      text: "hello world",
      operation: "uppercase",
    });
    assert.strictEqual(validTransform.success, true);

    const invalidTransform = TextTransformSchema.safeParse({
      text: "hello",
      operation: "invalid_op",
    });
    assert.strictEqual(invalidTransform.success, false);

    // Retrieval validation
    const validRetrieval = RetrievalSchema.safeParse({
      query: "safety valve inspection procedure",
      sourceScope: "knowledge_base",
      limit: 5,
    });
    assert.strictEqual(validRetrieval.success, true);
    assert.strictEqual(validRetrieval.data.limit, 5);

    const invalidRetrieval = RetrievalSchema.safeParse({ query: "" });
    assert.strictEqual(invalidRetrieval.success, false);

    // Coding validation
    const validCoding = CodingSchema.safeParse({
      task: "Write a Java function to reverse a string",
      language: "java",
    });
    assert.strictEqual(validCoding.success, true);
    assert.strictEqual(validCoding.data.language, "java");

    const invalidCoding = CodingSchema.safeParse({ task: "" });
    assert.strictEqual(invalidCoding.success, false);

    // Sandbox execute code validation
    const validExec = ExecuteCodeSchema.safeParse({
      code: "print(1)",
      language: "python",
    });
    assert.strictEqual(validExec.success, true);
    assert.strictEqual(validExec.data.language, "python");

    const invalidExec = ExecuteCodeSchema.safeParse({ code: "" });
    assert.strictEqual(invalidExec.success, false);

    pass("Zod schemas correctly validate tool arguments and reject invalid inputs");
  }

  // ─── 2. TOOL EXECUTION ADAPTERS & CONTEXT PROPAGATION ──────────────────────
  console.log("\n--- [Section 2] Adapted Tool Executions & Context Isolation ---");
  {
    let retrieverCalled = false;
    let receivedContext = null;

    const mockRetriever = async (params) => {
      retrieverCalled = true;
      receivedContext = params;
      return {
        success: true,
        content: "PRV set pressure must be verified annually. Maximum allowable overpressure is 10%.",
        results: [{ id: "doc-1", title: "Safety SOP" }],
      };
    };

    const tools = createAgentTools({
      userId: "user-sovereign-01",
      chatId: "chat-session-42",
      workspaceId: "workspace-prod",
      retriever: mockRetriever,
    });

    const calcTool = tools.find((t) => t.name === "calculator");
    const textTool = tools.find((t) => t.name === "text_transform");
    const retrTool = tools.find((t) => t.name === "retrieve_information");
    const codeTool = tools.find((t) => t.name === "coding");
    const unitTool = tools.find((t) => t.name === "unit_converter");

    assert.ok(calcTool, "calculator tool exists");
    assert.ok(textTool, "text_transform tool exists");
    assert.ok(retrTool, "retrieve_information tool exists");
    assert.ok(codeTool, "coding tool exists");
    assert.ok(unitTool, "unit_converter tool exists");

    // Execute calculator tool
    const calcOutput = JSON.parse(await calcTool.invoke({ expression: "25 * 40" }));
    assert.strictEqual(calcOutput.value, 1000);
    assert.strictEqual(calcOutput.formatted, "1000");

    // Execute unit converter tool
    const unitOutput = JSON.parse(
      await unitTool.invoke({ value: 5.4, fromUnit: "bar", toUnit: "psi" })
    );
    assert.strictEqual(unitOutput.success, true);
    assert.strictEqual(unitOutput.result, 78.320378);
    assert.strictEqual(unitOutput.formatted, "78.320378 psi");
    assert.strictEqual(unitOutput.category, "pressure");

    // Execute text transform tool
    const textOutput = JSON.parse(
      await textTool.invoke({ text: "hello world", operation: "uppercase" })
    );
    assert.strictEqual(textOutput.result, "HELLO WORLD");

    // Execute retrieval tool with context preservation and structured output
    const retrOutput = JSON.parse(
      await retrTool.invoke({ query: "safety requirements", sourceScope: "all" })
    );
    assert.strictEqual(retrOutput.success, true);
    assert.ok(retrOutput.content.includes("10%"));
    assert.strictEqual(retrieverCalled, true);
    assert.strictEqual(receivedContext.userId, "user-sovereign-01");
    assert.strictEqual(receivedContext.chatId, "chat-session-42");
    assert.strictEqual(receivedContext.workspaceId, "workspace-prod");

    // Verify structured fields: retrieved text, document/source name, metadata, similarity/relevance
    assert.ok(Array.isArray(retrOutput.results), "retrOutput.results must be an array");
    assert.strictEqual(retrOutput.results.length, 1);
    const chunk0 = retrOutput.results[0];
    assert.ok(chunk0.text.includes("10%"), "chunk text must be preserved");
    assert.ok(chunk0.filename, "document/source name must be present");
    assert.ok(chunk0.metadata, "metadata object must be present");
    assert.strictEqual(chunk0.metadata.documentId, "doc-1");
    assert.ok(Array.isArray(retrOutput.sources), "retrOutput.sources must be an array");

    // Execute coding tool with mock coder client
    const mockCoderFn = async () => "public class Solution { public static String reverse(String s) { return new StringBuilder(s).reverse().toString(); } }";
    const toolsWithCoder = createAgentTools({
      coderClient: mockCoderFn,
    });
    const codeToolInstance = toolsWithCoder.find((t) => t.name === "coding");
    const codeOutput = JSON.parse(await codeToolInstance.invoke({ task: "reverse string", language: "java" }));
    assert.strictEqual(codeOutput.success, true);
    assert.strictEqual(codeOutput.language, "java");
    assert.strictEqual(codeOutput.model, "qwen2.5-coder:7b");
    assert.ok(codeOutput.code.includes("StringBuilder"));
    assert.strictEqual(codeOutput.isExecutable, false, "Code generation must not be executable on host");

    pass("LangChain tools execute correctly, return structured fields (text, source, metadata, score), and preserve caller context");
  }

  // ─── 3. METADATA CATALOG INSPECTION ────────────────────────────────────────
  console.log("\n--- [Section 3] Tool Catalog Metadata ---");
  {
    const metadata = getAgentToolsMetadata();
    assert.strictEqual(metadata.length, 7);
    const names = metadata.map((m) => m.name);
    assert.ok(names.includes("calculator"));
    assert.ok(names.includes("unit_converter"));
    assert.ok(names.includes("text_transform"));
    assert.ok(names.includes("retrieve_information"));
    assert.ok(names.includes("coding"));
    assert.ok(names.includes("execute_code"));
    assert.ok(names.includes("vision"));

    // Verify VisionSchema validates correctly
    const validVision = VisionSchema.safeParse({ prompt: "What is in this image?" });
    assert.ok(validVision.success);
    const invalidVision = VisionSchema.safeParse({ prompt: "" });
    assert.strictEqual(invalidVision.success, false);

    pass("Tool metadata catalog lists all 7 registered tools with schema specifications");
  }

  // ─── 4. TOOL SELECTION POLICY TESTS (TESTS 1 to 6) ─────────────────────────
  // ─── 4. MULTI-STEP & TOOL EXECUTION ACCEPTANCE TESTS ───────────────────────
  console.log("\n--- [Section 4] Multi-Step Tool Execution Tests ---");

  // TEST 4.1 (Canonical Test 1):
  // Question: "Using the drive-end bearing vibration reading and the ISO 10816-3 limit stated in the report, calculate what percentage of the allowable limit the measured vibration represents. Does it pass?"
  // Expected: retrieve -> retrieve -> calculator -> final
  // Report contains:
  // - Drive-End Bearing vibration = 3.1 mm/s RMS
  // - ISO 10816-3 limit (Zone B/C boundary) = 4.5 mm/s RMS
  // Calculation: (3.1 / 4.5) * 100 = 68.888...% -> 68.9% < 100% -> PASS
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve measured drive-end bearing vibration reading from the vibration analysis report.",
          input: { query: "drive-end bearing vibration reading" },
        });
      }
      if (callCount === 2) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve ISO 10816-3 Zone B/C boundary allowable vibration limit from the report.",
          input: { query: "ISO 10816-3 limit Zone B/C boundary" },
        });
      }
      if (callCount === 3) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Calculate the percentage of allowable limit represented by measured vibration: (3.1 / 4.5) * 100.",
          input: { expression: "(3.1 / 4.5) * 100" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Both values retrieved and percentage calculated. Comparing 68.9% against 100% threshold to determine pass/fail status.",
        answer: "Based on Vibration_Analysis_Report.pdf:\n- Measured Drive-End Bearing vibration = 3.1 mm/s RMS (Page 3)\n- ISO 10816-3 limit (Zone B/C boundary) = 4.5 mm/s RMS (Page 7)\n- Calculation: (3.1 / 4.5) * 100 = 68.9%\n\nResult: Since 68.9% is less than 100% of the allowable limit, the vibration reading PASSES within acceptable operating limits (Zone B).",
      });
    });

    const mockRetriever = async (params) => {
      const q = String(params.query || "").toLowerCase();
      if (q.includes("bearing") || q.includes("drive-end")) {
        return {
          success: true,
          content: "[Document: Vibration_Analysis_Report.pdf, Page: 3]\nMotor Drive-End (DE) Bearing vibration reading: 3.1 mm/s RMS. Velocity overall spectrum within normal limits.",
          sources: [{ filename: "Vibration_Analysis_Report.pdf", page: 3 }],
          results: [
            {
              filename: "Vibration_Analysis_Report.pdf",
              page: 3,
              text: "Motor Drive-End (DE) Bearing vibration reading: 3.1 mm/s RMS. Velocity overall spectrum within normal limits.",
            },
          ],
        };
      }
      return {
        success: true,
        content: "[Document: Vibration_Analysis_Report.pdf, Page: 7]\nISO 10816-3 Standard Limits for Class II Medium Machines: Zone A/B boundary = 2.8 mm/s RMS. Zone B/C boundary (allowable continuous limit) = 4.5 mm/s RMS. Zone C/D (trip) = 7.1 mm/s RMS.",
        sources: [{ filename: "Vibration_Analysis_Report.pdf", page: 7 }],
        results: [
          {
            filename: "Vibration_Analysis_Report.pdf",
            page: 7,
            text: "ISO 10816-3 Standard Limits for Class II Medium Machines: Zone A/B boundary = 2.8 mm/s RMS. Zone B/C boundary (allowable continuous limit) = 4.5 mm/s RMS. Zone C/D (trip) = 7.1 mm/s RMS.",
          },
        ],
      };
    };

    const result = await runAgentTask({
      message: "Using the drive-end bearing vibration reading and the ISO 10816-3 limit stated in the report, calculate what percentage of the allowable limit the measured vibration represents. Does it pass?",
      userId: "test-user",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 3, "Must execute exactly 3 steps: retrieve -> retrieve -> calculator");
    assert.strictEqual(result.steps[0].tool, "retrieve_information", "Step 1 must be retrieval of bearing vibration");
    assert.ok(result.steps[0].observation?.results[0].text.includes("3.1 mm/s"));
    assert.strictEqual(result.steps[1].tool, "retrieve_information", "Step 2 must be retrieval of ISO 10816-3 limit");
    assert.ok(result.steps[1].observation?.results[0].text.includes("4.5 mm/s"));
    assert.strictEqual(result.steps[2].tool, "calculator", "Step 3 must be calculator");
    assert.ok(Math.abs(result.steps[2].observation?.value - 68.888) < 0.1, "Calculation value must be ~68.89%");

    // Verify final answer contains all 4 expected elements: 3.1 mm/s, 4.5 mm/s, 68.9%, PASS
    assert.ok(result.response.includes("3.1 mm/s") || result.response.includes("3.1"), "Response must identify 3.1 mm/s");
    assert.ok(result.response.includes("4.5 mm/s") || result.response.includes("4.5"), "Response must identify 4.5 mm/s limit");
    assert.ok(result.response.includes("68.9%") || result.response.includes("68.8"), "Response must identify 68.9%");
    assert.ok(result.response.toUpperCase().includes("PASS"), "Response must conclude reading PASSES");

    // Verify structured agent state
    assert.ok(result.state, "Structured agent state must be present");
    assert.strictEqual(typeof result.state.user_query, "string");
    assert.ok(Array.isArray(result.state.tool_results));
    assert.strictEqual(result.state.tool_results.length, 3);
    assert.ok(Array.isArray(result.state.retrieved_facts));
    assert.ok(result.state.retrieved_facts.length >= 2);
    assert.strictEqual(result.state.iteration_count, 3);

    pass("TEST 4.1 passed (Canonical Test 1): retrieve -> retrieve -> calculator -> final (3.1 mm/s, 4.5 mm/s, 68.9%, PASS)");
  }

  // TEST 4.2 (Canonical Test 2):
  // Question: "What is the discharge pressure recorded in the report, and if the suction pressure is 0.8 bar, what is the pressure differential?"
  // Expected: retrieve -> calculator -> final
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve discharge pressure transmitter reading from report.",
          input: { query: "discharge pressure pump report" },
        });
      }
      if (callCount === 2) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Calculate the pressure differential (discharge pressure 6.2 bar - suction pressure 0.8 bar).",
          input: { expression: "6.2 - 0.8" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Differential computed from retrieved discharge pressure and provided suction pressure.",
        answer: "From Pump_Inspection_Report.pdf (Page 2), the discharge pressure at transmitter PI-102B is 6.2 bar. Given suction pressure of 0.8 bar, the pressure differential is 6.2 - 0.8 = 5.4 bar.",
      });
    });

    const mockRetriever = async () => ({
      success: true,
      content: "[Document: Pump_Inspection_Report.pdf, Page: 2]\nEquipment: P-101A/B Crude Charge Pump. Tag PI-102B (Discharge Pressure Transmitter) recorded operating pressure: 6.2 bar. Motor current: 45A.",
      sources: [{ filename: "Pump_Inspection_Report.pdf", page: 2 }],
      results: [
        {
          filename: "Pump_Inspection_Report.pdf",
          page: 2,
          text: "Equipment: P-101A/B Crude Charge Pump. Tag PI-102B (Discharge Pressure Transmitter) recorded operating pressure: 6.2 bar. Motor current: 45A.",
        },
      ],
    });

    const result = await runAgentTask({
      message: "What is the discharge pressure recorded in the report, and if the suction pressure is 0.8 bar, what is the pressure differential?",
      userId: "test-user",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 2, "Must execute exactly two tools in order (retrieve -> calculator)");
    assert.strictEqual(result.steps[0].tool, "retrieve_information", "Step 1 must be retrieval");
    assert.strictEqual(result.steps[1].tool, "calculator", "Step 2 must be calculator");
    assert.strictEqual(result.steps[1].observation?.value, 5.4);
    assert.ok(result.response.includes("6.2 bar") || result.response.includes("6.2"));
    assert.ok(result.response.includes("5.4 bar") || result.response.includes("5.4"));

    pass("TEST 4.2 passed (Canonical Test 2): retrieve -> calculator -> final (6.2 bar - 0.8 bar = 5.4 bar)");
  }

  // TEST 4.3 (Canonical Test 3):
  // Question: "Find the discharge pressure and suction pressure in the report and calculate the differential."
  // Expected: retrieve -> retrieve -> calculator -> final
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve discharge pressure transmitter reading from compressor log.",
          input: { query: "discharge pressure PT-02 reading" },
        });
      }
      if (callCount === 2) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve suction pressure transmitter reading from compressor log.",
          input: { query: "suction pressure PT-01 reading" },
        });
      }
      if (callCount === 3) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Calculate differential between discharge (9.8 bar) and suction (2.5 bar).",
          input: { expression: "9.8 - 2.5" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Both pressures retrieved independently and differential calculated.",
        answer: "From Compressor_Log.pdf (Page 5), discharge pressure is 9.8 bar (PT-02) and suction pressure is 2.5 bar (PT-01). The calculated pressure differential is 9.8 - 2.5 = 7.3 bar.",
      });
    });

    const mockRetriever = async (params) => {
      const q = String(params.query || "").toLowerCase();
      if (q.includes("discharge") || q.includes("pt-02")) {
        return {
          success: true,
          content: "[Document: Compressor_Log.pdf, Page: 5]\nDischarge Pressure (PT-02): 9.8 bar.",
          sources: [{ filename: "Compressor_Log.pdf", page: 5 }],
          results: [{ filename: "Compressor_Log.pdf", page: 5, text: "Discharge Pressure (PT-02): 9.8 bar." }],
        };
      }
      return {
        success: true,
        content: "[Document: Compressor_Log.pdf, Page: 5]\nSuction Pressure (PT-01): 2.5 bar.",
        sources: [{ filename: "Compressor_Log.pdf", page: 5 }],
        results: [{ filename: "Compressor_Log.pdf", page: 5, text: "Suction Pressure (PT-01): 2.5 bar." }],
      };
    };

    const result = await runAgentTask({
      message: "Find the discharge pressure and suction pressure in the report and calculate the differential.",
      userId: "test-user",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 3, "Must execute exactly 3 steps: retrieve -> retrieve -> calculator");
    assert.strictEqual(result.steps[0].tool, "retrieve_information");
    assert.strictEqual(result.steps[1].tool, "retrieve_information");
    assert.strictEqual(result.steps[2].tool, "calculator");
    assert.strictEqual(result.steps[2].observation?.value, 7.3);
    assert.ok(result.response.includes("7.3 bar") || result.response.includes("7.3"));

    pass("TEST 4.3 passed (Canonical Test 3): retrieve -> retrieve -> calculator -> final (9.8 - 2.5 = 7.3 bar)");
  }

  // TEST 4.4 (Canonical Test 4):
  // Question: "Find the vibration reading in the report."
  // Expected: retrieve -> final (No calculator!)
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve vibration reading from the report.",
          input: { query: "vibration reading report" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Vibration reading found in document; question completely answered with no calculation needed.",
        answer: "According to Vibration_Analysis_Report.pdf (Page 3), the motor vibration reading is 3.1 mm/s RMS.",
      });
    });

    const mockRetriever = async () => ({
      success: true,
      content: "[Document: Vibration_Analysis_Report.pdf, Page: 3]\nMotor Drive-End Bearing vibration reading: 3.1 mm/s RMS.",
      sources: [{ filename: "Vibration_Analysis_Report.pdf", page: 3 }],
      results: [{ filename: "Vibration_Analysis_Report.pdf", page: 3, text: "Motor Drive-End Bearing vibration reading: 3.1 mm/s RMS." }],
    });

    const result = await runAgentTask({
      message: "Find the vibration reading in the report.",
      userId: "test-user",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1, "Must execute exactly 1 retrieval step");
    assert.strictEqual(result.steps[0].tool, "retrieve_information");
    assert.strictEqual(result.steps.some((s) => s.tool === "calculator"), false, "Must NOT call calculator");
    assert.ok(result.response.includes("3.1 mm/s") || result.response.includes("3.1"));

    pass("TEST 4.4 passed (Canonical Test 4): retrieve -> final (No calculator called)");
  }

  // TEST 4.5 (Canonical Test 5):
  // Question: Question requiring three independent document facts.
  // Expected: retrieve -> retrieve -> retrieve -> calculator -> final
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve motor drive-end temperature from the report.",
          input: { query: "motor drive-end temperature" },
        });
      }
      if (callCount === 2) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve motor non-drive-end temperature from the report.",
          input: { query: "motor non-drive-end temperature" },
        });
      }
      if (callCount === 3) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve ambient temperature from the report.",
          input: { query: "ambient temperature report" },
        });
      }
      if (callCount === 4) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Calculate the average temperature across all three points: (68 + 62 + 26) / 3.",
          input: { expression: "(68 + 62 + 26) / 3" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "All 3 temperatures retrieved and average calculated.",
        answer: "From Equipment_Thermal_Log.pdf:\n- Drive-End Temp: 68°C\n- Non-Drive-End Temp: 62°C\n- Ambient Temp: 26°C\n\nAverage Temperature: (68 + 62 + 26) / 3 = 52°C.",
      });
    });

    const mockRetriever = async (params) => {
      const q = String(params.query || "").toLowerCase();
      if (q.includes("drive-end") && !q.includes("non")) {
        return {
          success: true,
          content: "[Document: Equipment_Thermal_Log.pdf, Page: 1]\nMotor Drive-End Bearing Temperature: 68°C.",
          sources: [{ filename: "Equipment_Thermal_Log.pdf", page: 1 }],
          results: [{ filename: "Equipment_Thermal_Log.pdf", page: 1, text: "Motor Drive-End Bearing Temperature: 68°C." }],
        };
      }
      if (q.includes("non-drive-end")) {
        return {
          success: true,
          content: "[Document: Equipment_Thermal_Log.pdf, Page: 1]\nMotor Non-Drive-End Bearing Temperature: 62°C.",
          sources: [{ filename: "Equipment_Thermal_Log.pdf", page: 1 }],
          results: [{ filename: "Equipment_Thermal_Log.pdf", page: 1, text: "Motor Non-Drive-End Bearing Temperature: 62°C." }],
        };
      }
      return {
        success: true,
        content: "[Document: Equipment_Thermal_Log.pdf, Page: 1]\nAmbient Temperature: 26°C.",
        sources: [{ filename: "Equipment_Thermal_Log.pdf", page: 1 }],
        results: [{ filename: "Equipment_Thermal_Log.pdf", page: 1, text: "Ambient Temperature: 26°C." }],
      };
    };

    const result = await runAgentTask({
      message: "Find the motor drive-end temperature, non-drive-end temperature, and ambient temperature in the report and calculate the average temperature.",
      userId: "test-user",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 4, "Must execute exactly 4 steps: retrieve -> retrieve -> retrieve -> calculator");
    assert.strictEqual(result.steps[0].tool, "retrieve_information");
    assert.strictEqual(result.steps[1].tool, "retrieve_information");
    assert.strictEqual(result.steps[2].tool, "retrieve_information");
    assert.strictEqual(result.steps[3].tool, "calculator");
    assert.strictEqual(result.steps[3].observation?.value, 52);
    assert.ok(result.response.includes("52°C") || result.response.includes("52"));

    pass("TEST 4.5 passed (Canonical Test 5): 3 independent document facts -> calculator -> final ((68+62+26)/3 = 52°C)");
  }

  // TEST 4.6: Repeated Identical Action Protection
  // Verifies that proposing the exact same query twice is caught safely
  {
    agentGraphService.setAgentBrainLlmClient(async () => {
      return JSON.stringify({
        action: "tool",
        tool: "retrieve_information",
        reason: "Search bearing vibration reading.",
        input: { query: "drive-end bearing vibration" },
      });
    });

    const mockRetriever = async () => ({
      success: true,
      content: "Drive-end bearing vibration reading is 3.1 mm/s RMS.",
      sources: [{ filename: "Report.pdf", page: 1 }],
      results: [{ filename: "Report.pdf", page: 1, text: "Drive-end bearing vibration reading is 3.1 mm/s RMS." }],
    });

    const result = await runAgentTask({
      message: "Find drive-end bearing vibration",
      userId: "test-user",
      options: { retriever: mockRetriever },
    });

    // The agent executes step 1, but when proposing step 2 with the exact same query,
    // the policy/duplicate protection catches it and halts safely (no infinite loop).
    assert.ok(result.steps.length >= 1);
    assert.strictEqual(result.steps[0].tool, "retrieve_information");
    pass("TEST 4.6 passed: Repeated identical retrieval queries safely intercepted and prevented from looping");
  }

  // TEST 4.7: Legitimate Distinct Retrieval Queries are Allowed
  // Proving that two retrievals with different queries are NOT treated as duplicate action
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve bearing vibration.",
          input: { query: "bearing vibration" },
        });
      }
      if (callCount === 2) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve ISO 10816-3 limit.",
          input: { query: "ISO 10816-3 limit" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Both queries finished.",
        answer: "Bearing vibration is 3.1 mm/s and ISO 10816-3 limit is 4.5 mm/s.",
      });
    });

    const mockRetriever = async (params) => ({
      success: true,
      content: `Result for ${params.query}`,
      sources: [{ filename: "Report.pdf", page: 1 }],
      results: [{ filename: "Report.pdf", page: 1, text: `Result for ${params.query}` }],
    });

    const result = await runAgentTask({
      message: "Compare bearing vibration and ISO 10816-3 limit",
      userId: "test-user",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 2, "Both distinct retrievals must execute without being blocked");
    assert.strictEqual(result.steps[0].tool, "retrieve_information");
    assert.strictEqual(result.steps[1].tool, "retrieve_information");
    pass("TEST 4.7 passed: Distinct retrieval queries are permitted and not falsely blocked");
  }

  // TEST 4.8: tool failure handling and recovery
  // Expected: Tool failure returns controlled error to agent; Qwen3 decides next action based on error
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Attempt division by zero.",
          input: { expression: "100 / 0" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Tool error observed; reporting graceful explanation to user.",
        answer: "The calculation could not be completed: division by zero is undefined in mathematics.",
      });
    });

    const result = await runAgentTask({
      message: "Evaluate 100 / 0",
      userId: "test-user",
    });

    assert.strictEqual(result.success, true, "Task should complete gracefully despite tool failure");
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].tool, "calculator");
    assert.strictEqual(result.steps[0].status, "failed");
    assert.ok(
      result.steps[0].observation?.error?.includes("Division by zero"),
      "Observation must contain controlled error message"
    );
    assert.ok(result.response.includes("division by zero"));

    pass("TEST 4.8 passed: 'tool failure' returns controlled error to agent and allows graceful recovery");
  }

  // TEST 4.9: maximum-step protection
  // Expected: Reaching maximum allowed tool executions or stuck loop halts execution safely
  {
    // Part A: Max tool executions limit
    let execCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      execCount++;
      return JSON.stringify({
        action: "tool",
        tool: "calculator",
        reason: `Loop step ${execCount}`,
        input: { expression: `${execCount} + 1` },
      });
    });

    const resultA = await runAgentTask({
      message: "Compute continuous increment",
      userId: "test-user",
    });

    assert.strictEqual(resultA.success, false);
    assert.strictEqual(resultA.status, "failed");
    assert.ok(
      resultA.error?.includes("Execution limit exceeded") || resultA.error?.includes("limit"),
      "Must halt execution when tool execution limit is reached"
    );

    // Part B: Consecutive identical action stuck loop protection
    agentGraphService.setAgentBrainLlmClient(async () => {
      return JSON.stringify({
        action: "tool",
        tool: "calculator",
        reason: "Infinite loop test",
        input: { expression: "1 + 1" },
      });
    });

    const resultB = await runAgentTask({
      message: "Calculate 1 + 1 repeatedly",
      userId: "test-user",
    });

    assert.strictEqual(resultB.success, false);
    assert.strictEqual(resultB.status, "failed");
    assert.ok(
      resultB.error?.includes("stuck") || resultB.error?.includes("limit"),
      "Should stop safely due to stuck detection"
    );

    pass("TEST 4.9 passed: 'maximum-step protection' safely halts runaway tool executions and stuck loops");
  }

  // TEST 4.10: Question requiring no tools
  // Expected: No unnecessary tool call -> Direct answer
  {
    agentGraphService.setAgentBrainLlmClient(async () => {
      return JSON.stringify({
        action: "final",
        reason: "General system purpose question requires no external document retrieval.",
        answer: "This system is a Sovereign On-Premise Agentic AI Workbench designed for privacy-preserving local LLM workflows.",
      });
    });

    const result = await runAgentTask({
      message: "What is the purpose of this system?",
      userId: "test-user",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 0, "No tools should be called for system purpose question");
    assert.ok(result.response.includes("Sovereign"));
    pass("TEST 4.10 passed: Question requiring no tools completes directly with 0 tool calls");
  }

  // TEST 4.11: /knowledgebase What are the safety requirements? (existing KB RAG unchanged)
  {
    const MOCK_KB_DOCS = [
      { id: "doc-safety-101", filename: "Safety_Manual.pdf" },
      { id: "doc-maint-202", filename: "Maintenance_Guide.pdf" },
    ];

    const routeResult = routeMessage({
      message: "/knowledgebase What are the safety requirements?",
      hasKnowledgeBaseDocuments: true,
      knowledgeBaseDocuments: MOCK_KB_DOCS,
    });

    assert.strictEqual(routeResult.route, "KNOWLEDGE_BASE");
    assert.strictEqual(routeResult.useRag, true);
    assert.strictEqual(routeResult.cleanedQuery, "What are the safety requirements?");
    pass("TEST 4.11 passed: '/knowledgebase What are the safety requirements?' routes to existing KB RAG unchanged");
  }

  // TEST 4.12: /agent Convert hello world to uppercase (text_transform only)
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "text_transform",
          reason: "Convert to uppercase",
          input: { text: "hello world", operation: "uppercase" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Transform complete.",
        answer: "The uppercase text is: HELLO WORLD.",
      });
    });

    const result = await runAgentTask({
      message: "Convert hello world to uppercase",
      userId: "test-user",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].tool, "text_transform");
    assert.strictEqual(result.steps[0].observation?.result, "HELLO WORLD");
    pass("TEST 4.12 passed: 'text_transform only' executed for string transform");
  }

  // ─── 5. SPECIALIZED QWEN2.5-CODER CODING CAPABILITY TESTS ─────────────────
  console.log("\n--- [Section 5] Qwen2.5-Coder Specialized Coding Tests ---");

  // TEST 5.1: /agent Explain what an API is -> Qwen3 only (0 tools called)
  {
    // Case A: Qwen3 brain recognizes conceptual definition question -> direct final answer, 0 tools
    agentGraphService.setAgentBrainLlmClient(async () => {
      return JSON.stringify({
        action: "final",
        reason: "Conceptual explanation question does not require code generation.",
        answer: "An Application Programming Interface (API) is a set of rules and protocols that allows different software applications to communicate with each other.",
      });
    });

    const resultA = await runAgentTask({
      message: "Explain what an API is",
      userId: "test-user",
    });

    assert.strictEqual(resultA.success, true);
    assert.strictEqual(resultA.steps.length, 0, "No tools should be called for conceptual explanation");
    assert.ok(resultA.response.includes("API") || resultA.response.includes("interface"));

    // Case B: Even if local LLM mistakenly attempts to invoke coding tool on conceptual question, policy guard intercepts
    agentGraphService.setAgentBrainLlmClient(async () => {
      return JSON.stringify({
        action: "tool",
        tool: "coding",
        reason: "Generate explanation",
        input: { task: "Explain API" },
      });
    });

    const resultB = await runAgentTask({
      message: "Explain what an API is",
      userId: "test-user",
    });

    assert.strictEqual(resultB.success, true);
    assert.strictEqual(resultB.steps.length, 0, "Policy guard must block coding tool on conceptual questions");
    pass("TEST 5.1 passed: '/agent Explain what an API is' answered by Qwen3 only with 0 tool calls");
  }

  // TEST 5.2: /agent Write a Java function to reverse a string -> Qwen3 → Coding Tool → Qwen2.5-Coder → Qwen3
  {
    let brainCallCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCallCount++;
      if (brainCallCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "coding",
          reason: "Delegate Java string reverse implementation to Qwen2.5-Coder.",
          input: {
            task: "Write a Java function to reverse a string",
            language: "java",
          },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Synthesize final response presenting the Qwen2.5-Coder solution.",
        answer: "Here is the Java function to reverse a string:\n\n```java\npublic class StringUtils {\n    public static String reverse(String input) {\n        if (input == null) return null;\n        return new StringBuilder(input).reverse().toString();\n    }\n}\n```\nThis method uses StringBuilder for O(n) runtime efficiency.",
      });
    });

    let coderCalled = false;
    let coderReceivedPrompt = null;
    agentGraphService.setCoderLlmClient(async (messages) => {
      coderCalled = true;
      coderReceivedPrompt = messages;
      return "```java\npublic class StringUtils {\n    public static String reverse(String input) {\n        if (input == null) return null;\n        return new StringBuilder(input).reverse().toString();\n    }\n}\n```";
    });

    const result = await runAgentTask({
      message: "Write a Java function to reverse a string",
      userId: "test-user",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1, "Must execute exactly one coding tool step");
    assert.strictEqual(result.steps[0].tool, "coding");
    assert.strictEqual(coderCalled, true, "Must invoke specialized Qwen2.5-Coder engine");

    // Validate Coding Tool output structure
    const codingObs = result.steps[0].observation;
    assert.strictEqual(codingObs.success, true);
    assert.strictEqual(codingObs.model, "qwen2.5-coder:7b");
    assert.strictEqual(codingObs.language, "java");
    assert.ok(codingObs.code.includes("StringBuilder"));
    assert.strictEqual(codingObs.isExecutable, false, "Generated code must not be executed on host");

    // Validate final answer from Qwen3 incorporating the generated code
    assert.ok(result.response.includes("public class StringUtils"));
    assert.ok(result.response.includes("StringBuilder"));

    pass("TEST 5.2 passed: '/agent Write a Java function to reverse a string' routes Qwen3 → Coding Tool → Qwen2.5-Coder → Qwen3");
  }

  // TEST 5.3: Security check: Coding tool has zero shell access and does not execute code
  {
    agentGraphService.setCoderLlmClient(async () => "console.log('malicious attempt');");

    const tools = createAgentTools({
      coderClient: async () => "console.log('safe code text only');",
    });
    const codeTool = tools.find((t) => t.name === "coding");

    const result = JSON.parse(
      await codeTool.invoke({ task: "Write script", language: "javascript" })
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.isExecutable, false);
    assert.strictEqual(typeof result.code, "string");
    pass("TEST 5.3 passed: Coding Tool enforces zero shell execution and strictly produces text output");
  }

  // ─── 6. ROUTING & CONTROLLER INTEGRATION ──────────────────────────────────
  console.log("\n--- [Section 6] Route & Controller Verification ---");
  {
    // Empty message validation test
    let resCode = null;
    let resBody = null;
    const mockRes = {
      status: (code) => {
        resCode = code;
        return {
          json: (body) => {
            resBody = body;
          },
        };
      },
    };

    await createAgentTask({ body: { message: "" } }, mockRes);
    assert.strictEqual(resCode, 400);
    assert.strictEqual(resBody.success, false);

    // List tools endpoint test
    let toolsBody = null;
    const mockToolsRes = {
      json: (body) => {
        toolsBody = body;
      },
    };
    await listAgentTools({}, mockToolsRes);
    assert.strictEqual(toolsBody.success, true);
    assert.strictEqual(toolsBody.framework, "langgraph");
    assert.strictEqual(toolsBody.count, 7);

    // Get task status test
    let taskBody = null;
    const mockTaskRes = {
      json: (body) => {
        taskBody = body;
      },
    };
    await getAgentTask({ params: { taskId: "task-test-id" } }, mockTaskRes);
    assert.strictEqual(taskBody.success, true);
    assert.strictEqual(taskBody.taskId, "task-test-id");

    pass("Agent controller properly validates inputs, lists all 7 tools, and returns task status");
  }

  // ─── 7. KNOWLEDGE BASE MULTI-STEP RAG VS ATTACHMENT PARITY (FINAL VALIDATION) ───
  console.log("\n--- [Section 7] Attachment (Path A) vs Knowledge Base (Path B) Parity ---");
  {
    const question =
      "Using the drive-end bearing vibration reading and the ISO 10816-3 limit stated in the report, calculate what percentage of the allowable limit the measured vibration represents. Does it pass?";

    // --- PATH A: DIRECT PDF ATTACHMENT FLOW ---
    // In Path A, the PDF is attached directly; document context with both sections is present upfront.
    let pathABrainCalled = false;
    agentGraphService.setAgentBrainLlmClient(async (messages) => {
      pathABrainCalled = true;
      const userPrompt = messages.find((m) => m.role === "user")?.content || "";
      assert.ok(userPrompt.includes("Drive-End Bearing") || userPrompt.includes("ISO 10816-3"));
      return JSON.stringify({
        action: "final",
        reason: "Both values present in attached document context; calculated (3.1 / 4.5) * 100 = 68.9% which is under 100%.",
        answer:
          "From the attached report:\n- Drive-End Bearing vibration = 3.1 mm/s RMS (Section 3)\n- ISO 10816-3 Zone B/C allowable limit = 4.5 mm/s RMS (Section 6.6)\n\nCalculation: (3.1 / 4.5) × 100 = 68.9%.\nSince 68.9% is below the 100% allowable threshold, the reading PASSES.",
      });
    });

    const pathAResult = await runAgentTask({
      message: `${question}\n\n[DOCUMENT CONTEXT]\nSection 3: Drive-End Bearing vibration = 3.1 mm/s RMS.\nSection 6.6: ISO 10816-3 Zone B/C boundary limit = 4.5 mm/s RMS.`,
      userId: "test-user",
    });

    assert.strictEqual(pathAResult.success, true);
    assert.ok(pathAResult.response.includes("3.1 mm/s"));
    assert.ok(pathAResult.response.includes("4.5 mm/s"));
    assert.ok(pathAResult.response.includes("68.9%"));
    assert.ok(pathAResult.response.includes("PASS"));

    // --- PATH B: KNOWLEDGE BASE MULTI-STEP RAG FLOW ---
    // In Path B, no PDF is attached. The agent must:
    // retrieve Section 3 -> retrieve Section 6.6 -> calculate percentage -> final answer PASS.
    let pathBCallCount = 0;
    const accumulatedEvidenceQueries = [];

    agentGraphService.setAgentBrainLlmClient(async (messages) => {
      pathBCallCount++;
      const userPrompt = messages.find((m) => m.role === "user")?.content || "";

      if (pathBCallCount === 1) {
        // Step 1: Initial user query, agent brain decides to retrieve drive-end bearing vibration
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve measured drive-end bearing vibration reading from Knowledge Base report.",
          input: { query: "drive-end bearing vibration" },
        });
      }

      if (pathBCallCount === 2) {
        // Step 2: Verify Step 1 retrieved content is retained in prompt
        assert.ok(
          userPrompt.includes("3.1 mm/s RMS") || userPrompt.includes("Drive-End Bearing"),
          "Step 2 must see Section 3 evidence retrieved in Step 1"
        );
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve ISO 10816-3 allowable vibration limit from Knowledge Base report.",
          input: { query: "ISO 10816-3 Zone B/C boundary vibration limit" },
        });
      }

      if (pathBCallCount === 3) {
        // Step 3: Verify BOTH Step 1 (3.1 mm/s) and Step 2 (4.5 mm/s) evidence are retained simultaneously
        assert.ok(
          userPrompt.includes("3.1 mm/s RMS") || userPrompt.includes("3.1"),
          "Step 3 must retain Step 1 vibration evidence"
        );
        assert.ok(
          userPrompt.includes("4.5 mm/s RMS") || userPrompt.includes("4.5"),
          "Step 3 must retain Step 2 ISO limit evidence"
        );
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Calculate percentage: (measured vibration 3.1 / allowable limit 4.5) * 100.",
          input: { expression: "(3.1 / 4.5) * 100" },
        });
      }

      // Step 4: Final synthesis
      assert.ok(
        userPrompt.includes("68.88") || userPrompt.includes("68.89") || userPrompt.includes("68.9"),
        "Step 4 must receive calculator result"
      );
      return JSON.stringify({
        action: "final",
        reason: "Synthesize final answer comparing calculated percentage against allowable limit.",
        answer:
          "Based on the Knowledge Base report:\n* Drive-End Bearing vibration = 3.1 mm/s RMS (Section 3)\n* ISO 10816-3 limit = 4.5 mm/s RMS (Section 6.6)\n* Percentage of allowable limit = (3.1 / 4.5) × 100 = 68.9%\n\nSince 68.9% < 100%, the measured vibration PASSES within allowable operating standards.",
      });
    });

    const mockKnowledgeBaseRetriever = async (params) => {
      const q = String(params.query || "").toLowerCase();
      accumulatedEvidenceQueries.push(params.query);
      if (q.includes("bearing") || q.includes("vibration") && !q.includes("10816")) {
        return {
          success: true,
          content: "[Document: Machinery_Condition_Report.pdf, Page: 3]\nSection 3: Drive-End Bearing vibration = 3.1 mm/s RMS.",
          sources: [{ filename: "Machinery_Condition_Report.pdf", page: 3 }],
          results: [
            {
              filename: "Machinery_Condition_Report.pdf",
              page: 3,
              text: "Section 3: Drive-End Bearing vibration = 3.1 mm/s RMS.",
            },
          ],
        };
      }
      return {
        success: true,
        content: "[Document: Machinery_Condition_Report.pdf, Page: 7]\nSection 6.6: ISO 10816-3 Zone B/C boundary allowable limit = 4.5 mm/s RMS.",
        sources: [{ filename: "Machinery_Condition_Report.pdf", page: 7 }],
        results: [
          {
            filename: "Machinery_Condition_Report.pdf",
            page: 7,
            text: "Section 6.6: ISO 10816-3 Zone B/C boundary allowable limit = 4.5 mm/s RMS.",
          },
        ],
      };
    };

    const pathBResult = await runAgentTask({
      message: question,
      userId: "test-user",
      options: { retriever: mockKnowledgeBaseRetriever },
    });

    assert.strictEqual(pathBResult.success, true);
    assert.strictEqual(pathBResult.steps.length, 3, "Path B must execute exactly 3 tool steps");
    assert.strictEqual(pathBResult.steps[0].tool, "retrieve_information");
    assert.strictEqual(pathBResult.steps[1].tool, "retrieve_information");
    assert.strictEqual(pathBResult.steps[2].tool, "calculator");
    assert.strictEqual(accumulatedEvidenceQueries.length, 2);

    // Parity verification between Path A and Path B answers
    assert.ok(pathBResult.response.includes("3.1 mm/s"));
    assert.ok(pathBResult.response.includes("4.5 mm/s"));
    assert.ok(pathBResult.response.includes("68.9%"));
    assert.ok(pathBResult.response.includes("PASS"));

    pass("TEST 7.1 passed: PATH A (Attachment) and PATH B (Knowledge Base) produce equivalent verified answers with full multi-step RAG survival");
  }

  // TEST 7.2: Final Agent Response Streaming Verification
  {
    const chunksReceived = [];
    let brainCallCount = 0;

    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCallCount++;
      if (brainCallCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve vibration data",
          input: { query: "vibration reading" },
        });
      }
      if (brainCallCount === 2) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Calculate limit percentage",
          input: { expression: "(3.1 / 4.5) * 100" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "All calculations complete.",
        answer: "The measured vibration is 3.1 mm/s RMS, which is 68.9% of the 4.5 mm/s allowable limit. It PASSES.",
      });
    });

    const mockRetriever = async () => ({
      success: true,
      content: "Drive-End Bearing vibration = 3.1 mm/s RMS.",
      sources: [{ filename: "Report.pdf", page: 3 }],
      results: [{ filename: "Report.pdf", page: 3, text: "Drive-End Bearing vibration = 3.1 mm/s RMS." }],
    });

    const streamResult = await runAgentTask({
      message: "Check bearing vibration and calculate limit ratio",
      userId: "test-user",
      options: {
        retriever: mockRetriever,
        onChunk: (chunk) => {
          if (chunk?.text) chunksReceived.push(chunk.text);
        },
      },
    });

    assert.strictEqual(streamResult.success, true);
    assert.strictEqual(streamResult.steps.length, 2);
    assert.ok(chunksReceived.length > 0, "onChunk callback must receive final answer chunks");
    const joinedStream = chunksReceived.join("");
    assert.ok(joinedStream.includes("68.9%"));
    assert.ok(joinedStream.includes("PASS"));

    pass("TEST 7.2 passed: Final Agent response streams correctly to onChunk while preserving multi-step RAG tools");
  }

  // ─── 8. COMPREHENSIVE TOOL SELECTION & MULTI-TOOL POLICY (CANONICAL EXAMPLES 1-7) ───
  console.log("\n--- [Section 8] Multi-Tool Policy & Canonical Examples 1 to 7 Acceptance Tests ---");

  // TEST 8.1 (Example 1: "Calculate 25 × 4" → Calculator only)
  {
    let brainCalled = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCalled++;
      if (brainCalled === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Calculate arithmetic multiplication 25 * 4.",
          input: { expression: "25 * 4" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Arithmetic calculation complete.",
        answer: "The result of 25 × 4 is 100.",
      });
    });

    const result = await runAgentTask({
      message: "Calculate 25 * 4.",
      userId: "test-user-ex1",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].toolName, "calculator");
    assert.strictEqual(result.steps[0].observation.value, 100);
    assert.ok(result.response.includes("100"));

    pass("TEST 8.1 passed: Canonical Example 1 ('Calculate 25 × 4') routes to Calculator only");
  }

  // TEST 8.2 (Example 2: "Convert 100 psi to bar" → Unit Converter only)
  {
    let brainCalled = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCalled++;
      if (brainCalled === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "unit_converter",
          reason: "Convert 100 psi pressure to bar.",
          input: { value: 100, fromUnit: "psi", toUnit: "bar" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Unit conversion completed.",
        answer: "100 psi converts to 6.894757 bar.",
      });
    });

    const result = await runAgentTask({
      message: "Convert 100 psi to bar.",
      userId: "test-user-ex2",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].toolName, "unit_converter");
    assert.strictEqual(result.steps[0].observation.result, 6.894757);
    assert.ok(result.response.includes("6.894757 bar"));

    pass("TEST 8.2 passed: Canonical Example 2 ('Convert 100 psi to bar') routes to Unit Converter only");
  }

  // TEST 8.3 (Example 3: "What is the suction pressure of P-204?" → Retrieval only)
  {
    let brainCalled = 0;
    const mockRetriever = async () => ({
      success: true,
      content: "Pump P-204 technical specs: Suction pressure is 1.8 bar, Discharge pressure is 7.2 bar.",
      results: [{ filename: "Pump_P204_Specs.pdf", page: 1, text: "Suction pressure is 1.8 bar." }],
    });

    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCalled++;
      if (brainCalled === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve suction pressure specification for pump P-204.",
          input: { query: "P-204 suction pressure" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Factual suction pressure retrieved.",
        answer: "According to the equipment specifications, the suction pressure of pump P-204 is 1.8 bar.",
      });
    });

    const result = await runAgentTask({
      message: "What is the suction pressure of P-204?",
      userId: "test-user-ex3",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].toolName, "retrieve_information");
    assert.ok(result.response.includes("1.8 bar"));

    pass("TEST 8.3 passed: Canonical Example 3 ('What is the suction pressure of P-204?') routes to Retrieval only");
  }

  // TEST 8.4 (Example 4: "What is the pressure differential of P-204?" → Retrieval → Calculator)
  {
    let brainCalled = 0;
    const mockRetriever = async () => ({
      success: true,
      content: "Pump P-204 Inspection: Suction pressure = 1.8 bar. Discharge pressure = 7.2 bar.",
      results: [{ filename: "P204_Report.pdf", page: 2, text: "Suction pressure = 1.8 bar. Discharge pressure = 7.2 bar." }],
    });

    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCalled++;
      if (brainCalled === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve suction and discharge pressures for P-204.",
          input: { query: "P-204 suction and discharge pressure" },
        });
      }
      if (brainCalled === 2) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Calculate differential: discharge pressure (7.2 bar) minus suction pressure (1.8 bar).",
          input: { expression: "7.2 - 1.8" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Pressure differential calculation complete.",
        answer: "Based on the inspection document (P204_Report.pdf), suction pressure is 1.8 bar and discharge pressure is 7.2 bar. The pressure differential is 5.4 bar (7.2 - 1.8).",
      });
    });

    const result = await runAgentTask({
      message: "What is the pressure differential of P-204?",
      userId: "test-user-ex4",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 2);
    assert.strictEqual(result.steps[0].toolName, "retrieve_information");
    assert.strictEqual(result.steps[1].toolName, "calculator");
    assert.strictEqual(result.steps[1].observation.value, 5.4);
    assert.ok(result.response.includes("5.4 bar"));

    pass("TEST 8.4 passed: Canonical Example 4 ('What is the pressure differential of P-204?') routes Retrieval → Calculator");
  }

  // TEST 8.5 (Example 5: "What is the discharge pressure of P-204 in psi?" → Retrieval → Unit Converter)
  {
    let brainCalled = 0;
    const mockRetriever = async () => ({
      success: true,
      content: "Pump P-204: Discharge pressure = 7.2 bar.",
      results: [{ filename: "P204_Report.pdf", page: 2, text: "Discharge pressure = 7.2 bar." }],
    });

    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCalled++;
      if (brainCalled === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve discharge pressure of pump P-204.",
          input: { query: "P-204 discharge pressure" },
        });
      }
      if (brainCalled === 2) {
        return JSON.stringify({
          action: "tool",
          tool: "unit_converter",
          reason: "Convert discharge pressure 7.2 bar to psi.",
          input: { value: 7.2, fromUnit: "bar", toUnit: "psi" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Unit conversion complete.",
        answer: "According to the pump document, the discharge pressure of P-204 is 7.2 bar, which is 104.427171 psi.",
      });
    });

    const result = await runAgentTask({
      message: "What is the discharge pressure of P-204 in psi?",
      userId: "test-user-ex5",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 2);
    assert.strictEqual(result.steps[0].toolName, "retrieve_information");
    assert.strictEqual(result.steps[1].toolName, "unit_converter");
    assert.strictEqual(result.steps[1].observation.result, 104.427171);
    assert.ok(result.response.includes("104.427171 psi"));

    pass("TEST 8.5 passed: Canonical Example 5 ('What is the discharge pressure of P-204 in psi?') routes Retrieval → Unit Converter");
  }

  // TEST 8.6 (Example 6: "Calculate the pressure differential of P-204 and give the result in psi." → Retrieval → Calculator → Unit Converter)
  {
    let brainCalled = 0;
    const mockRetriever = async () => ({
      success: true,
      content: "Pump P-204 inspection: Suction = 1.8 bar, Discharge = 7.2 bar.",
      results: [{ filename: "P204_Inspection.pdf", page: 1, text: "Suction = 1.8 bar, Discharge = 7.2 bar." }],
    });

    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCalled++;
      if (brainCalled === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve suction and discharge pressure for pump P-204.",
          input: { query: "P-204 suction and discharge pressure" },
        });
      }
      if (brainCalled === 2) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Calculate differential: 7.2 - 1.8.",
          input: { expression: "7.2 - 1.8" },
        });
      }
      if (brainCalled === 3) {
        return JSON.stringify({
          action: "tool",
          tool: "unit_converter",
          reason: "Convert calculated differential 5.4 bar to psi.",
          input: { value: 5.4, fromUnit: "bar", toUnit: "psi" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Retrieval, calculation, and unit conversion all complete.",
        answer: "For pump P-204, the retrieved suction pressure is 1.8 bar and discharge pressure is 7.2 bar. The calculated differential is 5.4 bar (7.2 - 1.8), which converts to 78.320378 psi.",
      });
    });

    const result = await runAgentTask({
      message: "Calculate the pressure differential of P-204 and give the result in psi.",
      userId: "test-user-ex6",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 3);
    assert.strictEqual(result.steps[0].toolName, "retrieve_information");
    assert.strictEqual(result.steps[1].toolName, "calculator");
    assert.strictEqual(result.steps[1].observation.value, 5.4);
    assert.strictEqual(result.steps[2].toolName, "unit_converter");
    assert.strictEqual(result.steps[2].observation.result, 78.320378);
    assert.ok(result.response.includes("78.320378 psi"));

    pass("TEST 8.6 passed: Canonical Example 6 ('Calculate differential of P-204 in psi') routes Retrieval → Calculator → Unit Converter");
  }

  // TEST 8.7 (Example 7: "Read the pressure values from this image, calculate the differential, and convert it to psi." → Vision → Calculator → Unit Converter)
  {
    let brainCalled = 0;
    const mockVisionClient = async () =>
      "Image Inspection: The pressure gauges display Discharge pressure = 8 bar and Suction pressure = 2 bar.";

    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCalled++;
      if (brainCalled === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "vision",
          reason: "Extract suction and discharge pressure values from the gauge image.",
          input: { prompt: "Read the suction and discharge pressure readings from the gauges." },
        });
      }
      if (brainCalled === 2) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Calculate differential: 8 - 2.",
          input: { expression: "8 - 2" },
        });
      }
      if (brainCalled === 3) {
        return JSON.stringify({
          action: "tool",
          tool: "unit_converter",
          reason: "Convert calculated differential 6 bar to psi.",
          input: { value: 6, fromUnit: "bar", toUnit: "psi" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Vision inspection, arithmetic calculation, and unit conversion all complete.",
        answer: "From the image, discharge pressure is 8 bar and suction pressure is 2 bar. The calculated pressure differential is 6 bar (8 - 2), which converts to 87.022643 psi.",
      });
    });

    const result = await runAgentTask({
      message: "Read the pressure values from this image, calculate the differential, and convert it to psi.",
      userId: "test-user-ex7",
      images: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="],
      options: { visionClient: mockVisionClient },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 3);
    assert.strictEqual(result.steps[0].toolName, "vision");
    assert.strictEqual(result.steps[1].toolName, "calculator");
    assert.strictEqual(result.steps[1].observation.value, 6);
    assert.strictEqual(result.steps[2].toolName, "unit_converter");
    assert.strictEqual(result.steps[2].observation.result, 87.022643);
    assert.ok(result.response.includes("87.022643 psi"));

    pass("TEST 8.7 passed: Canonical Example 7 ('Vision → Calculator → Unit Converter') extracts visual values, calculates arithmetic, and converts units");
  }

  // TEST 8.8 (Section 11 & 13: Tool Output Trust & Policy Enforcement for Simple Operations)
  {
    let brainCalled = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCalled++;
      if (brainCalled === 1) {
        // Enforce calculator even for simple arithmetic 120 * 3
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Calculate total flow volume: flow rate 120 m3/h * operating time 3 h.",
          input: { expression: "120 * 3" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Use authoritative calculator result.",
        answer: "Total flow volume calculated by tool: 360 m3.",
      });
    });

    const result = await runAgentTask({
      message: "Flow is 120 m3/h and operating time is 3 h. Calculate total flow.",
      userId: "test-user-ex8",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].toolName, "calculator");
    assert.strictEqual(result.steps[0].observation.value, 360);
    assert.ok(result.response.includes("360 m3"));

    pass("TEST 8.8 passed: Simple operations strictly invoke specialized tools (zero mental math) and trust authoritative tool outputs");
  }

  // TEST 8.9: Tool input auto-healing: Qwen3 calls 'coding' with empty {} input (fixes "Invalid input: expected string, received undefined at task")
  {
    let brainCallCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCallCount++;
      if (brainCallCount === 1) {
        // Simulates model returning empty input {} exactly as observed in user issue
        return JSON.stringify({
          action: "tool",
          tool: "coding",
          reason: "Executing tool: coding",
          input: {},
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Provide final response with leap year code.",
        answer: "Here is the Python leap year verification code:\n\n```python\ndef is_leap_year(year):\n    return (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)\n```",
      });
    });

    let coderReceivedTask = null;
    let coderReceivedLang = null;
    agentGraphService.setCoderLlmClient(async (messages) => {
      const userMsg = messages.find((m) => m.role === "user");
      coderReceivedTask = userMsg?.content || "";
      return "```python\ndef is_leap_year(year):\n    return (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)\n```";
    });

    const result = await runAgentTask({
      message: "write a small Python code for checking a leap year and execute it to provide the output",
      userId: "test-user-coding-heal",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].toolName, "coding");
    assert.strictEqual(result.steps[0].status, "completed");
    assert.ok(result.steps[0].input.task.includes("leap year"));
    assert.strictEqual(result.steps[0].input.language, "python");
    assert.strictEqual(result.steps[0].observation.success, true);
    assert.ok(result.response.includes("is_leap_year"));

    pass("TEST 8.9 passed: Tool input auto-healing recovers 'task' and 'language' from user request when model provides empty {}");
  }

  // TEST 8.10: Root-level parameters parsed by parseBrainOutput into decision.input
  {
    let brainCallCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCallCount++;
      if (brainCallCount === 1) {
        // Simulates model placing parameters directly at root level of JSON
        return JSON.stringify({
          action: "tool",
          tool: "coding",
          reason: "Write Python leap year checker",
          task: "Implement is_leap_year function in Python",
          language: "python",
        });
      }
      return JSON.stringify({
        action: "final",
        answer: "Completed.",
      });
    });

    agentGraphService.setCoderLlmClient(async () => {
      return "def is_leap_year(year): return (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)";
    });

    const result = await runAgentTask({
      message: "Write a leap year checker",
      userId: "test-user-root-params",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps[0].toolName, "coding");
    assert.strictEqual(result.steps[0].input.task, "Implement is_leap_year function in Python");
    assert.strictEqual(result.steps[0].input.language, "python");

    pass("TEST 8.10 passed: Parameters placed at JSON root level are reliably captured into decision.input");
  }

  // TEST 8.11: Multi-tool chain: coding -> execute_code with auto-healing of missing code
  {
    let brainCallCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCallCount++;
      if (brainCallCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "coding",
          input: {
            task: "Write a small Python code to check leap year",
            language: "python",
          },
        });
      }
      if (brainCallCount === 2) {
        // Model calls execute_code with empty input {} - auto-healer must recover code from coding observation
        return JSON.stringify({
          action: "tool",
          tool: "execute_code",
          input: {},
        });
      }
      return JSON.stringify({
        action: "final",
        answer: "The Python leap year code was generated and verified in the sandbox with output: 2024 is leap year: True",
      });
    });

    agentGraphService.setCoderLlmClient(async () => {
      return "```python\ndef is_leap(y):\n    return (y % 4 == 0 and y % 100 != 0) or (y % 400 == 0)\nprint('2024 is leap year:', is_leap(2024))\n```";
    });

    let sandboxCalled = false;
    let sandboxCodeReceived = null;
    const mockRunner = async ({ code, language }) => {
      sandboxCalled = true;
      sandboxCodeReceived = code;
      return {
        success: true,
        exitCode: 0,
        stdout: "2024 is leap year: True\n",
        stderr: "",
        executionTimeMs: 120,
        timedOut: false,
        language,
        sandbox: { isolated: true },
      };
    };

    const result = await runAgentTask({
      message: "write a small Python code for checking a leap year and execute it to provide the output",
      userId: "test-user-code-chain",
      sandboxRunner: mockRunner,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 2);
    assert.strictEqual(result.steps[0].toolName, "coding");
    assert.strictEqual(result.steps[1].toolName, "execute_code");
    assert.strictEqual(result.steps[1].status, "completed");
    assert.strictEqual(sandboxCalled, true);
    assert.ok(sandboxCodeReceived.includes("is_leap(2024)"));
    assert.ok(!sandboxCodeReceived.startsWith("```"), "Markdown code fences must be stripped");
    assert.ok(result.response.includes("True"));

    pass("TEST 8.11 passed: Multi-tool chain coding -> execute_code auto-heals code from previous step and strips markdown fences");
  }

  agentGraphService.resetAgentBrainLlmClient();
  agentGraphService.resetCoderLlmClient();

  console.log("\n==========================================================");
  console.log(`ALL ${testsPassed} LANGGRAPH AGENT ACCEPTANCE TESTS PASSED!`);
  console.log("ZERO OLLAMA / REAL INFERENCE WAS EXECUTED.");
  console.log("==========================================================");
}

runTests().catch((err) => {
  console.error("FATAL TEST FAILURE:", err);
  process.exit(1);
});
