/**
 * Multi-Agent Controlled Collaboration Test Suite
 *
 * Validates the 10 multi-step collaboration workflows under strict Single-Model
 * Execution Resource Lock with focused context handoff and sequential non-overlapping models:
 *
 * 1. Vision only
 * 2. Research only
 * 3. Coding only
 * 4. Vision -> Calculator
 * 5. Research -> Calculator
 * 6. Vision -> Research
 * 7. Vision -> Research -> Calculator
 * 8. Coding -> Sandbox
 * 9. Vision -> Research -> Calculator -> Final
 * 10. Agent failure and retry
 */

import assert from "assert";
import { runAgentTask } from "../src/services/agent/agent.service.js";
import { agentGraphService } from "../src/services/agent/agentGraph.service.js";
import { modelLock } from "../src/services/agent/modelLock.service.js";

console.log("================================================================================");
console.log("STARTING MULTI-AGENT CONTROLLED COLLABORATION TEST SUITE");
console.log("================================================================================");

let testsPassed = 0;
function pass(testName) {
  testsPassed++;
  console.log(`✔ [PASS] ${testName}`);
}

const SAMPLE_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * Verify that all model execution intervals in the modelLock are strictly sequential
 * and never overlap in time.
 */
function assertSequentialExecution(intervals) {
  assert.ok(intervals.length > 0, "Expected at least one model execution interval");
  for (let i = 0; i < intervals.length - 1; i++) {
    const current = intervals[i];
    const next = intervals[i + 1];
    assert.ok(
      current.end <= next.start,
      `Hardware concurrency violation! Model ${current.model} (ended ${current.end}) overlapped with ${next.model} (started ${next.start})`
    );
  }
}

async function runTests() {
  try {
    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: Vision Only (Supervisor -> Vision Agent -> Supervisor -> Final)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 1] Vision Only ---");
    {
      modelLock.resetHistory();
      let supervisorCalls = 0;
      const progressEvents = [];

      agentGraphService.setAgentBrainLlmClient(async () => {
        supervisorCalls++;
        if (supervisorCalls === 1) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "vision",
            reason: "Extract oil level from sight glass image.",
            input: { prompt: "Read the oil level in the sight glass." },
          });
        }
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Visual extraction complete.",
          answer: "The sight glass indicates normal oil level at 65% of full capacity.",
        });
      });

      agentGraphService.setVisionLlmClient(async ({ prompt }) => {
        assert.strictEqual(prompt.includes("sight glass"), true, "Vision must receive focused prompt");
        return "Visual analysis: Sight glass shows oil level at 65% capacity marker.";
      });

      const res = await runAgentTask({
        message: "Check the oil level in this sight glass photo.",
        images: [SAMPLE_IMAGE],
        userId: "collab-user-1",
        options: {
          onProgress: (ev) => progressEvents.push(ev),
        },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 1);
      assert.strictEqual(res.steps[0].agent, "Vision Agent");
      assert.strictEqual(res.steps[0].toolName, "vision");
      assert.strictEqual(modelLock.getPeakConcurrency(), 1);
      assertSequentialExecution(modelLock.getIntervals());

      // Verify streaming sequence
      const phases = progressEvents.map((e) => e.phase || e.status).filter(Boolean);
      assert.ok(phases.includes("Supervisor started"));
      assert.ok(phases.includes("Agent selected"));
      assert.ok(phases.includes("Agent executing"));
      assert.ok(phases.includes("Agent completed"));
      assert.ok(phases.includes("Supervisor reviewing"));
      assert.ok(phases.includes("Final response"));

      pass("Test 1 passed: Vision only executed sequentially with focused context and verified streaming");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: Research Only (Supervisor -> Research Agent -> Supervisor -> Final)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 2] Research Only ---");
    {
      modelLock.resetHistory();
      let supervisorCalls = 0;

      agentGraphService.setAgentBrainLlmClient(async () => {
        supervisorCalls++;
        if (supervisorCalls === 1) {
          return JSON.stringify({
            workflow: "knowledge_retrieval",
            action: "tool",
            tool: "retrieve_information",
            reason: "Look up API 610 allowable nozzle loads.",
            input: { query: "API 610 nozzle load limits Table 5" },
          });
        }
        return JSON.stringify({
          workflow: "knowledge_retrieval",
          action: "final",
          reason: "Factual retrieval complete.",
          answer: "API 610 Table 5 specifies maximum allowable nozzle forces and moments based on flange size.",
        });
      });

      let queryReceived = "";
      const mockRetriever = async ({ query }) => {
        queryReceived = query;
        return {
          results: [{ source: "API_610_11th_Ed.pdf", page: 42, text: "Table 5: Nozzle force and moment limits." }],
        };
      };

      const res = await runAgentTask({
        message: "What are the API 610 nozzle load limits?",
        userId: "collab-user-1",
        options: { retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 1);
      assert.strictEqual(res.steps[0].agent, "Research Agent");
      assert.strictEqual(queryReceived, "API 610 nozzle load limits Table 5");
      assert.strictEqual(modelLock.getPeakConcurrency(), 1);
      assertSequentialExecution(modelLock.getIntervals());
      pass("Test 2 passed: Research only executed sequentially with focused query");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: Coding Only (Supervisor -> Coding Agent -> Supervisor -> Final)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 3] Coding Only ---");
    {
      modelLock.resetHistory();
      let supervisorCalls = 0;

      agentGraphService.setAgentBrainLlmClient(async () => {
        supervisorCalls++;
        if (supervisorCalls === 1) {
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "coding",
            reason: "Generate NPSHa calculation script.",
            input: {
              task: "Implement NPSHa calculation: npsha = (patm - pvp)/(rho*g) + hz - hf",
              language: "python",
            },
          });
        }
        return JSON.stringify({
          workflow: "coding_sandbox",
          action: "final",
          reason: "Code generation complete.",
          answer: "Here is the python implementation for NPSHa:\n```python\ndef calc_npsha(patm, pvp, rho, g, hz, hf):\n    return (patm - pvp) / (rho * g) + hz - hf\n```",
        });
      });

      agentGraphService.setCoderLlmClient(async (messages) => {
        const userPrompt = messages.find((m) => m.role === "user")?.content || "";
        assert.ok(userPrompt.includes("NPSHa calculation"), "Coder must receive focused coding task");
        return "```python\ndef calc_npsha(patm, pvp, rho, g, hz, hf):\n    return (patm - pvp) / (rho * g) + hz - hf\n```";
      });

      const res = await runAgentTask({
        message: "Write code to compute net positive suction head available.",
        userId: "collab-user-1",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 1);
      assert.strictEqual(res.steps[0].agent, "Coding Agent");
      assert.strictEqual(modelLock.getPeakConcurrency(), 1);
      assertSequentialExecution(modelLock.getIntervals());
      pass("Test 3 passed: Coding only executed sequentially under single-model lock");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: Vision -> Calculator
    // Supervisor -> Vision Agent -> Supervisor -> Calculator -> Supervisor -> Final
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 4] Vision -> Calculator ---");
    {
      modelLock.resetHistory();
      let supervisorCalls = 0;
      let calculatorInputReceived = "";

      agentGraphService.setAgentBrainLlmClient(async () => {
        supervisorCalls++;
        if (supervisorCalls === 1) {
          return JSON.stringify({
            workflow: "vision_calculation",
            action: "tool",
            tool: "vision",
            reason: "Read suction and discharge pressures from image gauges.",
            input: { prompt: "Read suction and discharge pressure readings." },
          });
        }
        if (supervisorCalls === 2) {
          // Supervisor extracts 6.2 and 1.5, formulates expression "6.2 - 1.5"
          return JSON.stringify({
            workflow: "vision_calculation",
            action: "tool",
            tool: "calculator",
            reason: "Calculate differential pressure: 6.2 - 1.5.",
            input: { expression: "6.2 - 1.5" },
          });
        }
        return JSON.stringify({
          workflow: "vision_calculation",
          action: "final",
          reason: "Calculation verified.",
          answer: "Discharge pressure is 6.2 bar and suction pressure is 1.5 bar. Pressure difference is 4.7 bar.",
        });
      });

      agentGraphService.setVisionLlmClient(async () => {
        return "Gauge readings: Suction PI-101 = 1.5 bar, Discharge PI-102 = 6.2 bar.";
      });

      const res = await runAgentTask({
        message: "Read suction and discharge pressure from the image and calculate the pressure difference.",
        images: [SAMPLE_IMAGE],
        userId: "collab-user-1",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].agent, "Vision Agent");
      assert.strictEqual(res.steps[1].agent, "Calculator");
      assert.strictEqual(res.steps[1].input.expression, "6.2 - 1.5", "Calculator MUST receive only mathematical expression");
      assert.strictEqual(res.steps[1].observation.value, 4.7);
      assert.strictEqual(modelLock.getPeakConcurrency(), 1);
      assertSequentialExecution(modelLock.getIntervals());
      pass("Test 4 passed: Vision -> Calculator cleanly handed off focused formula without raw prompt leak");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: Research -> Calculator
    // Supervisor -> Research Agent -> Supervisor -> Calculator -> Supervisor -> Final
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 5] Research -> Calculator ---");
    {
      modelLock.resetHistory();
      let supervisorCalls = 0;

      agentGraphService.setAgentBrainLlmClient(async () => {
        supervisorCalls++;
        if (supervisorCalls === 1) {
          return JSON.stringify({
            workflow: "retrieval_calculation",
            action: "tool",
            tool: "retrieve_information",
            reason: "Find allowable vibration threshold in equipment manual.",
            input: { query: "allowable vibration limit motor M-101" },
          });
        }
        if (supervisorCalls === 2) {
          return JSON.stringify({
            workflow: "retrieval_calculation",
            action: "tool",
            tool: "calculator",
            reason: "Calculate percentage: (3.1 / 4.5) * 100.",
            input: { expression: "(3.1 / 4.5) * 100" },
          });
        }
        return JSON.stringify({
          workflow: "retrieval_calculation",
          action: "final",
          reason: "Calculation verified.",
          answer: "Allowable limit is 4.5 mm/s. Measured 3.1 mm/s is 68.89% of limit (PASS).",
        });
      });

      const mockRetriever = async () => ({
        results: [{ source: "Motor_M101.pdf", text: "Vibration threshold limit: 4.5 mm/s RMS." }],
      });

      const res = await runAgentTask({
        message: "Find the limit in the manual and calculate what percentage 3.1 mm/s is.",
        userId: "collab-user-1",
        options: { retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].agent, "Research Agent");
      assert.strictEqual(res.steps[1].agent, "Calculator");
      assert.strictEqual(res.steps[1].input.expression, "(3.1 / 4.5) * 100");
      assert.strictEqual(modelLock.getPeakConcurrency(), 1);
      assertSequentialExecution(modelLock.getIntervals());
      pass("Test 5 passed: Research -> Calculator executed with focused mathematical handoff");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6: Vision -> Research
    // Supervisor -> Vision Agent -> Supervisor -> Research Agent -> Supervisor -> Final
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 6] Vision -> Research ---");
    {
      modelLock.resetHistory();
      let supervisorCalls = 0;
      let focusedResearchQuery = "";

      agentGraphService.setAgentBrainLlmClient(async () => {
        supervisorCalls++;
        if (supervisorCalls === 1) {
          return JSON.stringify({
            workflow: "vision_knowledge",
            action: "tool",
            tool: "vision",
            reason: "Extract equipment identifier from the pump tag.",
            input: { prompt: "Read the pump model and tag number." },
          });
        }
        if (supervisorCalls === 2) {
          // Supervisor extracts "Sulzer APP22-80" and creates focused query
          return JSON.stringify({
            workflow: "vision_knowledge",
            action: "tool",
            tool: "retrieve_information",
            reason: "Search Knowledge Base specifically for Sulzer APP22-80 maintenance procedure.",
            input: { query: "Sulzer APP22-80 maintenance procedure" },
          });
        }
        return JSON.stringify({
          workflow: "vision_knowledge",
          action: "final",
          reason: "Procedure found.",
          answer: "The pump is Sulzer APP22-80. Maintenance procedure specifies Plan 11 seal flushing with 15 L/min flow.",
        });
      });

      agentGraphService.setVisionLlmClient(async () => {
        return "Tag OCR: Model: Sulzer APP22-80, Serial: SN-10492, Tag: P-102A.";
      });

      const mockRetriever = async ({ query }) => {
        focusedResearchQuery = query;
        return {
          results: [{ source: "Sulzer_Manual.pdf", text: "Sulzer APP22-80 maintenance: API Plan 11 seal flushing." }],
        };
      };

      const res = await runAgentTask({
        message: "Read the equipment number from this image and retrieve its maintenance procedure.",
        images: [SAMPLE_IMAGE],
        userId: "collab-user-1",
        options: { retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].agent, "Vision Agent");
      assert.strictEqual(res.steps[1].agent, "Research Agent");
      assert.strictEqual(focusedResearchQuery, "Sulzer APP22-80 maintenance procedure", "Research query must be focused on extracted tag");
      assert.strictEqual(modelLock.getPeakConcurrency(), 1);
      assertSequentialExecution(modelLock.getIntervals());
      pass("Test 6 passed: Vision -> Research cleanly passed extracted tag without prompt duplication");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 7: Vision -> Research -> Calculator
    // Supervisor -> Vision -> Supervisor -> Research -> Supervisor -> Calculator -> Supervisor -> Final
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 7] Vision -> Research -> Calculator ---");
    {
      modelLock.resetHistory();
      let supervisorCalls = 0;

      agentGraphService.setAgentBrainLlmClient(async () => {
        supervisorCalls++;
        if (supervisorCalls === 1) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "vision",
            reason: "Read measured vibration from the gauge photo.",
            input: { prompt: "Read the vibration gauge value." },
          });
        }
        if (supervisorCalls === 2) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "retrieve_information",
            reason: "Look up ISO 10816 allowable limit in the Knowledge Base.",
            input: { query: "ISO 10816 Class II vibration limit" },
          });
        }
        if (supervisorCalls === 3) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "calculator",
            reason: "Calculate percentage: (3.6 / 4.5) * 100.",
            input: { expression: "(3.6 / 4.5) * 100" },
          });
        }
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Synthesis complete.",
          answer: "Measured vibration is 3.6 mm/s. ISO limit is 4.5 mm/s. Vibration is at 80.0% of limit.",
        });
      });

      agentGraphService.setVisionLlmClient(async () => "Vibration reading: 3.6 mm/s RMS.");
      const mockRetriever = async () => ({
        results: [{ source: "ISO_10816.pdf", text: "Class II threshold: 4.5 mm/s RMS." }],
      });

      const res = await runAgentTask({
        message: "Read the pressure from this image, find the relevant limit in the knowledge base, calculate the difference, and explain the result.",
        images: [SAMPLE_IMAGE],
        userId: "collab-user-1",
        options: { retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 3);
      assert.strictEqual(res.steps[0].agent, "Vision Agent");
      assert.strictEqual(res.steps[1].agent, "Research Agent");
      assert.strictEqual(res.steps[2].agent, "Calculator");
      assert.strictEqual(modelLock.getPeakConcurrency(), 1);
      assertSequentialExecution(modelLock.getIntervals());
      pass("Test 7 passed: Vision -> Research -> Calculator orchestrated through Supervisor with non-overlapping models");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 8: Coding -> Sandbox
    // Supervisor -> Coding Agent -> Sandbox -> Supervisor -> Final
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 8] Coding -> Sandbox ---");
    {
      modelLock.resetHistory();
      let supervisorCalls = 0;

      agentGraphService.setAgentBrainLlmClient(async () => {
        supervisorCalls++;
        if (supervisorCalls === 1) {
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "coding",
            reason: "Write Python code to compute pump efficiency.",
            input: { task: "Calculate pump efficiency: eff = (Q * H * 9.81) / (P * 1000)", language: "python" },
          });
        }
        if (supervisorCalls === 2) {
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "execute_code",
            reason: "Execute efficiency calculation in container sandbox.",
            input: { code: "eff = (0.05 * 45 * 9.81) / (22 * 1000)\nprint(f'{eff*100:.2f}%')", language: "python" },
          });
        }
        return JSON.stringify({
          workflow: "coding_sandbox",
          action: "final",
          reason: "Execution confirmed.",
          answer: "The pump efficiency script executed with Exit Code 0. Computed efficiency is 0.10%.",
        });
      });

      agentGraphService.setCoderLlmClient(async () => {
        return "```python\neff = (0.05 * 45 * 9.81) / (22 * 1000)\nprint(f'{eff*100:.2f}%')\n```";
      });

      const mockSandboxRunner = async ({ code }) => {
        assert.ok(code.includes("eff ="), "Sandbox must receive clean python code");
        return { success: true, exitCode: 0, stdout: "0.10%\n", stderr: "", timedOut: false };
      };

      const res = await runAgentTask({
        message: "Generate and execute code to calculate pump efficiency.",
        userId: "collab-user-1",
        options: { sandboxRunner: mockSandboxRunner },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].agent, "Coding Agent");
      assert.strictEqual(res.steps[0].toolName, "coding");
      assert.strictEqual(res.steps[1].agent, "Coding Agent");
      assert.strictEqual(res.steps[1].toolName, "execute_code");
      assert.strictEqual(modelLock.getPeakConcurrency(), 1);
      assertSequentialExecution(modelLock.getIntervals());
      pass("Test 8 passed: Coding -> Sandbox generated code and executed in isolated container");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 9: Vision -> Research -> Calculator -> Final (Full Industrial Workflow)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 9] Vision -> Research -> Calculator -> Final ---");
    {
      modelLock.resetHistory();
      let supervisorCalls = 0;
      const progressPhases = [];

      agentGraphService.setAgentBrainLlmClient(async () => {
        supervisorCalls++;
        if (supervisorCalls === 1) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "vision",
            reason: "Read pressure gauge P-201.",
            input: { prompt: "Read the pressure on gauge P-201." },
          });
        }
        if (supervisorCalls === 2) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "retrieve_information",
            reason: "Look up maximum operating pressure for line P-201 in the Knowledge Base.",
            input: { query: "Line P-201 maximum operating pressure limit" },
          });
        }
        if (supervisorCalls === 3) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "calculator",
            reason: "Calculate safety margin: 10.0 - 7.5.",
            input: { expression: "10.0 - 7.5" },
          });
        }
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Complete assessment synthesized.",
          answer: "1. Vision: Gauge reading = 7.5 bar.\n2. Research: Maximum operating limit = 10.0 bar.\n3. Calculator: Safety margin = 2.5 bar.\nConclusion: Line P-201 is operating within safe operating limits.",
        });
      });

      agentGraphService.setVisionLlmClient(async () => "Gauge P-201 reads 7.5 bar.");
      const mockRetriever = async () => ({
        results: [{ source: "Piping_Spec.pdf", text: "Line P-201 design limit: 10.0 bar maximum." }],
      });

      const res = await runAgentTask({
        message: "Read gauge P-201, find its design limit in documentation, calculate safety margin, and summarize.",
        images: [SAMPLE_IMAGE],
        userId: "collab-user-1",
        options: {
          retriever: mockRetriever,
          onProgress: (ev) => progressPhases.push(ev.phase || ev.status),
        },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 3);
      assert.strictEqual(res.steps[0].agent, "Vision Agent");
      assert.strictEqual(res.steps[1].agent, "Research Agent");
      assert.strictEqual(res.steps[2].agent, "Calculator");
      assert.ok(res.response.includes("2.5 bar"));
      assert.strictEqual(modelLock.getPeakConcurrency(), 1);
      assertSequentialExecution(modelLock.getIntervals());

      // Verify streaming lifecycle across all steps
      assert.ok(progressPhases.includes("Supervisor started"));
      assert.ok(progressPhases.includes("Agent selected"));
      assert.ok(progressPhases.includes("Next agent"));
      assert.ok(progressPhases.includes("Final response"));

      pass("Test 9 passed: Full Vision -> Research -> Calculator pipeline verified with sequential intervals");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 10: Agent Failure and Bounded Retry
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 10] Agent Failure and Bounded Retry ---");
    {
      modelLock.resetHistory();
      let supervisorCalls = 0;
      let visionCalls = 0;

      agentGraphService.setAgentBrainLlmClient(async () => {
        supervisorCalls++;
        if (supervisorCalls === 1) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "vision",
            reason: "Attempt visual inspection.",
            input: { prompt: "Read the meter value." },
          });
        }
        if (supervisorCalls === 2) {
          // Supervisor detects vision failure, decides to retry with clarified prompt
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "vision",
            reason: "Retry visual extraction with contrast enhancement instruction.",
            input: { prompt: "Extract meter reading with high contrast focus." },
          });
        }
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Meter reading extracted on retry.",
          answer: "On retry, meter value is 120.4 kWh.",
        });
      });

      agentGraphService.setVisionLlmClient(async () => {
        visionCalls++;
        if (visionCalls === 1) {
          throw new Error("Temporary optical blur / OCR parse failure");
        }
        return "Meter value: 120.4 kWh.";
      });

      const res = await runAgentTask({
        message: "Read the meter value from this blurry photo.",
        images: [SAMPLE_IMAGE],
        userId: "collab-user-1",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].status, "failed");
      assert.strictEqual(res.steps[1].status, "completed");
      assert.strictEqual(modelLock.isLocked(), false, "Lock must be released after failure");
      assert.strictEqual(modelLock.getActiveInferences(), 0);
      assert.strictEqual(modelLock.getPeakConcurrency(), 1);
      assertSequentialExecution(modelLock.getIntervals());
      pass("Test 10 passed: Agent failure immediately released lock and Supervisor recovered via bounded retry");
    }

    console.log("\n================================================================================");
    console.log(`ALL ${testsPassed} MULTI-AGENT COLLABORATION TESTS PASSED!`);
    console.log("================================================================================");
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
    agentGraphService.resetCoderLlmClient();
    agentGraphService.resetVisionLlmClient();
  }
}

runTests().catch((err) => {
  console.error("\n❌ TEST SUITE FAILED:", err);
  process.exit(1);
});
