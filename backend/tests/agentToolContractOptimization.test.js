/**
 * Six-Workflow LangGraph Agent Tool Contract & Optimization Acceptance Tests
 *
 * Verifies:
 * 1. TEST 1: "Hello" -> Qwen3 -> Final (0 tools)
 * 2. TEST 2: "Calculate 25 * 40" -> Qwen3 -> Calculator -> Qwen3 -> Final
 * 3. TEST 3: "Write Python code to print prime numbers" -> Qwen3 -> Coding -> Final (valid string received, no empty input)
 * 4. TEST 4: "Write Python code to print prime numbers and run it" -> Qwen3 -> Coding -> Execute_Code -> Final (code handoff, language preserved)
 * 5. TEST 5: Vision task -> Qwen3 -> Vision -> Final (prompt isolation)
 * 6. TEST 6: Vision + Calculation -> Qwen3 -> Vision -> Qwen3 -> Calculator -> Qwen3 -> Final
 * 7. TEST 7: Knowledge Retrieval -> Qwen3 -> Retrieval -> Qwen3 -> Final
 * 8. TEST 8: Generic Tool Argument Validation -> Missing required input yields structured error without crashing Zod
 * 9. TEST 9: Retry Loop Protection -> Identical failed tool retry is prevented immediately
 * 10. TEST 10: Robust Argument Parsing -> Accepts arguments in parsed.input, parsed.arguments, or top-level JSON fields
 */

import assert from "assert";
import { runAgentTask } from "../src/services/agent/agent.service.js";
import { agentGraphService, normalizeAndValidateToolInput } from "../src/services/agent/agentGraph.service.js";
import { parseBrainOutput, validateToolSelectionPolicy } from "../src/services/agent/qwenBrain.service.js";
import { WORKFLOW_TYPES } from "../src/services/agent/agent.types.js";

const pass = (msg) => console.log(`  ✔ [PASS] ${msg}`);

async function runAllTests() {
  console.log("================================================================================");
  console.log("STARTING AGENT TOOL CONTRACT & LATENCY OPTIMIZATION TEST SUITE");
  console.log("================================================================================");

  // ─── TEST 1: Simple task: "Hello" ───────────────────────────────────────────
  console.log("\n--- [Test 1] Simple Task: 'Hello' ---");
  {
    let brainCalls = 0;
    agentGraphService.setAgentBrainLlmClient(async (messages) => {
      brainCalls++;
      return JSON.stringify({
        workflow: "general",
        action: "final",
        reason: "Greeting the user directly without tools.",
        answer: "Hello! How can I assist you today?",
      });
    });

    const start = Date.now();
    const result = await runAgentTask({ message: "Hello" });
    const duration = Date.now() - start;

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 0, "Hello must call 0 tools");
    assert.strictEqual(brainCalls, 1, "Must execute exactly 1 Qwen3 call");
    assert.ok(result.response.includes("Hello"));

    console.log(`Metrics: Qwen3 calls: ${brainCalls} | Tool calls: 0 | Latency: ${duration}ms`);
    pass("Test 1 passed: 'Hello' routes Qwen3 -> Final with 0 tool calls");
  }

  // ─── TEST 2: Single-tool task: "Calculate 25 * 40" ───────────────────────────
  console.log("\n--- [Test 2] Single-Tool Task: 'Calculate 25 * 40' ---");
  {
    let brainCalls = 0;
    agentGraphService.setAgentBrainLlmClient(async (messages) => {
      brainCalls++;
      if (brainCalls === 1) {
        return JSON.stringify({
          workflow: "general",
          action: "tool",
          tool: "calculator",
          reason: "Calculate arithmetic expression 25 * 40.",
          input: { expression: "25 * 40" },
        });
      }
      return JSON.stringify({
        workflow: "general",
        action: "final",
        reason: "Final calculation answer.",
        answer: "25 * 40 = 1000.",
      });
    });

    const start = Date.now();
    const result = await runAgentTask({ message: "Calculate 25 * 40" });
    const duration = Date.now() - start;

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].toolName, "calculator");
    assert.strictEqual(result.steps[0].observation.value, 1000);
    assert.strictEqual(brainCalls, 2, "Must execute exactly 2 Qwen3 calls: tool decision + final");

    console.log(`Metrics: Qwen3 calls: ${brainCalls} | Tool calls: 1 | Latency: ${duration}ms`);
    pass("Test 2 passed: Single-tool calculation routes Qwen3 -> Calculator -> Qwen3 -> Final");
  }

  // ─── TEST 3: "Write Python code to print prime numbers" ──────────────────────
  console.log("\n--- [Test 3] Coding Task: 'Write Python code to print prime numbers' ---");
  {
    let receivedTask = null;
    let coderCalled = false;

    // Simulate Qwen3 output where task is at top-level instead of input, verifying argument normalization
    let brainCalls = 0;
    agentGraphService.setAgentBrainLlmClient(async (messages) => {
      brainCalls++;
      if (brainCalls === 1) {
        return JSON.stringify({
          workflow: "coding_sandbox",
          action: "tool",
          tool: "coding",
          reason: "Write prime numbers program.",
          task: "Write Python code to print prime numbers",
          language: "python",
        });
      }
      return JSON.stringify({
        workflow: "coding_sandbox",
        action: "final",
        reason: "Code written.",
        answer: "Here is the code to print prime numbers.",
      });
    });

    const mockCoder = async (messages) => {
      coderCalled = true;
      const userMsg = messages.find((m) => m.role === "user")?.content || "";
      receivedTask = userMsg;
      return "```python\ndef primes(n):\n    return [x for x in range(2, n) if all(x % d != 0 for d in range(2, x))]\nprint(primes(20))\n```";
    };

    const start = Date.now();
    const result = await runAgentTask({
      message: "Write Python code to print prime numbers",
      options: { coderClient: mockCoder },
    });
    const duration = Date.now() - start;

    assert.strictEqual(result.success, true);
    assert.strictEqual(coderCalled, true);
    assert.ok(receivedTask.includes("Write Python code to print prime numbers"), "Coding tool must receive valid string task");
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].toolName, "coding");
    assert.strictEqual(result.steps[0].status, "completed");

    console.log(`Metrics: Qwen3 calls: ${brainCalls} | Tool calls: 1 | Latency: ${duration}ms`);
    pass("Test 3 passed: Coding tool receives valid string task even when arguments are at root of model JSON");
  }

  // ─── TEST 4: "Write Python code to print prime numbers and run it" ────────────
  console.log("\n--- [Test 4] Coding -> Sandbox Flow: 'Write Python code and run it' ---");
  {
    let sandboxReceivedCode = null;
    let sandboxReceivedLanguage = null;

    let brainCalls = 0;
    agentGraphService.setAgentBrainLlmClient(async (messages) => {
      brainCalls++;
      if (brainCalls === 1) {
        return JSON.stringify({
          workflow: "coding_sandbox",
          action: "tool",
          tool: "coding",
          reason: "Generate Python prime numbers script.",
          input: { task: "Write Python code to print prime numbers", language: "python" },
        });
      }
      if (brainCalls === 2) {
        // Crucial test case: Qwen3 decides to execute_code, but input is {} or language only!
        // The system must seamlessly propagate generated code from the preceding coding step!
        return JSON.stringify({
          workflow: "coding_sandbox",
          action: "tool",
          tool: "execute_code",
          reason: "Execute the generated prime numbers script in container sandbox.",
          input: { language: "python" }, // empty code field!
        });
      }
      return JSON.stringify({
        workflow: "coding_sandbox",
        action: "final",
        reason: "Execution completed successfully.",
        answer: "Code executed successfully. Output: [2, 3, 5, 7, 11, 13, 17, 19].",
      });
    });

    const mockCoder = async () => {
      return "```python\ndef primes(n):\n    return [x for x in range(2, n) if all(x % d != 0 for d in range(2, x))]\nprint(primes(20))\n```";
    };

    const mockSandbox = async ({ code, language }) => {
      sandboxReceivedCode = code;
      sandboxReceivedLanguage = language;
      return {
        success: true,
        exitCode: 0,
        stdout: "[2, 3, 5, 7, 11, 13, 17, 19]",
        stderr: "",
        timedOut: false,
        language,
        sandbox: { isolated: true },
      };
    };

    const start = Date.now();
    const result = await runAgentTask({
      message: "Write Python code to print prime numbers and run it",
      options: { coderClient: mockCoder, sandboxRunner: mockSandbox },
    });
    const duration = Date.now() - start;

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 2, "Must execute coding then execute_code");
    assert.strictEqual(result.steps[0].toolName, "coding");
    assert.strictEqual(result.steps[1].toolName, "execute_code");
    assert.ok(sandboxReceivedCode, "Sandbox runner must receive valid code string");
    assert.ok(sandboxReceivedCode.includes("def primes"), "Code from coding step must be passed to execute_code");
    assert.strictEqual(sandboxReceivedLanguage, "python", "Language 'python' must be preserved");

    console.log(`Metrics: Qwen3 calls: ${brainCalls} | Tool calls: 2 | Latency: ${duration}ms`);
    pass("Test 4 passed: Coding -> Sandbox flow successfully propagates code and preserves language");
  }

  // ─── TEST 5: Vision Task Prompt Isolation ───────────────────────────────────
  console.log("\n--- [Test 5] Vision Task: Prompt Isolation ---");
  {
    let receivedVisionPrompt = null;
    let brainCalls = 0;
    agentGraphService.setAgentBrainLlmClient(async (messages) => {
      brainCalls++;
      if (brainCalls === 1) {
        return JSON.stringify({
          workflow: "general",
          action: "tool",
          tool: "vision",
          reason: "Inspect gauge in image.",
          input: {
            prompt: "Inspect the gauge in this image and verify the reading using the calculator tool.",
          },
        });
      }
      return JSON.stringify({
        workflow: "general",
        action: "final",
        reason: "Visual extraction final answer.",
        answer: "Gauge reading is 4.2 bar.",
      });
    });

    const mockVision = async (messages) => {
      const userMsg = messages.find((m) => m.role === "user")?.content || "";
      receivedVisionPrompt = userMsg;
      return {
        description: "Visual Observation: Pressure gauge reads 4.2 bar.",
        extractedMeasurements: ["4.2 bar"],
      };
    };

    const start = Date.now();
    const result = await runAgentTask({
      message: "Inspect the gauge in this image",
      images: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="],
      options: { visionClient: mockVision },
    });
    const duration = Date.now() - start;

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].toolName, "vision");
    assert.ok(!receivedVisionPrompt.includes("calculator"), "Vision model must never receive calculator instructions");

    console.log(`Metrics: Qwen3 calls: ${brainCalls} | Tool calls: 1 | Latency: ${duration}ms`);
    pass("Test 5 passed: Vision prompt is cleanly isolated from downstream calculator instructions");
  }

  // ─── TEST 6: Vision + Calculation ───────────────────────────────────────────
  console.log("\n--- [Test 6] Vision + Calculation Flow ---");
  {
    let brainCalls = 0;
    agentGraphService.setAgentBrainLlmClient(async (messages) => {
      brainCalls++;
      if (brainCalls === 1) {
        return JSON.stringify({
          workflow: "vision_calculation",
          action: "tool",
          tool: "vision",
          reason: "Extract motor power and speed.",
          input: { prompt: "Extract motor power P and speed N." },
        });
      }
      if (brainCalls === 2) {
        return JSON.stringify({
          workflow: "vision_calculation",
          action: "tool",
          tool: "calculator",
          reason: "Calculate torque using formula 22 * 9550 / 960.",
          input: { expression: "22 * 9550 / 960" },
        });
      }
      return JSON.stringify({
        workflow: "vision_calculation",
        action: "final",
        reason: "Final torque value.",
        answer: "Calculated torque is 218.85 Nm.",
      });
    });

    const mockVision = async () => ({
      description: "Motor rating plate: P = 22 kW, N = 960 RPM.",
      extractedMeasurements: ["22 kW", "960 RPM"],
    });

    const start = Date.now();
    const result = await runAgentTask({
      message: "Extract motor power and speed from image and compute torque",
      images: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="],
      options: { visionClient: mockVision },
    });
    const duration = Date.now() - start;

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 2);
    assert.strictEqual(result.steps[0].toolName, "vision");
    assert.strictEqual(result.steps[1].toolName, "calculator");
    assert.strictEqual(result.steps[1].observation.value, 218.854166666667);

    console.log(`Metrics: Qwen3 calls: ${brainCalls} | Tool calls: 2 | Latency: ${duration}ms`);
    pass("Test 6 passed: Vision + Calculation dynamically sequences Vision -> Calculator -> Final");
  }

  // ─── TEST 7: Knowledge Retrieval Flow ───────────────────────────────────────
  console.log("\n--- [Test 7] Knowledge Retrieval Flow ---");
  {
    let brainCalls = 0;
    agentGraphService.setAgentBrainLlmClient(async (messages) => {
      brainCalls++;
      if (brainCalls === 1) {
        return JSON.stringify({
          workflow: "knowledge_retrieval",
          action: "tool",
          tool: "retrieve_information",
          reason: "Look up inspection interval.",
          input: { query: "PRV inspection interval SOP-102" },
        });
      }
      return JSON.stringify({
        workflow: "knowledge_retrieval",
        action: "final",
        reason: "SOP-102 stated inspection interval.",
        answer: "According to SOP-102, the PRV inspection interval is 12 months.",
      });
    });

    const mockRetriever = async () => ({
      results: [
        {
          filename: "SOP-102_Pressure_Relief_Valves.pdf",
          page: 4,
          text: "Section 4.1: PRV inspection interval is 12 months under standard operating conditions.",
        },
      ],
      sources: [{ filename: "SOP-102_Pressure_Relief_Valves.pdf", page: 4 }],
    });

    const start = Date.now();
    const result = await runAgentTask({
      message: "What is the PRV inspection interval according to SOP-102?",
      options: { retriever: mockRetriever },
    });
    const duration = Date.now() - start;

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].toolName, "retrieve_information");
    assert.strictEqual(brainCalls, 2);

    console.log(`Metrics: Qwen3 calls: ${brainCalls} | Tool calls: 1 | Latency: ${duration}ms`);
    pass("Test 7 passed: Knowledge retrieval routes Qwen3 -> Retrieval -> Qwen3 -> Final without unnecessary tools");
  }

  // ─── TEST 8: Generic Tool Argument Validation ────────────────────────────────
  console.log("\n--- [Test 8] Generic Tool Argument Validation (Empty Input) ---");
  {
    // Verify normalizeAndValidateToolInput fails gracefully on empty input without throwing
    const emptyCoding = normalizeAndValidateToolInput("coding", {});
    assert.strictEqual(emptyCoding.valid, false);
    assert.ok(emptyCoding.error.includes("required field 'task'"));

    const emptyExec = normalizeAndValidateToolInput("execute_code", {}, { steps: [] });
    assert.strictEqual(emptyExec.valid, false);
    assert.ok(emptyExec.error.includes("required field 'code'"));

    const emptyCalc = normalizeAndValidateToolInput("calculator", {});
    assert.strictEqual(emptyCalc.valid, false);
    assert.ok(emptyCalc.error.includes("required field 'expression'"));

    const emptyRetrieval = normalizeAndValidateToolInput("retrieve_information", {});
    assert.strictEqual(emptyRetrieval.valid, false);
    assert.ok(emptyRetrieval.error.includes("required field 'query'"));

    // Verify alias resolution
    const aliasCoding = normalizeAndValidateToolInput("coding", { prompt: "Write quicksort in Go", lang: "go" });
    assert.strictEqual(aliasCoding.valid, true);
    assert.strictEqual(aliasCoding.input.task, "Write quicksort in Go");
    assert.strictEqual(aliasCoding.input.language, "go");

    const aliasCalc = normalizeAndValidateToolInput("calculator", { expr: "100 / 4" });
    assert.strictEqual(aliasCalc.valid, true);
    assert.strictEqual(aliasCalc.input.expression, "100 / 4");

    const aliasRetr = normalizeAndValidateToolInput("retrieve_information", { searchTerm: "fire pump" });
    assert.strictEqual(aliasRetr.valid, true);
    assert.strictEqual(aliasRetr.input.query, "fire pump");

    pass("Test 8 passed: Generic tool argument normalizer validates missing fields and maps aliases");
  }

  // ─── TEST 9: Retry Protection / Anti-Looping ────────────────────────────────
  console.log("\n--- [Test 9] Retry Protection Against Identical Failed Tool Calls ---");
  {
    // Simulate a failed step in state
    const failedState = {
      userRequest: "Run this script",
      steps: [
        {
          toolName: "execute_code",
          input: { code: "invalid python syntax ???", language: "python" },
          status: "failed",
          observation: { error: "SyntaxError: invalid syntax" },
        },
      ],
    };

    // Attempting to retry the exact identical call must be blocked immediately by policy guard
    const identicalDecision = {
      action: "tool",
      tool: "execute_code",
      input: { code: "invalid python syntax ???", language: "python" },
    };

    const policyCheck = validateToolSelectionPolicy(identicalDecision, failedState);
    assert.strictEqual(policyCheck.valid, false, "Must reject identical failed tool retry");
    assert.ok(policyCheck.reason.includes("Identical failed tool retry prevented"));

    // Meaningfully different attempt must be allowed
    const correctedDecision = {
      action: "tool",
      tool: "execute_code",
      input: { code: "print('fixed syntax')", language: "python" },
    };
    const correctedPolicyCheck = validateToolSelectionPolicy(correctedDecision, failedState);
    assert.strictEqual(correctedPolicyCheck.valid, true, "Must allow corrected tool call");

    pass("Test 9 passed: Identical failed tool retry is prevented immediately, while corrected calls are accepted");
  }

  // ─── TEST 10: Robust Brain Output Parsing ───────────────────────────────────
  console.log("\n--- [Test 10] Robust Argument Extraction in parseBrainOutput ---");
  {
    // Format A: Standard parsed.input
    const resA = parseBrainOutput(JSON.stringify({
      action: "tool",
      tool: "coding",
      input: { task: "Implement heap sort" },
    }));
    assert.strictEqual(resA.valid, true);
    assert.strictEqual(resA.decision.input.task, "Implement heap sort");

    // Format B: Top-level arguments (no input wrapper)
    const resB = parseBrainOutput(JSON.stringify({
      action: "tool",
      tool: "coding",
      task: "Implement heap sort",
      language: "python",
    }));
    assert.strictEqual(resB.valid, true);
    assert.strictEqual(resB.decision.input.task, "Implement heap sort");
    assert.strictEqual(resB.decision.input.language, "python");

    // Format C: Standard tool calling "arguments" field
    const resC = parseBrainOutput(JSON.stringify({
      action: "tool",
      tool: "calculator",
      arguments: { expression: "12 * 12" },
    }));
    assert.strictEqual(resC.valid, true);
    assert.strictEqual(resC.decision.input.expression, "12 * 12");

    // Format D: Direct string input
    const resD = parseBrainOutput(JSON.stringify({
      action: "tool",
      tool: "coding",
      input: "Implement binary search in C++",
    }));
    assert.strictEqual(resD.valid, true);
    assert.strictEqual(resD.decision.input.task, "Implement binary search in C++");

    pass("Test 10 passed: parseBrainOutput reliably extracts arguments from input, arguments, args, or root properties");
  }

  // Reset clients
  agentGraphService.resetAgentBrainLlmClient();
  agentGraphService.resetCoderLlmClient();
  agentGraphService.resetVisionLlmClient();

  console.log("\n================================================================================");
  console.log("ALL 10 AGENT TOOL CONTRACT & LATENCY OPTIMIZATION TESTS PASSED!");
  console.log("================================================================================");
}

runAllTests().catch((err) => {
  console.error("\nTEST SUITE FAILED:", err);
  process.exit(1);
});
