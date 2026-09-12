/**
 * Controlled Sandbox Code Execution Test Suite
 *
 * Validates the secure container execution layer for LangGraph Agent:
 * 1. Valid Python code execution (stdout, exitCode 0)
 * 2. Valid JavaScript code execution (stdout, exitCode 0)
 * 3. Syntax error handling (stderr, exitCode non-zero)
 * 4. Runtime error / exception handling (stderr, exitCode non-zero)
 * 5. Execution timeout enforcement (timedOut true, killed)
 * 6. Network isolation attempt (--network none -> Network unreachable)
 * 7. Filesystem escape attempt (--read-only -> Read-only file system)
 * 8. Host secrets & environment variable isolation
 * 9. Zero host execution boundary
 * 10. LangGraph Agent multi-step integration (Qwen3 -> Coding -> Sandbox Execute -> Final Answer)
 * 11. Security policy guard: Rejects execute_code on conceptual/explanation questions
 */

import assert from "assert";
import { sandboxService } from "../src/services/agent/sandbox.service.js";
import { executeCodeTool } from "../src/services/agent/tools/executeCode.tool.js";
import { ExecuteCodeSchema } from "../src/services/agent/agentTools.js";
import { runAgentTask } from "../src/services/agent/agent.service.js";
import { agentGraphService } from "../src/services/agent/agentGraph.service.js";
import { validateToolSelectionPolicy } from "../src/services/agent/qwenBrain.service.js";

console.log("==========================================================");
console.log("STARTING CONTROLLED SANDBOX SECURITY & EXECUTION TESTS");
console.log("==========================================================");

let testsPassed = 0;
function pass(testName) {
  testsPassed++;
  console.log(`✔ [PASS] ${testName}`);
}

async function runTests() {
  // ─── 1. INPUT VALIDATION & ZOD SCHEMA ─────────────────────────────────────
  console.log("\n--- [Section 1] Zod Schema & Tool Input Validation ---");
  {
    const validPython = ExecuteCodeSchema.safeParse({
      code: "print('hello')",
      language: "python",
      timeoutMs: 5000,
    });
    assert.strictEqual(validPython.success, true);
    assert.strictEqual(validPython.data.language, "python");
    assert.strictEqual(validPython.data.timeoutMs, 5000);

    const validDefault = ExecuteCodeSchema.safeParse({
      code: "console.log('hi')",
    });
    assert.strictEqual(validDefault.success, true);
    assert.strictEqual(validDefault.data.language, "python"); // default
    assert.strictEqual(validDefault.data.timeoutMs, 10000); // default

    const invalidEmpty = ExecuteCodeSchema.safeParse({ code: "" });
    assert.strictEqual(invalidEmpty.success, false);

    const invalidTimeout = ExecuteCodeSchema.safeParse({
      code: "print(1)",
      timeoutMs: 50000, // above max 30000
    });
    assert.strictEqual(invalidTimeout.success, false);

    pass("ExecuteCodeSchema correctly validates parameters and defaults");
  }

  // ─── 2. REAL DOCKER CONTAINER EXECUTION TESTS ─────────────────────────────
  console.log("\n--- [Section 2] Container Sandbox Security Isolation Tests ---");

  // TEST 2.1: Valid Python Code
  {
    const result = await sandboxService.executeCode({
      code: "print(sum([1, 2, 3, 4, 5]))",
      language: "python",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout.trim(), "15");
    assert.strictEqual(result.stderr, "");
    assert.strictEqual(result.timedOut, false);
    assert.strictEqual(result.sandbox.isolated, true);
    assert.strictEqual(result.sandbox.network, "none");
    assert.strictEqual(result.sandbox.filesystem, "read-only");
    pass("TEST 2.1 passed: Valid Python code executed inside sandbox (stdout: '15', exitCode: 0)");
  }

  // TEST 2.2: Valid JavaScript / Node.js Code
  {
    const result = await sandboxService.executeCode({
      code: "const arr = [10, 20, 30]; console.log(arr.reduce((a, b) => a + b, 0));",
      language: "javascript",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.exitCode, 0);
    assert.strictEqual(result.stdout.trim(), "60");
    assert.strictEqual(result.sandbox.isolated, true);
    pass("TEST 2.2 passed: Valid JavaScript code executed inside sandbox (stdout: '60', exitCode: 0)");
  }

  // TEST 2.3: Syntax Error Handling
  {
    const result = await sandboxService.executeCode({
      code: "def invalid_syntax(\n  print('missing paren'",
      language: "python",
    });

    assert.strictEqual(result.success, false);
    assert.notStrictEqual(result.exitCode, 0);
    assert.ok(
      result.stderr.includes("SyntaxError"),
      `Expected SyntaxError in stderr, got: ${result.stderr}`
    );
    pass("TEST 2.3 passed: Syntax error cleanly captured in stderr with non-zero exit code");
  }

  // TEST 2.4: Runtime Error Handling (ZeroDivisionError)
  {
    const result = await sandboxService.executeCode({
      code: "x = 10 / 0",
      language: "python",
    });

    assert.strictEqual(result.success, false);
    assert.notStrictEqual(result.exitCode, 0);
    assert.ok(
      result.stderr.includes("ZeroDivisionError"),
      `Expected ZeroDivisionError in stderr, got: ${result.stderr}`
    );
    pass("TEST 2.4 passed: Runtime exception cleanly captured in stderr with traceback");
  }

  // TEST 2.5: Execution Timeout Enforcement
  {
    const result = await sandboxService.executeCode({
      code: "import time\nwhile True:\n    time.sleep(0.1)",
      language: "python",
      timeoutMs: 2000, // 2 second timeout
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.timedOut, true);
    assert.ok(
      result.stderr.includes("timed out") || result.exitCode === 124 || result.exitCode === 137,
      `Expected timeout notification, got exitCode: ${result.exitCode}`
    );
    pass("TEST 2.5 passed: Infinite loop terminated by timeout watchdog (timedOut: true)");
  }

  // TEST 2.6: Network Access Disabled (--network none)
  {
    const result = await sandboxService.executeCode({
      code: `
import urllib.request
try:
    urllib.request.urlopen("http://1.1.1.1", timeout=2)
    print("NETWORK_ACCESSIBLE")
except Exception as e:
    print(f"NETWORK_BLOCKED: {type(e).__name__}")
`,
      language: "python",
    });

    assert.strictEqual(result.success, true);
    assert.ok(
      result.stdout.includes("NETWORK_BLOCKED"),
      `Network should be blocked, got: ${result.stdout}`
    );
    assert.ok(
      !result.stdout.includes("NETWORK_ACCESSIBLE"),
      "Container must not be able to establish network connections"
    );
    pass("TEST 2.6 passed: Network connection attempt blocked (--network none)");
  }

  // TEST 2.7: Filesystem Escape Attempt (--read-only root)
  {
    const result = await sandboxService.executeCode({
      code: `
try:
    with open("/etc/hacked", "w") as f:
        f.write("injected")
    print("ESCAPE_SUCCEEDED")
except OSError as e:
    print(f"ESCAPE_PREVENTED: {e.strerror}")
`,
      language: "python",
    });

    assert.strictEqual(result.success, true);
    assert.ok(
      result.stdout.includes("ESCAPE_PREVENTED") && result.stdout.includes("Read-only file system"),
      `Expected Read-only file system error, got: ${result.stdout}`
    );
    assert.ok(!result.stdout.includes("ESCAPE_SUCCEEDED"));
    pass("TEST 2.7 passed: Filesystem write to root prevented (--read-only root)");
  }

  // TEST 2.8: Host Secrets & Environment Variable Isolation
  {
    process.env.TEST_HOST_SECRET = "SUPER_SECRET_HOST_KEY_999";

    const result = await sandboxService.executeCode({
      code: `
import os
has_secret = "TEST_HOST_SECRET" in os.environ
print(f"SECRET_LEAKED: {has_secret}")
`,
      language: "python",
    });

    delete process.env.TEST_HOST_SECRET;

    assert.strictEqual(result.success, true);
    assert.ok(result.stdout.includes("SECRET_LEAKED: False"));
    pass("TEST 2.8 passed: Host environment variables & secrets are not exposed to container");
  }

  // TEST 2.9: Zero Host Execution Guarantee
  {
    // Check that executeCodeTool does not execute arbitrary host shell commands
    const toolResult = await executeCodeTool.execute({
      code: "import os; print(os.name)",
      language: "python",
    });

    assert.strictEqual(toolResult.success, true);
    assert.strictEqual(toolResult.sandbox.isolated, true);
    assert.strictEqual(toolResult.sandbox.containerEngine, "docker");
    pass("TEST 2.9 passed: Tool enforces zero host execution and returns structured sandbox metadata");
  }

  // ─── 3. LANGGRAPH AGENT INTEGRATION TESTS ─────────────────────────────────
  console.log("\n--- [Section 3] LangGraph Agent Integration & Policy Tests ---");

  // TEST 3.1: Multi-step execution: Qwen3 -> Coding -> Execute Code -> Final Answer
  {
    let stepCount = 0;
    agentGraphService.setAgentBrainLlmClient(async (messages) => {
      stepCount++;
      if (stepCount === 1) {
        // Step 1: Brain calls specialized coding tool to generate Python factorial
        return JSON.stringify({
          action: "tool",
          tool: "coding",
          reason: "Generate Python code to compute factorial of 5.",
          input: {
            task: "Write a Python script to compute factorial of 5 and print result",
            language: "python",
          },
        });
      }
      if (stepCount === 2) {
        // Step 2: Brain calls sandbox execute_code tool to run the generated code
        return JSON.stringify({
          action: "tool",
          tool: "execute_code",
          reason: "Execute the generated Python script in the secure sandbox to obtain output.",
          input: {
            code: "def factorial(n):\n    return 1 if n <= 1 else n * factorial(n - 1)\nprint(factorial(5))",
            language: "python",
          },
        });
      }
      // Step 3: Brain synthesizes the final answer using the sandbox output
      return JSON.stringify({
        action: "final",
        reason: "Code executed successfully in sandbox; output confirmed.",
        answer: "The Python function was executed inside the secure sandbox:\n```python\ndef factorial(n):\n    return 1 if n <= 1 else n * factorial(n - 1)\nprint(factorial(5))\n```\n**Output**: `120`.\nThe factorial of 5 is 120.",
      });
    });

    agentGraphService.setCoderLlmClient(async () => {
      return "```python\ndef factorial(n):\n    return 1 if n <= 1 else n * factorial(n - 1)\nprint(factorial(5))\n```";
    });

    const agentResult = await runAgentTask({
      message: "Write a Python function to compute factorial and execute it for 5",
      userId: "test-user",
    });

    assert.strictEqual(agentResult.success, true);
    assert.strictEqual(agentResult.steps.length, 2, "Must execute coding then execute_code");
    assert.strictEqual(agentResult.steps[0].tool, "coding");
    assert.strictEqual(agentResult.steps[1].tool, "execute_code");

    // Verify sandbox execution observation
    const sandboxObs = agentResult.steps[1].observation;
    assert.strictEqual(sandboxObs.success, true);
    assert.strictEqual(sandboxObs.exitCode, 0);
    assert.strictEqual(sandboxObs.stdout.trim(), "120");
    assert.strictEqual(sandboxObs.sandbox?.isolated, true);

    // Verify final response
    assert.ok(agentResult.response.includes("120"));
    assert.ok(agentResult.response.includes("factorial"));

    pass("TEST 3.1 passed: LangGraph Agent multi-step flow: Qwen3 -> Coding -> Sandbox Execute -> Final Answer");
  }

  // TEST 3.2: Policy Guard: Rejects execute_code on conceptual questions
  {
    const conceptualRejection = validateToolSelectionPolicy(
      { action: "tool", tool: "execute_code", input: { code: "print('api')" } },
      { userRequest: "Explain what an API is", steps: [] }
    );

    assert.strictEqual(conceptualRejection.valid, false);
    assert.ok(conceptualRejection.reason.includes("execute_code tool cannot be called for conceptual"));
    pass("TEST 3.2 passed: Policy guard blocks execute_code on conceptual questions");
  }

  agentGraphService.resetAgentBrainLlmClient();
  agentGraphService.resetCoderLlmClient();

  console.log("\n==========================================================");
  console.log(`ALL ${testsPassed} CONTROLLED SANDBOX SECURITY TESTS PASSED!`);
  console.log("==========================================================");
}

runTests().catch((err) => {
  console.error("FATAL SANDBOX TEST FAILURE:", err);
  process.exit(1);
});
