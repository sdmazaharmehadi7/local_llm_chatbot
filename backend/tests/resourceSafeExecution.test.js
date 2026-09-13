/**
 * Resource-Safe Sequential Model Execution & Smart Lifecycle Test Suite
 *
 * Validates:
 * 1. Strict single-model execution (ONLY ONE LLM MODEL active at any time: MAX ACTIVE LLM INFERENCE = 1)
 * 2. Deterministic tool routing without extra LLM overhead (e.g. Calculator)
 * 3. Same-model reuse without unnecessary unload/reload:
 *    [MODEL] qwen3:8b already resident
 *    [MODEL] Reusing qwen3:8b
 *    [MODEL] Executing
 *    [MODEL] Completed
 *    [MODEL] No unload required
 *    [MODEL] qwen3:8b retained
 * 4. Model switching when different model is required:
 *    [MODEL] <currentModel> completed
 *    [MODEL] Model switch required
 *    [MODEL] Releasing <currentModel>
 *    [MODEL] <currentModel> released
 *    [MODEL] Loading <targetModel>
 *    [MODEL] Executing
 * 5. Performance telemetry metrics (wait time, load time, inference time, release time, tool exec time, total exec time)
 * 6. Multi-user safety under concurrency (strict FIFO serialization, 0 parallel inferences, isolated context)
 * 7. Non-overlapping execution intervals verification
 */

import assert from "assert";
import { runAgentTask } from "../src/services/agent/agent.service.js";
import { agentGraphService } from "../src/services/agent/agentGraph.service.js";
import { modelLock } from "../src/services/agent/modelLock.service.js";
import { visionAgentService } from "../src/services/agent/specialists/visionAgent.service.js";
import { WORKFLOW_TYPES } from "../src/services/agent/agent.types.js";

console.log("================================================================================");
console.log("STARTING RESOURCE-SAFE & SMART LIFECYCLE TEST SUITE");
console.log("================================================================================");

let testsPassed = 0;
function pass(testName) {
  testsPassed++;
  console.log(`✔ [PASS] ${testName}`);
}

const SAMPLE_BASE64_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function runSuite() {
  try {
    modelLock.resetHistory();

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: Deterministic Tool Routing (No Unnecessary Specialist LLM)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 1] Deterministic Calculator Routing (No Specialist LLM) ---");
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "calculator",
            input: { expression: "25 * 40" },
            reason: "User requested arithmetic calculation 25 * 40.",
          });
        }
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Calculation complete.",
          answer: "25 * 40 = 1000.",
        });
      });

      const res = await runAgentTask({
        message: "Calculate 25 * 40.",
        userId: "test-user-calc",
        chatId: "calc-chat-1",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 1);
      assert.strictEqual(res.steps[0].tool, "calculator");
      assert.strictEqual(res.steps[0].observation.value, 1000);
      assert.strictEqual(res.state.specialist_results.length, 1);
      assert.strictEqual(res.state.specialist_results[0].agent, "Calculator");
      assert.ok(!res.state.agents_invoked.includes("Vision Agent"));
      assert.ok(!res.state.agents_invoked.includes("Coding Agent"));
      assert.ok(res.response.includes("1000"));

      pass("Test 1: Deterministic Calculator routes directly with zero specialist LLM invocations");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: Same-Model Reuse (Zero Unnecessary Unload/Reload Cycles)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 2] Same-Model Reuse Verification ---");
    {
      modelLock.resetHistory();
      const originalLog = console.log;
      const capturedLogs = [];
      console.log = (...args) => {
        capturedLogs.push(args.join(" "));
        originalLog(...args);
      };

      try {
        let callCount = 0;
        agentGraphService.setAgentBrainLlmClient(async () => {
          callCount++;
          if (callCount === 1) {
            return JSON.stringify({
              workflow: "general",
              action: "tool",
              tool: "calculator",
              input: { expression: "50 * 2" },
              reason: "Calculate 50 * 2",
            });
          }
          return JSON.stringify({
            workflow: "general",
            action: "final",
            reason: "Done",
            answer: "Result is 100.",
          });
        });

        await runAgentTask({
          message: "Calculate 50 * 2",
          userId: "test-user-reuse",
        });
      } finally {
        console.log = originalLog;
      }

      const logText = capturedLogs.join("\n");

      // Verify same-model reuse log patterns
      assert.ok(logText.includes("already resident"), "Must log that model is already resident");
      assert.ok(logText.includes("Reusing qwen3:8b"), "Must log that qwen3:8b is reused");
      assert.ok(logText.includes("No unload required"), "Must log No unload required");
      assert.ok(logText.includes("qwen3:8b retained"), "Must log qwen3:8b retained");

      const metrics = modelLock.getPerformanceMetrics();
      assert.ok(metrics.totalReuses >= 1, "Must record at least 1 model reuse");

      pass("Test 2: Same-model reuse verified: zero unnecessary unload/reload cycles");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: Different-Model Switching & Clean Lifecycle Logging
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 3] Model Switching & Lifecycle Logging ---");
    {
      modelLock.resetHistory();
      const originalLog = console.log;
      const capturedLogs = [];
      console.log = (...args) => {
        capturedLogs.push(args.join(" "));
        originalLog(...args);
      };

      try {
        // Mock Vision Specialist
        agentGraphService.setVisionLlmClient(async () => {
          return "Discharge Pressure PI-101: 6.2 bar. Suction Pressure PI-102: 1.5 bar.";
        });

        // Mock Supervisor
        let callCount = 0;
        agentGraphService.setAgentBrainLlmClient(async () => {
          callCount++;
          if (callCount === 1) {
            return JSON.stringify({
              workflow: WORKFLOW_TYPES.VISION_CALCULATION,
              action: "tool",
              tool: "vision",
              input: { prompt: "Read the suction and discharge pressure" },
              reason: "Read pressure values from gauge image.",
            });
          }
          if (callCount === 2) {
            return JSON.stringify({
              workflow: WORKFLOW_TYPES.VISION_CALCULATION,
              action: "tool",
              tool: "calculator",
              input: { expression: "6.2 - 1.5" },
              reason: "Calculate differential pressure.",
            });
          }
          return JSON.stringify({
            workflow: WORKFLOW_TYPES.VISION_CALCULATION,
            action: "final",
            reason: "All data extracted and calculated.",
            answer: "Discharge is 6.2 bar and Suction is 1.5 bar. The differential pressure is 4.7 bar.",
          });
        });

        const res = await runAgentTask({
          message: "Read pressure from image and calculate difference",
          userId: "test-user-switch",
          images: [SAMPLE_BASE64_IMAGE],
        });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.steps.length, 2);
      } finally {
        console.log = originalLog;
      }

      const logText = capturedLogs.join("\n");

      // Verify switch logs
      assert.ok(logText.includes("Model switch required"), "Must log Model switch required");
      assert.ok(logText.includes("Releasing qwen3:8b"), "Must log Releasing qwen3:8b");
      assert.ok(logText.includes("qwen3:8b released"), "Must log qwen3:8b released");
      assert.ok(logText.includes("Loading qwen2.5vl:7b"), "Must log Loading qwen2.5vl:7b");

      // Verify return switch logs (Vision -> Supervisor)
      assert.ok(logText.includes("Releasing qwen2.5vl:7b"), "Must log Releasing qwen2.5vl:7b");
      assert.ok(logText.includes("qwen2.5vl:7b released"), "Must log qwen2.5vl:7b released");
      assert.ok(logText.includes("Loading qwen3:8b"), "Must log Loading qwen3:8b");

      // Verify final reuse log for Supervisor's subsequent step
      assert.ok(logText.includes("Reusing qwen3:8b"), "Must log Reusing qwen3:8b for final step");

      const metrics = modelLock.getPerformanceMetrics();
      assert.ok(metrics.totalSwitches >= 2, "Must record model switches");
      assert.ok(metrics.totalReuses >= 1, "Must record model reuses");

      pass("Test 3: Different-model switching and retention verified with exact log markers");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: Performance Telemetry Metrics Verification
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 4] Performance Telemetry Metrics Verification ---");
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "calculator",
            input: { expression: "15 * 15" },
            reason: "Calculate 15 squared.",
          });
        }
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Done.",
          answer: "15 * 15 = 225.",
        });
      });

      const res = await runAgentTask({
        message: "Calculate 15 * 15",
        userId: "test-user-telemetry",
      });

      assert.ok(res.metrics, "Result must contain metrics object");
      assert.strictEqual(typeof res.metrics.modelWaitTimeMs, "number");
      assert.strictEqual(typeof res.metrics.modelLoadTimeMs, "number");
      assert.strictEqual(typeof res.metrics.inferenceTimeMs, "number");
      assert.strictEqual(typeof res.metrics.releaseTimeMs, "number");
      assert.strictEqual(typeof res.metrics.toolExecutionTimeMs, "number");
      assert.strictEqual(typeof res.metrics.totalExecutionTimeMs, "number");
      assert.strictEqual(typeof res.metrics.modelInvocations, "number");
      assert.strictEqual(typeof res.metrics.peakModelConcurrency, "number");

      assert.ok(res.metrics.totalExecutionTimeMs >= 0, "totalExecutionTimeMs must be >= 0");
      assert.strictEqual(res.metrics.peakModelConcurrency, 1, "peakModelConcurrency must be 1");
      assert.ok(res.state.metrics, "State must also include performance metrics");

      pass("Test 4: Performance telemetry metrics correctly measured and attached");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: Multi-User Safety Under Concurrency
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 5] Multi-User Safety Under Concurrency ---");
    {
      modelLock.resetHistory();

      // Configure mock brain with simulated delay to test overlapping requests
      agentGraphService.setAgentBrainLlmClient(async (messages) => {
        const userMsg = Array.isArray(messages) ? messages.find((m) => m.role === "user")?.content || "" : "";
        await new Promise((r) => setTimeout(r, 30));
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Handled user request",
          answer: `Echo answer for: ${userMsg}`,
        });
      });

      // Launch 3 concurrent requests from 3 different users with different chat sessions
      const userReqs = [
        { userId: "alice", chatId: "chat-alice-101", message: "Alice query about pressure" },
        { userId: "bob", chatId: "chat-bob-202", message: "Bob query about temperature" },
        { userId: "carol", chatId: "chat-carol-303", message: "Carol query about vibration" },
      ];

      const results = await Promise.all(
        userReqs.map((req) =>
          runAgentTask({
            message: req.message,
            userId: req.userId,
            chatId: req.chatId,
          })
        )
      );

      // Verify all 3 succeeded
      assert.strictEqual(results.length, 3);
      for (let i = 0; i < 3; i++) {
        const r = results[i];
        const req = userReqs[i];
        assert.strictEqual(r.success, true);
        assert.strictEqual(r.userId, req.userId);
        assert.strictEqual(r.chatId, req.chatId);
        assert.ok(r.response.includes(req.message), `Response must contain user prompt`);
        assert.strictEqual(r.state.userId, req.userId);
        assert.strictEqual(r.state.chatId, req.chatId);
      }

      // Assert peak concurrency was strictly 1 during concurrent requests
      assert.strictEqual(
        modelLock.getPeakConcurrency(),
        1,
        "Peak model concurrency must NEVER exceed 1 even under simultaneous multi-user requests"
      );
      assert.strictEqual(modelLock.getActiveInferences(), 0);

      pass("Test 5: Multi-user concurrent requests serialized safely with strict context isolation");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6: Zero Parallel LLM Inference (Mathematical Interval Overlap Test)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 6] Zero Parallel LLM Inference (Interval Verification) ---");
    {
      const intervals = modelLock.getIntervals();
      assert.ok(intervals.length > 0, "There should be recorded execution intervals");

      for (let i = 0; i < intervals.length; i++) {
        for (let j = i + 1; j < intervals.length; j++) {
          const a = intervals[i];
          const b = intervals[j];
          const overlaps = a.start < b.end && b.start < a.end;
          assert.strictEqual(
            overlaps,
            false,
            `Overlap detected between interval ${i} (${a.agent} ${a.model}: ${a.start}-${a.end}) and interval ${j} (${b.agent} ${b.model}: ${b.start}-${b.end})`
          );
        }
      }

      pass("Test 6: Verified zero temporal overlap across all model execution intervals (MAX ACTIVE INFERENCE = 1)");
    }

    agentGraphService.resetAgentBrainLlmClient();
    agentGraphService.resetVisionLlmClient();

    console.log("================================================================================");
    console.log(`ALL ${testsPassed} RESOURCE-SAFE & SMART LIFECYCLE TESTS PASSED SUCCESSFULLY!`);
    console.log("================================================================================");
  } catch (err) {
    agentGraphService.resetAgentBrainLlmClient();
    agentGraphService.resetVisionLlmClient();
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
  }
}

runSuite();
