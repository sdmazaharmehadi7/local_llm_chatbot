/**
 * Step 8.3 — Real Agent Execution Loop Acceptance & Unit Tests
 *
 * SAFETY GUARANTEES:
 * - Zero Ollama invocations
 * - Zero model inference
 * - Fully deterministic and isolated execution
 * - Tests multi-step bounded loop, structured actions, observations,
 *   step limits, and stuck detection.
 */

import assert from "assert";

import toolRegistry from "../src/services/agent/toolRegistry.service.js";
import { runAgentTask, initializeBuiltInTools } from "../src/services/agent/agent.service.js";
import agentPlannerService from "../src/services/agent/agentPlanner.service.js";
import agentStateService from "../src/services/agent/agentState.service.js";
import { AGENT_STATUS } from "../src/services/agent/agent.types.js";

console.log("==================================================");
console.log("STARTING STEP 8.3 REAL AGENT EXECUTION LOOP TESTS");
console.log("==================================================");

let testsPassed = 0;
function pass(testName) {
  testsPassed++;
  console.log(`✔ [PASS] ${testName}`);
}

async function runStep83Tests() {
  initializeBuiltInTools();

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. MOCKED MULTI-STEP AGENT WORKFLOW: Planner Tool -> Result -> Planner Final
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 1] Mocked Multi-Step Agent Execution Workflow ---");
  {
    let plannerInvocations = 0;
    const observationsReceived = [];

    // Setup custom planner mock to simulate step-by-step reasoning
    agentPlannerService.setCustomPlanner(async ({ taskState }) => {
      plannerInvocations++;

      // Turn 1: Planner returns calculator tool
      if (taskState.steps.length === 0) {
        return {
          type: "tool",
          tool: "calculator",
          reason: "Need to compute 25 * 4",
          input: { expression: "25 * 4" },
        };
      }

      // Turn 2: Planner observes result of calculator
      const lastStep = taskState.steps[taskState.steps.length - 1];
      observationsReceived.push(lastStep.observation);

      assert.strictEqual(lastStep.observation?.value ?? lastStep.observation, 100);
      assert.strictEqual(lastStep.status, "completed");

      return {
        type: "final",
        reason: "Calculation complete and verified",
        response: "The final computed value is 100.",
      };
    });

    const result = await runAgentTask({
      message: "Calculate 25 * 4 and report the result",
      chatId: "chat-step-83-test",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, AGENT_STATUS.COMPLETED);
    assert.strictEqual(result.response, "The final computed value is 100.");
    assert.strictEqual(plannerInvocations, 2, "Planner should be invoked twice (Tool decision, then Final decision)");

    // Verify Agent state contains steps and observations
    const finalState = await agentStateService.getTaskState(result.taskId);
    assert.strictEqual(finalState.steps.length, 1);

    const step1 = finalState.steps[0];
    assert.strictEqual(step1.stepNumber, 1);
    assert.strictEqual(step1.action, "tool");
    assert.strictEqual(step1.type, "tool");
    assert.strictEqual(step1.toolName, "calculator");
    assert.strictEqual(step1.tool, "calculator");
    assert.strictEqual(step1.input.expression, "25 * 4");
    assert.strictEqual(step1.status, "completed");
    assert(step1.observation !== undefined && step1.observation !== null, "Observation must be captured in step");
    assert.strictEqual(step1.observation.value, 100);
    assert(step1.executionTimeMs >= 0);

    agentPlannerService.resetPlanner();
    pass("Mocked agent workflow completes: Planner Tool -> Calculator Result -> Planner Final -> State recorded");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. HARD STEP LIMIT ENFORCEMENT (MAX_AGENT_STEPS)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 2] Step Limit Enforcement ---");
  {
    let stepCounter = 0;
    // Planner keeps returning new distinct tools so stuck detection isn't tripped
    agentPlannerService.setCustomPlanner(async () => {
      stepCounter++;
      return {
        type: "tool",
        tool: "calculator",
        reason: `Step ${stepCounter}`,
        input: { expression: `${stepCounter} + 1` },
      };
    });

    const stepLimitResult = await runAgentTask({
      message: "Execute indefinitely",
      options: { maxSteps: 3, maxTools: 10 },
    });

    assert.strictEqual(stepLimitResult.success, false);
    assert.strictEqual(stepLimitResult.status, AGENT_STATUS.FAILED);
    assert(
      stepLimitResult.error.includes("Maximum steps reached") ||
      stepLimitResult.error.includes("maximum allowed steps (3)"),
      "Error should indicate maximum steps limit was reached"
    );
    assert.strictEqual(stepLimitResult.steps.length, 3);

    agentPlannerService.resetPlanner();
    pass("Step limit is strictly enforced and terminates safely with clear error");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. HARD TOOL EXECUTION LIMIT (MAX_TOOL_EXECUTIONS)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 3] Tool Execution Limit Enforcement ---");
  {
    let counter = 0;
    agentPlannerService.setCustomPlanner(async () => {
      counter++;
      return {
        type: "tool",
        tool: "calculator",
        reason: `Compute step ${counter}`,
        input: { expression: `${counter} * 2` },
      };
    });

    const toolLimitResult = await runAgentTask({
      message: "Run tools indefinitely",
      options: { maxTools: 2, maxSteps: 10 },
    });

    assert.strictEqual(toolLimitResult.success, false);
    assert.strictEqual(toolLimitResult.status, AGENT_STATUS.FAILED);
    assert(
      toolLimitResult.error.includes("maximum allowed tool executions (2)") ||
      toolLimitResult.error.includes("Maximum tool executions reached"),
      "Error should indicate maximum tool executions reached"
    );
    assert.strictEqual(toolLimitResult.steps.length, 2);

    agentPlannerService.resetPlanner();
    pass("Tool executions limit is enforced and prevents infinite loops");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. REPEATED IDENTICAL ACTION DETECTION (AGENT STUCK PROTECTION)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 4] Agent Stuck Detection ---");
  {
    // Planner is stuck repeating the exact same tool and input
    agentPlannerService.setCustomPlanner(async () => {
      return {
        type: "tool",
        tool: "calculator",
        reason: "Stuck in a loop",
        input: { expression: "7 + 7" },
      };
    });

    const stuckResult = await runAgentTask({
      message: "Demonstrate stuck agent",
      options: { maxConsecutiveIdenticalActions: 3, maxTools: 10, maxSteps: 10 },
    });

    assert.strictEqual(stuckResult.success, false);
    assert.strictEqual(stuckResult.status, AGENT_STATUS.FAILED);
    assert(
      stuckResult.error.includes("Agent stuck") &&
      stuckResult.error.includes("repeated identical action"),
      "Error should explicitly state agent stuck with repeated identical action"
    );
    assert.strictEqual(stuckResult.steps.length, 3, "Should stop after 3 identical repetitions");

    agentPlannerService.resetPlanner();
    pass("Agent stuck detection halts execution when identical action is repeated");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. ERROR REPORTING (UNKNOWN TOOL & INVALID INPUT)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 5] Error Reporting ---");
  {
    // A. Unknown tool
    agentPlannerService.setCustomPlanner(async ({ taskState }) => {
      if (taskState.steps.length > 0) {
        return { type: "final", response: "Stopping after observing error" };
      }
      return {
        type: "tool",
        tool: "unregistered_fictional_tool",
        reason: "Calling non-existent tool",
        input: { data: "test" },
      };
    });

    const unknownToolTask = await runAgentTask({
      message: "Test unknown tool",
      options: { maxSteps: 2 },
    });

    assert.strictEqual(unknownToolTask.steps.length, 1);
    const unknownStep = unknownToolTask.steps[0];
    assert.strictEqual(unknownStep.status, "failed");
    assert(
      unknownStep.output.error.includes("Unknown tool") ||
      unknownStep.output.error.includes("not registered"),
      "Should produce clear unknown tool error"
    );

    // B. Invalid tool input
    agentPlannerService.setCustomPlanner(async ({ taskState }) => {
      if (taskState.steps.length > 0) {
        return { type: "final", response: "Stopping after observing invalid input error" };
      }
      return {
        type: "tool",
        tool: "calculator",
        reason: "Calling calculator with invalid input type",
        input: { expression: 12345 }, // Invalid type (must be string)
      };
    });

    const invalidInputTask = await runAgentTask({
      message: "Test invalid input",
      options: { maxSteps: 2 },
    });

    assert.strictEqual(invalidInputTask.steps.length, 1);
    const invalidStep = invalidInputTask.steps[0];
    assert.strictEqual(invalidStep.status, "failed");
    assert(
      invalidStep.output.error.includes("Invalid tool input") ||
      invalidStep.output.error.includes("must be of type string"),
      "Should produce clear invalid tool input error"
    );

    agentPlannerService.resetPlanner();
    pass("Clear error reporting for unknown tools and invalid inputs");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. CONVERSATION CONTEXT PRESERVATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 6] Conversation Context Preservation ---");
  {
    let capturedState = null;
    agentPlannerService.setCustomPlanner(async ({ taskState }) => {
      capturedState = taskState;
      return {
        type: "final",
        reason: "Context test complete",
        response: "Context preserved",
      };
    });

    const contextResult = await runAgentTask({
      message: "Check my context",
      chatId: "chat-context-123",
      userId: "engineer-42",
      workspaceId: "ws-industrial",
    });

    assert.strictEqual(contextResult.success, true);
    assert.strictEqual(capturedState.chatId, "chat-context-123");
    assert.strictEqual(capturedState.userId, "engineer-42");
    assert.strictEqual(capturedState.workspaceId, "ws-industrial");
    assert(Array.isArray(capturedState.conversationHistory));

    agentPlannerService.resetPlanner();
    pass("Conversation and access context are preserved throughout execution");
  }

  console.log("\n==================================================");
  console.log(`ALL ${testsPassed} STEP 8.3 TEST SCENARIOS PASSED!`);
  console.log("ZERO OLLAMA / REAL INFERENCE WAS EXECUTED.");
  console.log("==================================================");
}

runStep83Tests().catch((err) => {
  console.error("❌ TEST RUNNER FAILED:", err);
  process.exit(1);
});
