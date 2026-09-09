/**
 * Agent Foundation & Orchestrator Unit / Mock Tests
 *
 * CRITICAL SAFETY RULES:
 * - NO Ollama calls or startup commands
 * - NO real model inference
 * - Deterministic, offline execution
 * - Fully tests all 12+ acceptance criteria
 */

import assert from "assert";

// Core Agent Foundation Modules
import toolRegistry from "../src/services/agent/toolRegistry.service.js";
import { evaluateSafeExpression, calculatorTool } from "../src/services/agent/tools/calculator.tool.js";
import textTransformTool from "../src/services/agent/tools/textTransform.tool.js";
import retrievalTool from "../src/services/agent/tools/retrieval.tool.js";
import { executeTool } from "../src/services/agent/agentExecutor.service.js";
import agentStateService from "../src/services/agent/agentState.service.js";
import agentPlannerService from "../src/services/agent/agentPlanner.service.js";
import { runAgentTask, initializeBuiltInTools } from "../src/services/agent/agent.service.js";
import { AGENT_STATUS, AGENT_LIMITS } from "../src/services/agent/agent.types.js";
import * as unifiedRetrievalModule from "../src/services/unifiedRetrieval.service.js";

console.log("==================================================");
console.log("STARTING AGENT FOUNDATION DETERMINISTIC TEST SUITE");
console.log("==================================================");

let testsPassed = 0;
function pass(testName) {
  testsPassed++;
  console.log(`✔ [PASS] ${testName}`);
}

async function runTests() {
  initializeBuiltInTools();

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. TOOL REGISTRY REGISTRATION & VALIDATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Suite 1] Tool Registry ---");
  {
    assert(toolRegistry.hasTool("calculator"), "calculator should be registered");
    assert(toolRegistry.hasTool("text_transform"), "text_transform should be registered");
    assert(toolRegistry.hasTool("retrieve_information"), "retrieve_information should be registered");

    // Register a custom tool
    const customTool = {
      name: "unit_test_tool",
      description: "A tool for testing the registry",
      inputSchema: {
        type: "object",
        required: ["val"],
        properties: { val: { type: "number" } },
      },
      permissions: ["test:perm"],
      execute: async ({ val }) => ({ doubled: val * 2 }),
    };
    toolRegistry.registerTool(customTool);
    assert(toolRegistry.hasTool("unit_test_tool"), "unit_test_tool should be registered");
    assert.strictEqual(toolRegistry.getTool("unit_test_tool").name, "unit_test_tool");

    // Duplicate registration rejection
    assert.throws(
      () => toolRegistry.registerTool(customTool),
      /already registered/,
      "Should reject duplicate tool registration"
    );

    // Invalid tool definition rejection (no execute)
    assert.throws(
      () => toolRegistry.registerTool({ name: "no_exec", description: "foo" }),
      /execute function/,
      "Should reject tool without execute function"
    );

    // Invalid tool name (uppercase / special chars)
    assert.throws(
      () => toolRegistry.registerTool({ name: "BAD-NAME!", description: "foo", execute: () => {} }),
      /Invalid tool name/,
      "Should reject invalid tool name format"
    );

    toolRegistry.unregisterTool("unit_test_tool");
    assert(!toolRegistry.hasTool("unit_test_tool"), "Tool should be unregistered");
    pass("Tool registration, duplicate rejection, and schema validation");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. TOOL LOOKUP & UNKNOWN TOOL REJECTION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Suite 2] Tool Lookup & Rejection ---");
  {
    assert.strictEqual(toolRegistry.getTool("non_existent_tool"), null);
    const execResult = await executeTool({
      toolName: "non_existent_tool",
      input: {},
    });
    assert.strictEqual(execResult.success, false);
    assert(execResult.error.includes("not registered or allowed"));
    pass("Unknown tool lookup and rejection");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. SAFE CALCULATOR TOOL (NO EVAL, NO FUNCTION)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Suite 3] Safe Calculator Tool ---");
  {
    // Arithmetic operations
    assert.strictEqual(evaluateSafeExpression("25 * 0.17"), 4.25);
    assert.strictEqual(evaluateSafeExpression("100 / 4"), 25);
    assert.strictEqual(evaluateSafeExpression("2 + 3 * 4"), 14);
    assert.strictEqual(evaluateSafeExpression("(2 + 3) * 4"), 20);
    assert.strictEqual(evaluateSafeExpression("2 ^ 3"), 8);
    assert.strictEqual(evaluateSafeExpression("2 ** 3"), 8);
    assert.strictEqual(evaluateSafeExpression("-5 + 15"), 10);
    assert.strictEqual(evaluateSafeExpression("10 % 3"), 1);

    // Mathematical functions
    assert.strictEqual(evaluateSafeExpression("sqrt(144) + 10"), 22);
    assert.strictEqual(evaluateSafeExpression("abs(-42)"), 42);
    assert.strictEqual(evaluateSafeExpression("round(4.6)"), 5);
    assert.strictEqual(evaluateSafeExpression("floor(4.9)"), 4);
    assert.strictEqual(evaluateSafeExpression("ceil(4.1)"), 5);
    assert.strictEqual(evaluateSafeExpression("max(10, 20, 5)"), 20);
    assert.strictEqual(evaluateSafeExpression("min(10, 20, 5)"), 5);
    assert.strictEqual(evaluateSafeExpression("pow(3, 3)"), 27);

    // Security: Reject arbitrary code, eval, process, require
    assert.throws(() => evaluateSafeExpression("eval('2+2')"), /Unauthorized identifier/);
    assert.throws(() => evaluateSafeExpression("process.exit()"), /Unauthorized identifier/);
    assert.throws(() => evaluateSafeExpression("require('fs')"), /Unauthorized identifier/);
    assert.throws(() => evaluateSafeExpression("console.log(1)"), /Unauthorized identifier/);
    assert.throws(() => evaluateSafeExpression("function(){ return 1; }"), /Unauthorized identifier/);
    assert.throws(() => evaluateSafeExpression("1 $ 2"), /Invalid character/);

    // Division by zero protection
    assert.throws(() => evaluateSafeExpression("100 / 0"), /Division by zero/);
    assert.throws(() => evaluateSafeExpression("100 % 0"), /Modulo by zero/);

    // Syntax errors
    assert.throws(() => evaluateSafeExpression("2 + * 3"), /Unexpected token/);
    assert.throws(() => evaluateSafeExpression(""), /Expression cannot be empty/);

    pass("Safe calculator evaluates correct expressions and strictly blocks code injection & division by zero");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. TEXT TRANSFORM TOOL (DETERMINISTIC, ZERO LLM)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Suite 4] Text Transform Tool ---");
  {
    const upperRes = await textTransformTool.execute({ text: "hello world", operation: "uppercase" });
    assert.strictEqual(upperRes.result, "HELLO WORLD");

    const lowerRes = await textTransformTool.execute({ text: "SOVEREIGN WORKBENCH", operation: "lowercase" });
    assert.strictEqual(lowerRes.result, "sovereign workbench");

    const wordRes = await textTransformTool.execute({ text: "one two three four five", operation: "word_count" });
    assert.strictEqual(wordRes.wordCount, 5);

    const charRes = await textTransformTool.execute({ text: "abc 123", operation: "char_count" });
    assert.strictEqual(charRes.charCount, 7);

    const trimRes = await textTransformTool.execute({ text: "  padded  ", operation: "trim" });
    assert.strictEqual(trimRes.result, "padded");

    const revRes = await textTransformTool.execute({ text: "abc", operation: "reverse" });
    assert.strictEqual(revRes.result, "cba");

    const sumRes = await textTransformTool.execute({
      text: "Safety is paramount. All engineers must wear PPE. Report hazards immediately. Log all incidents.",
      operation: "summarize",
      options: { maxSentences: 2 },
    });
    assert(sumRes.summary.includes("Safety is paramount."));
    assert(sumRes.summary.includes("All engineers must wear PPE."));

    pass("Text transform operates deterministically across all operations without LLM");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. TOOL INPUT VALIDATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Suite 5] Tool Input Validation ---");
  {
    // Calculator validation: missing expression
    const val1 = toolRegistry.validateToolInput("calculator", {});
    assert.strictEqual(val1.valid, false);
    assert(val1.error.includes("Missing required field \"expression\""));

    // Calculator validation: invalid property type
    const val2 = toolRegistry.validateToolInput("calculator", { expression: 12345 });
    assert.strictEqual(val2.valid, false);
    assert(val2.error.includes("must be of type string"));

    // Text transform validation: unsupported operation
    const val3 = toolRegistry.validateToolInput("text_transform", { text: "hi", operation: "malicious_op" });
    assert.strictEqual(val3.valid, false);
    assert(val3.error.includes("Unsupported operation"));

    // Retrieval validation: missing query
    const val4 = toolRegistry.validateToolInput("retrieve_information", {});
    assert.strictEqual(val4.valid, false);
    assert(val4.error.includes("Missing or empty required field 'query'"));

    pass("Tool input validation correctly enforces schemas and catches malformed requests");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. TOOL EXECUTOR & NORMALIZATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Suite 6] Tool Executor ---");
  {
    const execRes = await executeTool({
      toolName: "calculator",
      input: { expression: "17 / 100" },
    });
    assert.strictEqual(execRes.success, true);
    assert.strictEqual(execRes.toolName, "calculator");
    assert.strictEqual(execRes.result.value, 0.17);
    assert(typeof execRes.executionTimeMs === "number");
    assert(execRes.metadata && execRes.metadata.timestamp);

    // Failed execution (bad expression)
    const failRes = await executeTool({
      toolName: "calculator",
      input: { expression: "10 / 0" },
    });
    assert.strictEqual(failRes.success, false);
    assert(failRes.error.includes("Division by zero"));
    assert(typeof failRes.executionTimeMs === "number");

    pass("Tool executor normalizes success and error payloads with execution telemetry");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. PERMISSION REJECTION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Suite 7] Permission Enforcement ---");
  {
    toolRegistry.registerTool({
      name: "restricted_admin_tool",
      description: "Restricted tool requiring admin permissions",
      inputSchema: { type: "object" },
      permissions: ["admin:write"],
      execute: async () => ({ ok: true }),
    });

    const denied = await executeTool({
      toolName: "restricted_admin_tool",
      input: {},
      context: { permissions: ["read:documents"] },
    });
    assert.strictEqual(denied.success, false);
    assert(denied.error.includes("Permission denied"));

    const allowed = await executeTool({
      toolName: "restricted_admin_tool",
      input: {},
      context: { permissions: ["admin:write"] },
    });
    assert.strictEqual(allowed.success, true);

    toolRegistry.unregisterTool("restricted_admin_tool");
    pass("Permission checks prevent execution of unauthorized tools");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. RESULT SIZE LIMITING
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Suite 8] Result Size Limiting ---");
  {
    toolRegistry.registerTool({
      name: "oversized_tool",
      description: "Tool that generates an enormous payload",
      inputSchema: { type: "object" },
      permissions: [],
      execute: async () => ({ payload: "x".repeat(AGENT_LIMITS.MAX_RESULT_SIZE + 500) }),
    });

    const oversizeRes = await executeTool({
      toolName: "oversized_tool",
      input: {},
    });
    assert.strictEqual(oversizeRes.success, false);
    assert(oversizeRes.error.includes("output exceeded maximum allowed size"));

    toolRegistry.unregisterTool("oversized_tool");
    pass("Executor enforces MAX_RESULT_SIZE to protect against memory exhaustion");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. AGENT STATE TRANSITIONS & AUDIT LOGGING
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Suite 9] Agent State Transitions ---");
  {
    const taskId = "test-task-state-123";
    const state = await agentStateService.createTaskState({
      taskId,
      userId: "user-test",
      chatId: "chat-test",
      userRequest: "Test state transitions",
    });

    assert.strictEqual(state.status, AGENT_STATUS.PLANNING);
    assert.strictEqual(state.steps.length, 0);

    await agentStateService.updateTaskStatus(taskId, AGENT_STATUS.EXECUTING);
    let current = await agentStateService.getTaskState(taskId);
    assert.strictEqual(current.status, AGENT_STATUS.EXECUTING);

    await agentStateService.recordStep(taskId, {
      action: "tool",
      toolName: "calculator",
      reason: "Calculate something",
      input: { expression: "2+2" },
      output: { value: 4 },
      status: "completed",
      executionTimeMs: 5,
    });

    current = await agentStateService.getTaskState(taskId);
    assert.strictEqual(current.steps.length, 1);
    assert.strictEqual(current.steps[0].stepNumber, 1);
    assert.strictEqual(current.steps[0].output.value, 4);

    await agentStateService.completeTask(taskId, "Calculation is 4");
    current = await agentStateService.getTaskState(taskId);
    assert.strictEqual(current.status, AGENT_STATUS.COMPLETED);
    assert.strictEqual(current.finalResponse, "Calculation is 4");

    pass("Agent state service correctly records steps, audit logs, and status transitions");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. RETRIEVAL TOOL INTERFACE (WITH MOCKED UNIFIED RETRIEVAL)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Suite 10] Retrieval Tool Interface ---");
  {
    let capturedParams = null;
    const mockRetriever = async (params) => {
      capturedParams = params;
      return {
        success: true,
        query: params.query,
        results: [
          {
            documentId: "doc-safety-001",
            filename: "Safety_Manual.pdf",
            page: 12,
            chunkIndex: 3,
            score: 0.89,
            text: "All personnel entering Unit 4 must wear respiratory protection.",
          },
        ],
      };
    };

    const toolResult = await retrievalTool.execute(
      { query: "PPE requirements for Unit 4" },
      {
        chatId: "chat-xyz",
        userId: "user-abc",
        workspaceId: "ws-industrial",
        retriever: mockRetriever,
      }
    );

    assert.strictEqual(toolResult.success, true);
    assert.strictEqual(toolResult.query, "PPE requirements for Unit 4");
    assert.strictEqual(toolResult.results.length, 1);
    assert.strictEqual(toolResult.results[0].documentId, "doc-safety-001");
    assert.strictEqual(toolResult.results[0].score, 0.89);

    // Verify access isolation was passed through
    assert.strictEqual(capturedParams.chatId, "chat-xyz");
    assert.strictEqual(capturedParams.userId, "user-abc");
    assert.strictEqual(capturedParams.workspaceId, "ws-industrial");

    pass("Retrieval tool integrates with unified retrieval and enforces access control context");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. EXECUTION LIMITS & INFINITE-LOOP PROTECTION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Suite 11] Execution Limits & Infinite-Loop Protection ---");
  {
    // Setup a loop scenario using custom planner that always asks for another tool execution
    agentPlannerService.setCustomPlanner(async ({ taskState }) => {
      return {
        action: "tool",
        toolName: "calculator",
        reason: "Infinite loop test step",
        input: { expression: "1 + 1" },
      };
    });

    // Run task with strict maxTools = 3 limit
    const loopResult = await runAgentTask({
      message: "Loop forever please",
      options: { maxTools: 3, maxSteps: 4 },
    });

    assert.strictEqual(loopResult.success, false);
    assert.strictEqual(loopResult.status, AGENT_STATUS.FAILED);
    assert(loopResult.error.includes("maximum allowed tool executions (3) reached"));
    assert.strictEqual(loopResult.steps.length, 3);

    // Reset custom planner
    agentPlannerService.resetPlanner();

    pass("Infinite loop protection halts execution when limits are exceeded");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 12. END-TO-END MULTI-STEP AGENT ORCHESTRATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Suite 12] End-to-End Task Execution ---");
  {
    // Test Scenario A: Mathematical rate calculation
    const mathTaskResult = await runAgentTask({
      message: "Calculate the failure rate if 17 of 100 inspections failed",
      chatId: "chat-inspect-1",
    });

    assert.strictEqual(mathTaskResult.success, true);
    assert.strictEqual(mathTaskResult.status, AGENT_STATUS.COMPLETED);
    assert(mathTaskResult.steps.length >= 1);
    assert.strictEqual(mathTaskResult.steps[0].toolName, "calculator");
    assert.strictEqual(mathTaskResult.steps[0].output.result.value, 17);
    assert(mathTaskResult.response.includes("17%"));
    pass("End-to-End calculation task completes with structured decision and formatted response");

    // Test Scenario B: Text transformation
    const textTaskResult = await runAgentTask({
      message: "Convert the uppercase text: 'hazard alert in unit b'",
    });

    assert.strictEqual(textTaskResult.success, true);
    assert.strictEqual(textTaskResult.status, AGENT_STATUS.COMPLETED);
    assert.strictEqual(textTaskResult.steps[0].toolName, "text_transform");
    assert(textTaskResult.response.includes("HAZARD ALERT IN UNIT B"));
    pass("End-to-End text transformation task completes successfully");

    // Test Scenario C: Conversational greeting (no tool needed)
    const chatTaskResult = await runAgentTask({
      message: "Hello assistant, how are you today?",
    });

    assert.strictEqual(chatTaskResult.success, true);
    assert.strictEqual(chatTaskResult.status, AGENT_STATUS.COMPLETED);
    assert.strictEqual(chatTaskResult.steps.length, 0); // No tools invoked
    assert(chatTaskResult.response.includes("No additional tool execution is required"));
    pass("Direct conversational request concludes without unnecessary tool execution");
  }

  console.log("\n==================================================");
  console.log(`ALL ${testsPassed} TEST SUITES PASSED DETERMINISTICALLY!`);
  console.log("ZERO OLLAMA / MODEL INFERENCE WAS EXECUTED.");
  console.log("==================================================");
}

runTests().catch((err) => {
  console.error("❌ TEST RUNNER FAILED:", err);
  process.exit(1);
});
