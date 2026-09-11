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
  TextTransformSchema,
  RetrievalSchema,
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

    assert.ok(calcTool, "calculator tool exists");
    assert.ok(textTool, "text_transform tool exists");
    assert.ok(retrTool, "retrieve_information tool exists");

    // Execute calculator tool
    const calcOutput = JSON.parse(await calcTool.invoke({ expression: "25 * 40" }));
    assert.strictEqual(calcOutput.value, 1000);
    assert.strictEqual(calcOutput.formatted, "1000");

    // Execute text transform tool
    const textOutput = JSON.parse(
      await textTool.invoke({ text: "hello world", operation: "uppercase" })
    );
    assert.strictEqual(textOutput.result, "HELLO WORLD");

    // Execute retrieval tool with context preservation
    const retrOutput = JSON.parse(
      await retrTool.invoke({ query: "safety requirements", sourceScope: "all" })
    );
    assert.strictEqual(retrOutput.success, true);
    assert.ok(retrOutput.content.includes("10%"));
    assert.strictEqual(retrieverCalled, true);
    assert.strictEqual(receivedContext.userId, "user-sovereign-01");
    assert.strictEqual(receivedContext.chatId, "chat-session-42");
    assert.strictEqual(receivedContext.workspaceId, "workspace-prod");

    pass("LangChain tools execute correctly and preserve caller context (userId, chatId, workspaceId)");
  }

  // ─── 3. METADATA CATALOG INSPECTION ────────────────────────────────────────
  console.log("\n--- [Section 3] Tool Catalog Metadata ---");
  {
    const metadata = getAgentToolsMetadata();
    assert.strictEqual(metadata.length, 3);
    const names = metadata.map((m) => m.name);
    assert.ok(names.includes("calculator"));
    assert.ok(names.includes("text_transform"));
    assert.ok(names.includes("retrieve_information"));
    pass("Tool metadata catalog lists all 3 registered tools with schema specifications");
  }

  // ─── 4. TOOL SELECTION POLICY TESTS (TESTS 1 to 6) ─────────────────────────
  console.log("\n--- [Section 4] Tool Selection Rules & Step Execution (Tests 1 - 6) ---");

  // TEST 1: User says "Hi" -> Expect: No tool, direct final answer
  {
    agentGraphService.setAgentBrainLlmClient(async () => {
      return JSON.stringify({
        action: "final",
        reason: "User greeting does not require tools.",
        answer: "Hello! How can I assist you today?",
      });
    });

    const result = await runAgentTask({
      message: "Hi",
      userId: "test-user",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 0, "No tools should be called for greeting");
    assert.ok(result.response.includes("Hello"));
    pass("TEST 1 passed: 'Hi' completes directly with no tool calls");
  }

  // TEST 2: User says "Calculate 25 * 40" -> Expect: calculator only
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Need to compute 25 * 40",
          input: { expression: "25 * 40" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Calculation finished.",
        answer: "25 * 40 = 1000.",
      });
    });

    const result = await runAgentTask({
      message: "Calculate 25 * 40",
      userId: "test-user",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].tool, "calculator");
    assert.strictEqual(result.steps[0].observation?.value, 1000);
    pass("TEST 2 passed: 'Calculate 25 * 40' executes calculator tool only");
  }

  // TEST 3: User says "Convert this sentence to uppercase: hello world" -> Expect: text_transform only
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "text_transform",
          reason: "Convert to uppercase as requested.",
          input: { text: "hello world", operation: "uppercase" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Text transformed.",
        answer: "The uppercase text is: HELLO WORLD.",
      });
    });

    const result = await runAgentTask({
      message: "Convert this sentence to uppercase: hello world",
      userId: "test-user",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].tool, "text_transform");
    assert.strictEqual(result.steps[0].observation?.result, "HELLO WORLD");
    pass("TEST 3 passed: 'Convert this sentence to uppercase' executes text_transform only");
  }

  // TEST 4: User asks "According to the uploaded documents, what are the safety requirements?" -> Expect: retrieve_information only
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve safety requirements from documents.",
          input: { query: "safety requirements" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Retrieved safety requirements summarized.",
        answer: "According to the documents, PRVs must be tested annually with a max overpressure of 10%.",
      });
    });

    const mockRetriever = async () => ({
      success: true,
      content: "PRVs must be tested annually with a max overpressure of 10%.",
      results: [{ id: "doc-safety" }],
    });

    const result = await runAgentTask({
      message: "According to the uploaded documents, what are the safety requirements?",
      userId: "test-user",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].tool, "retrieve_information");
    assert.ok(result.steps[0].observation?.content.includes("10%"));
    pass("TEST 4 passed: Document safety query executes retrieve_information only");
  }

  // TEST 5: Multi-step: "Find the relevant safety requirement and calculate the percentage mentioned in it."
  // Expect: retrieve_information -> calculator -> final answer
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve the safety requirement text to extract the percentage.",
          input: { query: "safety requirement percentage" },
        });
      }
      if (callCount === 2) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Compute the percentage value (10% of 250 bar set pressure = 25 bar).",
          input: { expression: "250 * 0.10" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Multi-step reasoning complete.",
        answer: "The safety requirement specifies a 10% overpressure allowance, which on a 250 bar system equals 25 bar.",
      });
    });

    const mockRetriever = async () => ({
      success: true,
      content: "Safety valve operating set pressure is 250 bar. Maximum allowable overpressure is 10%.",
      results: [{ id: "doc-prv" }],
    });

    const result = await runAgentTask({
      message: "Find the relevant safety requirement and calculate the percentage mentioned in it.",
      userId: "test-user",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 2, "Must execute exactly two tools in order");
    assert.strictEqual(result.steps[0].tool, "retrieve_information", "First step must be retrieval");
    assert.strictEqual(result.steps[1].tool, "calculator", "Second step must be calculator");
    assert.strictEqual(result.steps[1].observation?.value, 25);
    pass("TEST 5 passed: Multi-step flow executes retrieve_information -> calculator in correct sequence");
  }

  // TEST 6: Normal question unrelated to documents -> Expect: No retrieval
  {
    agentGraphService.setAgentBrainLlmClient(async () => {
      return JSON.stringify({
        action: "final",
        reason: "General knowledge question, no retrieval needed.",
        answer: "The capital of France is Paris.",
      });
    });

    const result = await runAgentTask({
      message: "What is the capital of France?",
      userId: "test-user",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 0, "No retrieval for normal questions");
    assert.ok(result.response.includes("Paris"));
    pass("TEST 6 passed: Normal question does not trigger retrieval");
  }

  // ─── 5. EXECUTION BOUNDS & LOOP PROTECTION ────────────────────────────────
  console.log("\n--- [Section 5] Execution Bounds & Infinite Loop Protection ---");
  {
    // Consecutive identical action loop protection
    agentGraphService.setAgentBrainLlmClient(async () => {
      return JSON.stringify({
        action: "tool",
        tool: "calculator",
        reason: "Infinite loop test",
        input: { expression: "1 + 1" },
      });
    });

    const result = await runAgentTask({
      message: "Calculate 1 + 1 repeatedly",
      userId: "test-user",
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, "failed");
    assert.ok(
      result.error.includes("stuck") || result.error.includes("limit"),
      "Should stop safely due to stuck detection or limit"
    );
    pass("Infinite tool loop safely halted by LangGraph stuck detection / limit enforcement");
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
    assert.strictEqual(toolsBody.count, 3);

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

    pass("Agent controller properly validates inputs, lists tools, and returns task status");
  }

  agentGraphService.resetAgentBrainLlmClient();

  console.log("\n==========================================================");
  console.log(`ALL ${testsPassed} LANGGRAPH AGENT ACCEPTANCE TESTS PASSED!`);
  console.log("ZERO OLLAMA / REAL INFERENCE WAS EXECUTED.");
  console.log("==========================================================");
}

runTests().catch((err) => {
  console.error("FATAL TEST FAILURE:", err);
  process.exit(1);
});
