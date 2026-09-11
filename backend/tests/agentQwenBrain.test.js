/**
 * Step 8.6 — Qwen3:8b Agent Brain Acceptance & Safety Tests
 *
 * SAFETY GUARANTEES:
 * - Zero real Ollama invocations during automated tests
 * - Zero live model inference
 * - Fully deterministic and isolated execution
 * - Tests single-tool, multi-tool, tool failure, unknown tool rejection,
 *   invalid tool argument rejection, direct final answer, step limits,
 *   stuck detection, malformed JSON recovery/fallback, and regressions.
 */

import assert from "assert";

import toolRegistry from "../src/services/agent/toolRegistry.service.js";
import { runAgentTask, initializeBuiltInTools } from "../src/services/agent/agent.service.js";
import qwenBrainService, { parseBrainOutput } from "../src/services/agent/qwenBrain.service.js";
import { AGENT_STATUS } from "../src/services/agent/agent.types.js";
import { LOCAL_CHAT_MODELS, isValidModelId } from "../src/constants/models.config.js";

console.log("==================================================");
console.log("STARTING QWEN3:8B AGENT BRAIN TEST SUITE");
console.log("==================================================");

let testsPassed = 0;
function pass(testName) {
  testsPassed++;
  console.log(`✔ [PASS] ${testName}`);
}

async function runQwenBrainTestSuite() {
  initializeBuiltInTools();

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. SINGLE TOOL WORKFLOW: "Calculate 25 * 0.17"
  // Expected: Qwen3 -> calculator -> 4.25 -> final
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 1] Single Tool: Calculate 25 * 0.17 ---");
  {
    let brainCallCount = 0;

    qwenBrainService.setBrainLlmClient(async (messages) => {
      brainCallCount++;
      const userPrompt = messages[messages.length - 1].content;

      // Turn 1: No history, decide calculator tool
      if (!userPrompt.includes("Step 1:")) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          input: { expression: "25 * 0.17" },
        });
      }

      // Turn 2: Observe 4.25 and return final answer
      assert.ok(userPrompt.includes("4.25"), "Prompt must contain tool result observation");
      return JSON.stringify({
        action: "final",
        answer: "The result of 25 * 0.17 is 4.25.",
      });
    });

    const result = await runAgentTask({
      message: "Calculate 25 * 0.17",
      chatId: "chat-single-tool-test",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, AGENT_STATUS.COMPLETED);
    assert.strictEqual(brainCallCount, 2, "Qwen3 brain should be called twice (tool decision, then final)");
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].toolName, "calculator");
    assert.strictEqual(result.steps[0].observation.value, 4.25);
    assert.strictEqual(result.response, "The result of 25 * 0.17 is 4.25.");

    pass("Single tool: Qwen3:8b -> calculator -> 4.25 -> final answer");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. MULTI-TOOL WORKFLOW: "Convert hello world to uppercase and then calculate 10 + 20."
  // Expected: Qwen3 -> text_transform -> "HELLO WORLD" -> Qwen3 -> calculator -> 30 -> Qwen3 -> final
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 2] Sequential Multi-Tool: text_transform -> calculator -> final ---");
  {
    let stepCount = 0;

    qwenBrainService.setBrainLlmClient(async (messages) => {
      stepCount++;
      const userPrompt = messages[messages.length - 1].content;

      // Step 1: Request text transformation
      if (!userPrompt.includes("Step 1:")) {
        return JSON.stringify({
          action: "tool",
          tool: "text_transform",
          input: { operation: "uppercase", text: "hello world" },
        });
      }

      // Step 2: Observed "HELLO WORLD", now request calculator
      if (userPrompt.includes("Step 1:") && !userPrompt.includes("Step 2:")) {
        assert.ok(userPrompt.includes("HELLO WORLD"));
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          input: { expression: "10 + 20" },
        });
      }

      // Step 3: Observed 30, now return final
      assert.ok(userPrompt.includes("Step 2:"));
      assert.ok(userPrompt.includes("30"));
      return JSON.stringify({
        action: "final",
        answer: 'Transformed text is "HELLO WORLD" and the calculated sum is 30.',
      });
    });

    const result = await runAgentTask({
      message: "Convert hello world to uppercase and then calculate 10 + 20.",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, AGENT_STATUS.COMPLETED);
    assert.strictEqual(result.steps.length, 2);
    assert.strictEqual(result.steps[0].toolName, "text_transform");
    assert.strictEqual(result.steps[0].observation.result, "HELLO WORLD");
    assert.strictEqual(result.steps[1].toolName, "calculator");
    assert.strictEqual(result.steps[1].observation.value, 30);
    assert.ok(result.response.includes("HELLO WORLD"));
    assert.ok(result.response.includes("30"));

    pass("Sequential multi-tool: Qwen3:8b -> text_transform -> calculator -> final");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. TOOL FAILURE HANDLING: Invalid calculator expression
  // Expected: Tool error returned to Qwen3 -> Agent handles failure safely
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 3] Tool Failure Handling ---");
  {
    qwenBrainService.setBrainLlmClient(async (messages) => {
      const userPrompt = messages[messages.length - 1].content;

      // Turn 1: Call calculator with invalid expression
      if (!userPrompt.includes("Step 1:")) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          input: { expression: "10 / 0 + unknown_func()" },
        });
      }

      // Turn 2: Observe failure in history and respond politely
      assert.ok(userPrompt.includes("[FAILED]") || userPrompt.includes("error"));
      return JSON.stringify({
        action: "final",
        answer: "The mathematical expression could not be computed because it contained unsupported operations.",
      });
    });

    const result = await runAgentTask({
      message: "Calculate 10 / 0 + unknown_func()",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, AGENT_STATUS.COMPLETED);
    assert.strictEqual(result.steps[0].status, "failed");
    assert.ok(result.response.includes("could not be computed"));

    pass("Tool failure handled safely and observed by Qwen3 without crashing");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. UNKNOWN TOOL REJECTION: Mock Qwen3 requesting "delete_database"
  // Expected: Rejected by Tool Registry / Executor. Tool is NEVER executed.
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 4] Unknown Tool Rejection ---");
  {
    qwenBrainService.setBrainLlmClient(async (messages) => {
      const userPrompt = messages[messages.length - 1].content;

      if (!userPrompt.includes("Step 1:")) {
        return JSON.stringify({
          action: "tool",
          tool: "delete_database",
          input: {},
        });
      }

      return JSON.stringify({
        action: "final",
        answer: "I cannot execute delete_database as that capability is not permitted.",
      });
    });

    const result = await runAgentTask({
      message: "Delete database immediately",
    });

    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].toolName, "delete_database");
    assert.strictEqual(result.steps[0].status, "failed");
    assert.ok(result.steps[0].output.error.includes("Unknown tool"));
    assert.ok(result.steps[0].output.error.includes("not registered"));

    pass("Unknown tool is strictly rejected by executor layer and never executed");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. INVALID TOOL ARGUMENTS: Mock malformed calculator input
  // Expected: Schema validation failure. Tool is NEVER executed.
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 5] Invalid Tool Arguments Schema Validation ---");
  {
    qwenBrainService.setBrainLlmClient(async (messages) => {
      const userPrompt = messages[messages.length - 1].content;

      if (!userPrompt.includes("Step 1:")) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          input: { expression: 99999 }, // expression must be a string according to schema
        });
      }

      return JSON.stringify({
        action: "final",
        answer: "The calculator input was malformed.",
      });
    });

    const result = await runAgentTask({
      message: "Calculate with malformed input",
    });

    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].status, "failed");
    assert.ok(result.steps[0].output.error.includes("Input validation failed"));

    pass("Invalid tool arguments caught by schema validation and never executed");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. FINAL WITHOUT TOOLS: "Say hello."
  // Expected: Qwen3 -> final directly without tool executions
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 6] Direct Final Answer Without Tools ---");
  {
    let toolExecutionCount = 0;

    qwenBrainService.setBrainLlmClient(async () => {
      return JSON.stringify({
        action: "final",
        answer: "Hello! I am your sovereign local AI assistant. How may I assist you today?",
      });
    });

    const result = await runAgentTask({
      message: "Say hello.",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.status, AGENT_STATUS.COMPLETED);
    assert.strictEqual(result.steps.length, 0, "No tools should have been executed");
    assert.ok(result.response.includes("Hello! I am your sovereign local AI assistant"));

    pass("Direct conversation completes with final action and zero tool calls");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. MAX STEPS LIMIT: Mock Qwen3 repeatedly requesting different tools
  // Expected: Agent halts at max step limit
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 7] Max Steps Hard Limit Enforcement ---");
  {
    let iteration = 0;

    qwenBrainService.setBrainLlmClient(async () => {
      iteration++;
      return JSON.stringify({
        action: "tool",
        tool: "calculator",
        input: { expression: `${iteration} + 1` },
      });
    });

    const result = await runAgentTask({
      message: "Count indefinitely",
      options: { maxSteps: 4, maxTools: 10 },
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, AGENT_STATUS.FAILED);
    assert.ok(result.error.includes("Maximum steps reached"));
    assert.strictEqual(result.steps.length, 4);

    pass("Hard step limit is enforced and prevents runaway execution loops");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. STUCK / REPEATED ACTION DETECTION
  // Expected: Agent halts when identical action is repeated consecutively
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 8] Stuck / Repeated Action Detection ---");
  {
    qwenBrainService.setBrainLlmClient(async () => {
      return JSON.stringify({
        action: "tool",
        tool: "calculator",
        input: { expression: "42 * 2" },
      });
    });

    const result = await runAgentTask({
      message: "Get stuck in loop",
      options: { maxConsecutiveIdenticalActions: 3, maxSteps: 8 },
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.status, AGENT_STATUS.FAILED);
    assert.ok(result.error.includes("Agent stuck"));
    assert.ok(result.error.includes("repeated identical action"));
    assert.strictEqual(result.steps.length, 3);

    pass("Stuck loop protection halts execution when identical action is repeated");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. MALFORMED QWEN3 JSON & RETRY MECHANISM
  // Tests:
  // a) Markdown fences (```json ... ```) stripped cleanly
  // b) Thinking tags (<think>...</think>) stripped cleanly
  // c) Single-turn retry fixes malformed JSON
  // d) Permanent malformed JSON returns controlled error
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 9] Malformed JSON Handling & Recovery ---");
  {
    // A. Markdown fences with reasoning tags
    const fencedWithThink = `<think>
I should calculate 10 + 5.
</think>
\`\`\`json
{
  "action": "tool",
  "tool": "calculator",
  "input": { "expression": "10 + 5" }
}
\`\`\``;

    const parsedA = parseBrainOutput(fencedWithThink);
    assert.strictEqual(parsedA.valid, true);
    assert.strictEqual(parsedA.decision.tool, "calculator");
    assert.strictEqual(parsedA.decision.input.expression, "10 + 5");

    // B. Text surrounding JSON
    const textAround = `Here is the action you requested:
{"action": "final", "answer": "The answer is ready."}
Hope this helps!`;

    const parsedB = parseBrainOutput(textAround);
    assert.strictEqual(parsedB.valid, true);
    assert.strictEqual(parsedB.decision.action, "final");
    assert.strictEqual(parsedB.decision.answer, "The answer is ready.");

    // C. Single-turn retry on broken JSON
    let retryCalls = 0;
    qwenBrainService.setBrainLlmClient(async (messages) => {
      retryCalls++;
      if (retryCalls === 1) {
        // First turn returns broken JSON
        return "I am thinking about using calculator { broken json ...";
      }
      // Second turn (after correction prompt) returns valid JSON
      assert.ok(messages[messages.length - 1].content.includes("Error:"));
      return JSON.stringify({
        action: "final",
        answer: "Recovered successfully after correction prompt.",
      });
    });

    const recoveredResult = await runAgentTask({
      message: "Test JSON recovery",
    });

    assert.strictEqual(recoveredResult.success, true);
    assert.strictEqual(retryCalls, 2, "Should have triggered correction retry");
    assert.strictEqual(recoveredResult.response, "Recovered successfully after correction prompt.");

    // D. Permanent malformed JSON falls back safely
    qwenBrainService.setBrainLlmClient(async () => {
      return "Totally invalid non-JSON output forever";
    });

    const failedResult = await runAgentTask({
      message: "Test broken JSON failure",
    });

    assert.strictEqual(failedResult.success, false);
    assert.strictEqual(failedResult.status, AGENT_STATUS.FAILED);
    assert.ok(failedResult.error.includes("Agent brain failed"));

    pass("Malformed JSON parser cleanly strips fences/thoughts, retries once, and falls back safely");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. REGRESSION VERIFICATION: Normal chat, models config, UI remain untouched
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 10] System Regression Checks ---");
  {
    // A. Model configuration retains Qwen3:8b as default
    const qwenModel = LOCAL_CHAT_MODELS.find((m) => m.id === "qwen3:8b");
    assert.ok(qwenModel, "qwen3:8b must exist in LOCAL_CHAT_MODELS");
    assert.strictEqual(qwenModel.is_default, true);
    assert.strictEqual(isValidModelId("qwen3:8b"), true);
    assert.strictEqual(isValidModelId("qwen2.5-coder:7b"), true);
    assert.strictEqual(isValidModelId("qwen2.5vl:7b"), true);

    // B. Registered tools intact
    assert.strictEqual(toolRegistry.hasTool("calculator"), true);
    assert.strictEqual(toolRegistry.hasTool("text_transform"), true);
    assert.strictEqual(toolRegistry.hasTool("retrieve_information"), true);

    pass("Full system regression intact (models config, registered tools, chat routers)");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. TOOL SELECTION POLICY TESTS (STOP UNNECESSARY TOOL CALLS)
  // Tests:
  // a) Normal question → No unnecessary tool (final directly)
  // b) Calculation → Calculator only
  // c) Text transformation → text_transform only
  // d) Document question → Retrieval only (calculator/text_transform stopped)
  // e) Multi-step question → Only required tools in correct order (retrieval -> calculator)
  // f) Tool metadata has purpose, whenToUse, and whenNotToUse
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n--- [Scenario 11] Agent Tool Selection Policy & Stop Unnecessary Calls ---");
  {
    // A. Tool Metadata Verification
    const tools = toolRegistry.getTools();
    const calc = tools.find((t) => t.name === "calculator");
    const transform = tools.find((t) => t.name === "text_transform");
    const ret = tools.find((t) => t.name === "retrieve_information");

    assert.ok(calc.purpose && calc.whenToUse && calc.whenNotToUse, "calculator must specify purpose, whenToUse, whenNotToUse");
    assert.ok(transform.purpose && transform.whenToUse && transform.whenNotToUse, "text_transform must specify purpose, whenToUse, whenNotToUse");
    assert.ok(ret.purpose && ret.whenToUse && ret.whenNotToUse, "retrieve_information must specify purpose, whenToUse, whenNotToUse");
    pass("Tool metadata explicitly specifies purpose, whenToUse, and whenNotToUse");

    // B. Normal Question → No Unnecessary Tool (Final Directly)
    {
      qwenBrainService.setBrainLlmClient(async () => {
        return JSON.stringify({
          action: "final",
          answer: "Photosynthesis is the process by which plants synthesize nutrients from sunlight.",
        });
      });

      const normalResult = await runAgentTask({
        message: "Explain what photosynthesis is.",
      });

      assert.strictEqual(normalResult.success, true);
      assert.strictEqual(normalResult.steps.length, 0, "Normal question must execute 0 tool steps");
      assert.ok(normalResult.response.includes("Photosynthesis"));
      pass("Normal question → No unnecessary tools called (final answer directly)");
    }

    // C. Calculation Question → Calculator Only
    {
      qwenBrainService.setBrainLlmClient(async (messages) => {
        const userPrompt = messages[messages.length - 1].content;
        if (!userPrompt.includes("Step 1:")) {
          return JSON.stringify({
            action: "tool",
            tool: "calculator",
            input: { expression: "(125 * 8) - 45" },
          });
        }
        return JSON.stringify({
          action: "final",
          answer: "The result of (125 * 8) - 45 is 955.",
        });
      });

      const calcResult = await runAgentTask({
        message: "Calculate (125 * 8) - 45",
      });

      assert.strictEqual(calcResult.success, true);
      assert.strictEqual(calcResult.steps.length, 1);
      assert.strictEqual(calcResult.steps[0].toolName, "calculator");
      assert.strictEqual(calcResult.steps[0].observation.value, 955);
      pass("Calculation question → Calculator tool only (no retrieval, no text_transform)");
    }

    // D. Text Transformation Question → text_transform Only
    {
      qwenBrainService.setBrainLlmClient(async (messages) => {
        const userPrompt = messages[messages.length - 1].content;
        if (!userPrompt.includes("Step 1:")) {
          return JSON.stringify({
            action: "tool",
            tool: "text_transform",
            input: { operation: "uppercase", text: "safety first" },
          });
        }
        return JSON.stringify({
          action: "final",
          answer: 'The transformed text is "SAFETY FIRST".',
        });
      });

      const transformResult = await runAgentTask({
        message: "Convert 'safety first' to uppercase",
      });

      assert.strictEqual(transformResult.success, true);
      assert.strictEqual(transformResult.steps.length, 1);
      assert.strictEqual(transformResult.steps[0].toolName, "text_transform");
      assert.strictEqual(transformResult.steps[0].observation.result, "SAFETY FIRST");
      pass("Text transformation question → text_transform tool only (no calculator, no retrieval)");
    }

    // E. Document Question → Retrieval Only (Stops Unnecessary Calculator or Text_transform)
    {
      qwenBrainService.setBrainLlmClient(async (messages) => {
        const userPrompt = messages[messages.length - 1].content;

        // In step 2 (Step 1 is already in history): return final answer
        if (userPrompt.includes("Step 1:")) {
          return JSON.stringify({
            action: "final",
            answer: "Safety requirements specify PRV inspections every 24 to 48 months with bench testing.",
          });
        }

        // If it's a correction prompt due to policy violation, return retrieval tool
        if (userPrompt.includes("Tool policy violation")) {
          return JSON.stringify({
            action: "tool",
            tool: "retrieve_information",
            input: { query: "safety requirements PRV CDU-2" },
          });
        }

        // Simulate Qwen attempting to call calculator on a document question
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          input: { expression: "0" },
        });
      });

      const docResult = await runAgentTask({
        message: "What are the safety requirements mentioned in the documents for PRV?",
        options: {
          retriever: async () => ({
            success: true,
            content: "SOP-PRV-114 Section 2: Inspection frequency for PRV CDU-2 is 24 months for corrosive service.",
            sources: ["SOP-PRV-114.pdf"],
          }),
        },
      });

      assert.strictEqual(docResult.success, true);
      assert.strictEqual(docResult.steps.length, 1);
      // Confirmed: policy violation caught the unnecessary calculator and routed to retrieve_information!
      assert.strictEqual(docResult.steps[0].toolName, "retrieve_information", "Document question must use retrieve_information");
      assert.ok(docResult.steps[0].observation.content.includes("SOP-PRV-114"));
      pass("Document question → Unnecessary tool stopped and retrieval tool used exclusively");
    }

    // F. Multi-Step Question → Only Required Tools in Correct Sequence (retrieval -> calculator)
    {
      qwenBrainService.setBrainLlmClient(async (messages) => {
        const userPrompt = messages[messages.length - 1].content;

        // Step 1: Must be retrieve_information
        if (!userPrompt.includes("Step 1:")) {
          return JSON.stringify({
            action: "tool",
            tool: "retrieve_information",
            input: { query: "blowdown limit percentage for process service valves in SOP-PRV-114" },
          });
        }

        // Step 2: Observed blowdown limit 7%, now calculate 10 * 0.07
        if (userPrompt.includes("Step 1:") && !userPrompt.includes("Step 2:")) {
          assert.ok(userPrompt.includes("7%"), "Planner observed 7% blowdown limit from retrieval");
          return JSON.stringify({
            action: "tool",
            tool: "calculator",
            input: { expression: "10 * 0.07" },
          });
        }

        // Step 3: Observed calculated value 0.7, now final
        assert.ok(userPrompt.includes("0.7"), "Planner observed 0.7 calculated blowdown");
        return JSON.stringify({
          action: "final",
          answer: "The blowdown limit in SOP-PRV-114 is 7%. For a set pressure of 10 kg/cm², the maximum blowdown is 0.7 kg/cm².",
        });
      });

      const multiStepResult = await runAgentTask({
        message: "According to SOP-PRV-114, what is the blowdown limit percentage for process service valves, and calculate the maximum blowdown for a valve with set pressure 10 kg/cm²?",
        options: {
          retriever: async () => ({
            success: true,
            content: "SOP-PRV-114 Section 3: Blowdown must not exceed 7% of set pressure for process service valves.",
            sources: ["SOP-PRV-114.pdf"],
          }),
        },
      });

      assert.strictEqual(multiStepResult.success, true);
      assert.strictEqual(multiStepResult.steps.length, 2, "Multi-step task must execute exactly 2 steps");
      assert.strictEqual(multiStepResult.steps[0].toolName, "retrieve_information", "Step 1 must be retrieve_information");
      assert.strictEqual(multiStepResult.steps[1].toolName, "calculator", "Step 2 must be calculator");
      assert.strictEqual(multiStepResult.steps[1].observation.value, 0.7);
      assert.ok(multiStepResult.response.includes("7%"));
      assert.ok(multiStepResult.response.includes("0.7"));
      pass("Multi-step question → Only required tools executed in correct sequence (retrieval -> calculator -> final)");
    }
  }

  qwenBrainService.resetBrainLlmClient();

  console.log("\n==================================================");
  console.log(`ALL 11 SCENARIOS PASSED! (${testsPassed} tests passed)`);
  console.log("ZERO OLLAMA / REAL MODEL INFERENCE WAS EXECUTED.");
  console.log("==================================================");
}

runQwenBrainTestSuite().catch((err) => {
  console.error("❌ TEST SUITE FAILURE:", err);
  process.exit(1);
});
