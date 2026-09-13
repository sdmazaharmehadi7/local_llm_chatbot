/**
 * Multi-Agent Architecture Test Suite
 *
 * Validates the Multi-Agent Architecture built on the sovereign LangGraph engine:
 * - Central Supervisor Agent (Qwen3:8b)
 * - Research Agent (Knowledge Base / RAG)
 * - Vision Agent (Qwen2.5-VL)
 * - Coding Agent (Qwen2.5-Coder + Sandbox + Repair loop)
 * - Deterministic Tools (Calculator, Sandbox)
 * - Strict Single-Model Hardware Lock (max concurrency = 1)
 * - Context Isolation across chat sessions
 */

import assert from "assert";
import { runAgentTask } from "../src/services/agent/agent.service.js";
import { agentGraphService } from "../src/services/agent/agentGraph.service.js";
import { modelLock } from "../src/services/agent/modelLock.service.js";
import { researchAgentService } from "../src/services/agent/specialists/researchAgent.service.js";
import { visionAgentService } from "../src/services/agent/specialists/visionAgent.service.js";
import { codingAgentService } from "../src/services/agent/specialists/codingAgent.service.js";
import { WORKFLOW_TYPES } from "../src/services/agent/agent.types.js";

console.log("================================================================================");
console.log("STARTING MULTI-AGENT ARCHITECTURE TEST SUITE");
console.log("================================================================================");

let testsPassed = 0;
function pass(testName) {
  testsPassed++;
  console.log(`✔ [PASS] ${testName}`);
}

const SAMPLE_IMAGE_BASE64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function runTests() {
  try {
    modelLock.resetHistory();

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: Normal Agent Task (Supervisor -> Final Answer directly)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 1] Normal Agent Task (Supervisor Direct) ---");
    {
      agentGraphService.setAgentBrainLlmClient(async () => {
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "General conceptual inquiry about centrifugal pumps.",
          answer: "A centrifugal pump converts rotational kinetic energy from an impeller into hydrodynamic energy of fluid flow.",
        });
      });

      const res = await runAgentTask({
        message: "What is a centrifugal pump?",
        userId: "test-user-1",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 0, "Supervisor should answer directly with 0 tools");
      assert.strictEqual(res.state.agents_invoked.length, 0);
      assert.ok(res.response.includes("rotational kinetic energy"));
      pass("Test 1 passed: Normal task handled directly by Supervisor without tool delegation");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: Research Task (Supervisor -> Research Agent -> Supervisor -> Final)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 2] Research Task (Supervisor -> Research Agent -> Final) ---");
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "knowledge_retrieval",
            action: "tool",
            tool: "retrieve_information",
            reason: "Query Knowledge Base for pump bearing vibration standards.",
            input: { query: "ISO 10816-3 Zone B allowable vibration" },
          });
        }
        return JSON.stringify({
          workflow: "knowledge_retrieval",
          action: "final",
          reason: "Synthesizing research findings.",
          answer: "According to ISO 10816-3, the allowable vibration velocity threshold for Zone B (unrestricted long-term operation) is 4.5 mm/s RMS.",
        });
      });

      const mockRetriever = async () => ({
        results: [
          {
            source: "ISO_10816-3_Standard.pdf",
            page: 14,
            text: "ISO 10816-3: Class II Industrial Pumps Zone B/C boundary = 4.5 mm/s RMS.",
            score: 0.95,
          },
        ],
      });

      const res = await runAgentTask({
        message: "What is the ISO 10816-3 Zone B limit for industrial pumps?",
        userId: "test-user-1",
        options: { retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 1);
      assert.strictEqual(res.steps[0].agent, "Research Agent");
      assert.strictEqual(res.steps[0].toolName, "retrieve_information");
      assert.ok(res.state.agents_invoked.includes("Research Agent"));
      assert.strictEqual(res.state.specialist_results.length, 1);
      assert.ok(res.response.includes("4.5 mm/s RMS"));
      pass("Test 2 passed: Research task delegates to Research Agent and integrates findings via Supervisor");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: Vision Task (Supervisor -> Vision Agent -> Supervisor -> Final)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 3] Vision Task (Supervisor -> Vision Agent -> Final) ---");
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "vision_knowledge",
            action: "tool",
            tool: "vision",
            reason: "Delegate visual OCR to Vision Agent.",
            input: { prompt: "Read the discharge pressure on gauge PI-101." },
          });
        }
        return JSON.stringify({
          workflow: "vision_knowledge",
          action: "final",
          reason: "Visual extraction complete.",
          answer: "Discharge pressure gauge PI-101 displays 6.2 bar.",
        });
      });

      agentGraphService.setVisionLlmClient(async () => {
        return "Gauge PI-101 indicator needle shows exactly 6.2 bar discharge pressure.";
      });

      const res = await runAgentTask({
        message: "Read the pressure gauge in the attached photo.",
        images: [SAMPLE_IMAGE_BASE64],
        userId: "test-user-1",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 1);
      assert.strictEqual(res.steps[0].agent, "Vision Agent");
      assert.strictEqual(res.steps[0].toolName, "vision");
      assert.ok(res.state.agents_invoked.includes("Vision Agent"));
      assert.ok(res.response.includes("6.2 bar"));
      pass("Test 3 passed: Vision task delegates to Vision Agent under model lock");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: Coding Task (Supervisor -> Coding Agent -> Supervisor -> Final)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 4] Coding Task (Supervisor -> Coding Agent -> Final) ---");
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "coding",
            reason: "Delegate pump flow calculation script to Coding Agent.",
            input: {
              task: "Write a Python function to calculate centrifugal pump flow rate from differential pressure.",
              language: "python",
            },
          });
        }
        return JSON.stringify({
          workflow: "coding_sandbox",
          action: "final",
          reason: "Code generation completed by Coding Agent.",
          answer: "Here is the verified Python function for flow calculation:\n\n```python\ndef calculate_flow(dp, k=1.0):\n    return k * (dp ** 0.5)\n```",
        });
      });

      agentGraphService.setCoderLlmClient(async () => {
        return "```python\ndef calculate_flow(dp, k=1.0):\n    return k * (dp ** 0.5)\n```";
      });

      const res = await runAgentTask({
        message: "Write a Python function to calculate centrifugal pump flow rate.",
        userId: "test-user-1",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 1);
      assert.strictEqual(res.steps[0].agent, "Coding Agent");
      assert.strictEqual(res.steps[0].toolName, "coding");
      assert.ok(res.state.agents_invoked.includes("Coding Agent"));
      assert.ok(res.response.includes("calculate_flow"));
      pass("Test 4 passed: Coding task delegates to Coding Agent under model lock");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: Vision + Calculator Task
    // Supervisor -> Vision Agent -> Supervisor -> Calculator (tool) -> Supervisor -> Final
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 5] Vision + Calculator Task ---");
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "vision_calculation",
            action: "tool",
            tool: "vision",
            reason: "Extract motor power P and speed N from the nameplate.",
            input: { prompt: "Extract motor power and RPM from nameplate." },
          });
        }
        if (callCount === 2) {
          return JSON.stringify({
            workflow: "vision_calculation",
            action: "tool",
            tool: "calculator",
            reason: "Calculate torque T = (22 * 9550) / 960.",
            input: { expression: "(22 * 9550) / 960" },
          });
        }
        return JSON.stringify({
          workflow: "vision_calculation",
          action: "final",
          reason: "Torque calculation verified.",
          answer: "From the nameplate: P = 22 kW, N = 960 RPM. Computed torque T = 218.85 Nm.",
        });
      });

      agentGraphService.setVisionLlmClient(async () => {
        return "Nameplate: Power = 22 kW, Speed = 960 RPM.";
      });

      const res = await runAgentTask({
        message: "Calculate torque from the motor nameplate image.",
        images: [SAMPLE_IMAGE_BASE64],
        userId: "test-user-1",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].agent, "Vision Agent");
      assert.strictEqual(res.steps[1].agent, "Calculator");
      assert.ok(res.state.agents_invoked.includes("Vision Agent"));
      assert.ok(res.state.agents_invoked.includes("Calculator"));
      assert.ok(res.response.includes("218.85"));
      pass("Test 5 passed: Vision + Calculator sequentially orchestrated by Supervisor");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6: Research + Calculator Task
    // Supervisor -> Research Agent -> Supervisor -> Calculator -> Supervisor -> Final
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 6] Research + Calculator Task ---");
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "retrieval_calculation",
            action: "tool",
            tool: "retrieve_information",
            reason: "Look up allowable vibration limit in the technical manual.",
            input: { query: "allowable vibration limit for motor M-101" },
          });
        }
        if (callCount === 2) {
          return JSON.stringify({
            workflow: "retrieval_calculation",
            action: "tool",
            tool: "calculator",
            reason: "Compute percentage of allowable threshold: (3.1 / 4.5) * 100.",
            input: { expression: "(3.1 / 4.5) * 100" },
          });
        }
        return JSON.stringify({
          workflow: "retrieval_calculation",
          action: "final",
          reason: "Calculation and verification complete.",
          answer: "Allowable vibration limit is 4.5 mm/s. Measured vibration 3.1 mm/s represents 68.89% of the allowable limit (PASS).",
        });
      });

      const mockRetriever = async () => ({
        results: [{ source: "Motor_Manual.pdf", text: "Motor M-101 allowable vibration: 4.5 mm/s RMS." }],
      });

      const res = await runAgentTask({
        message: "If measured vibration is 3.1 mm/s, what percentage of the manual limit is that?",
        userId: "test-user-1",
        options: { retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].agent, "Research Agent");
      assert.strictEqual(res.steps[1].agent, "Calculator");
      assert.ok(res.response.includes("68.89%"));
      pass("Test 6 passed: Research + Calculator orchestrated via Supervisor");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 7: Vision + Research Task
    // Supervisor -> Vision Agent -> Supervisor -> Research Agent -> Supervisor -> Final
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 7] Vision + Research Task ---");
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "vision_knowledge",
            action: "tool",
            tool: "vision",
            reason: "Extract equipment model number from the pump tag photo.",
            input: { prompt: "Extract model number and serial number." },
          });
        }
        if (callCount === 2) {
          return JSON.stringify({
            workflow: "vision_knowledge",
            action: "tool",
            tool: "retrieve_information",
            reason: "Search Knowledge Base for maintenance procedure for Sulzer Ahlstar APP22-80.",
            input: { query: "Sulzer Ahlstar APP22-80 seal flush procedure" },
          });
        }
        return JSON.stringify({
          workflow: "vision_knowledge",
          action: "final",
          reason: "Equipment identified from image and maintenance procedure retrieved.",
          answer: "The tag identifies the pump as Sulzer Ahlstar APP22-80. Knowledge Base maintenance procedure: Plan 11 seal flush with 15 L/min minimum circulation.",
        });
      });

      agentGraphService.setVisionLlmClient(async () => {
        return "Tag inspection: Model = Sulzer Ahlstar APP22-80, Serial = SN-88391.";
      });

      const mockRetriever = async () => ({
        results: [{ source: "Pump_Maintenance_Guide.pdf", text: "Sulzer Ahlstar APP22-80 requires API Plan 11 seal flush." }],
      });

      const res = await runAgentTask({
        message: "Identify this pump and get its seal flush procedure.",
        images: [SAMPLE_IMAGE_BASE64],
        userId: "test-user-1",
        options: { retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].agent, "Vision Agent");
      assert.strictEqual(res.steps[1].agent, "Research Agent");
      assert.ok(res.response.includes("Sulzer Ahlstar APP22-80"));
      pass("Test 7 passed: Vision + Research orchestrated without direct specialist-to-specialist contact");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 8: Vision + Research + Calculator Task
    // Supervisor -> Vision Agent -> Supervisor -> Research Agent -> Supervisor -> Calculator -> Supervisor -> Final
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 8] Vision + Research + Calculator Task ---");
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "vision",
            reason: "Read measured vibration from gauge image.",
            input: { prompt: "Read the vibration gauge value." },
          });
        }
        if (callCount === 2) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "retrieve_information",
            reason: "Retrieve ISO 10816 threshold from Knowledge Base.",
            input: { query: "ISO 10816 Class II vibration threshold" },
          });
        }
        if (callCount === 3) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "calculator",
            reason: "Calculate safety margin: ((4.5 - 3.6) / 4.5) * 100.",
            input: { expression: "((4.5 - 3.6) / 4.5) * 100" },
          });
        }
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "All extractions, lookups, and calculations complete.",
          answer: "1. Vision: Gauge reading = 3.6 mm/s.\n2. Research: ISO limit = 4.5 mm/s.\n3. Calculator: Safety margin = 20.0%.\nVerdict: Operating safely within limits.",
        });
      });

      agentGraphService.setVisionLlmClient(async () => "Vibration gauge needle points to 3.6 mm/s.");
      const mockRetriever = async () => ({
        results: [{ source: "ISO_Standard.pdf", text: "ISO 10816 Class II threshold: 4.5 mm/s." }],
      });

      const res = await runAgentTask({
        message: "Read gauge, check ISO limit in KB, and calculate safety margin.",
        images: [SAMPLE_IMAGE_BASE64],
        userId: "test-user-1",
        options: { retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 3);
      assert.strictEqual(res.steps[0].agent, "Vision Agent");
      assert.strictEqual(res.steps[1].agent, "Research Agent");
      assert.strictEqual(res.steps[2].agent, "Calculator");
      assert.ok(res.response.includes("20.0%"));
      pass("Test 8 passed: Tri-capability flow (Vision -> Research -> Calculator) orchestrated sequentially");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 9: Coding + Sandbox with Repair Loop (Bounded to 2 attempts)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 9] Coding + Sandbox with Repair Loop ---");
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "coding",
            reason: "Generate initial Python script.",
            input: { task: "Calculate bearing life", language: "python" },
          });
        }
        if (callCount === 2) {
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "execute_code",
            reason: "Execute initial code in sandbox.",
            input: { code: "print(bearing_life)", language: "python" },
          });
        }
        if (callCount === 3) {
          // Supervisor delegates repair to Coding Agent
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "coding",
            reason: "Fix NameError: bearing_life is not defined.",
            input: { task: "Fix NameError in bearing life calculation", language: "python" },
          });
        }
        if (callCount === 4) {
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "execute_code",
            reason: "Execute repaired code in sandbox.",
            input: { code: "bearing_life = 45000\nprint(bearing_life)", language: "python" },
          });
        }
        return JSON.stringify({
          workflow: "coding_sandbox",
          action: "final",
          reason: "Repaired code executed successfully.",
          answer: "The repaired code executed with Exit Code 0. Result: bearing life = 45,000 hours.",
        });
      });

      agentGraphService.setCoderLlmClient(async () => {
        return "```python\nbearing_life = 45000\nprint(bearing_life)\n```";
      });

      let sandboxExecCount = 0;
      const mockSandboxRunner = async ({ code }) => {
        sandboxExecCount++;
        if (sandboxExecCount === 1) {
          return { success: false, exitCode: 1, stderr: "NameError: name 'bearing_life' is not defined", timedOut: false };
        }
        return { success: true, exitCode: 0, stdout: "45000\n", stderr: "", timedOut: false };
      };

      const res = await runAgentTask({
        message: "Run a Python script to compute bearing life.",
        userId: "test-user-1",
        options: { sandboxRunner: mockSandboxRunner },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 4);
      // Step sequence: Coding -> Execute (fail) -> Coding (repair) -> Execute (success)
      assert.strictEqual(res.steps[0].toolName, "coding");
      assert.strictEqual(res.steps[1].toolName, "execute_code");
      assert.strictEqual(res.steps[1].status, "failed");
      assert.strictEqual(res.steps[2].toolName, "coding");
      assert.strictEqual(res.steps[3].toolName, "execute_code");
      assert.strictEqual(res.steps[3].status, "completed");
      assert.ok(res.response.includes("45,000 hours"));
      pass("Test 9 passed: Coding Agent successfully repaired failed sandbox execution within 2 attempts");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 10: General Fallback Task
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 10] General Fallback Task ---");
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "text_transform",
            reason: "Format technical spec to uppercase.",
            input: { operation: "uppercase", text: "critical alarm: p-102 high temp" },
          });
        }
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Transformation complete.",
          answer: "Formatted alert: CRITICAL ALARM: P-102 HIGH TEMP",
        });
      });

      const res = await runAgentTask({
        message: "Format this alarm to uppercase.",
        userId: "test-user-1",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow?.type, WORKFLOW_TYPES.GENERAL);
      assert.strictEqual(res.steps[0].toolName, "text_transform");
      assert.ok(res.response.includes("CRITICAL ALARM"));
      pass("Test 10 passed: General fallback workflow safely accommodates non-specialist requests");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 11: Single-Model Resource Lock Concurrency Verification
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 11] Single-Model Execution Lock Concurrency Verification ---");
    {
      // Verify that peak concurrency across all prior tests remained exactly 1
      const priorPeak = modelLock.getPeakConcurrency();
      assert.strictEqual(priorPeak, 1, `Peak concurrency must never exceed 1 (was ${priorPeak})`);

      // Active concurrent simulation: spawn 5 simultaneous agents requesting lock
      const executionOrder = [];
      const concurrentTasks = [
        { agent: "Supervisor", model: "qwen3:8b", delay: 30 },
        { agent: "Vision Agent", model: "qwen2.5vl:7b", delay: 25 },
        { agent: "Coding Agent", model: "qwen2.5-coder:7b", delay: 20 },
        { agent: "Supervisor", model: "qwen3:8b", delay: 15 },
        { agent: "Vision Agent", model: "qwen2.5vl:7b", delay: 10 },
      ].map((req, idx) =>
        modelLock.withLock(req.agent, req.model, async () => {
          assert.strictEqual(modelLock.getActiveInferences(), 1, "Active inferences MUST be exactly 1");
          assert.strictEqual(modelLock.getCurrentHolder(), req.agent);
          assert.strictEqual(modelLock.getCurrentModel(), req.model);
          await new Promise((r) => setTimeout(r, req.delay));
          executionOrder.push(`Task-${idx + 1}:${req.agent}:${req.model}`);
        })
      );

      await Promise.all(concurrentTasks);

      assert.strictEqual(executionOrder.length, 5);
      assert.strictEqual(modelLock.getPeakConcurrency(), 1, "Concurrency violation: Peak concurrency exceeded 1!");
      assert.strictEqual(modelLock.getActiveInferences(), 0, "All locks must be released");
      assert.strictEqual(modelLock.isLocked(), false);

      // Verify FIFO ordering
      assert.strictEqual(executionOrder[0], "Task-1:Supervisor:qwen3:8b");
      assert.strictEqual(executionOrder[1], "Task-2:Vision Agent:qwen2.5vl:7b");
      assert.strictEqual(executionOrder[2], "Task-3:Coding Agent:qwen2.5-coder:7b");
      assert.strictEqual(executionOrder[3], "Task-4:Supervisor:qwen3:8b");
      assert.strictEqual(executionOrder[4], "Task-5:Vision Agent:qwen2.5vl:7b");

      pass("Test 11 passed: Single-Model Lock strictly queued 5 concurrent requests with ZERO parallel inference");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 12: Context Isolation Across Chats
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 12] Context Isolation Across Chats ---");
    {
      // Turn A: chat-alpha has image and vision tool
      let stepCountA = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepCountA++;
        if (stepCountA === 1) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "vision",
            reason: "Analyze pump in chat-alpha.",
            input: { prompt: "Analyze pump" },
          });
        }
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Visual extraction complete.",
          answer: "Pump inspection completed for Chat A.",
        });
      });
      agentGraphService.setVisionLlmClient(async () => "Alpha pump visual extraction");

      const resA = await runAgentTask({
        message: "Analyze this image in chat A.",
        chatId: "chat-alpha",
        userId: "test-user-isolation",
        images: [SAMPLE_IMAGE_BASE64],
      });

      // Turn B: chat-beta has NO images and asks a pure math question
      let stepCountB = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepCountB++;
        if (stepCountB === 1) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "calculator",
            reason: "Calculate 15 * 6.",
            input: { expression: "15 * 6" },
          });
        }
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Done.",
          answer: "90",
        });
      });

      const resB = await runAgentTask({
        message: "What is 15 * 6 in chat B?",
        chatId: "chat-beta",
        userId: "test-user-isolation",
      });

      assert.strictEqual(resA.chatId, "chat-alpha");
      assert.strictEqual(resB.chatId, "chat-beta");
      assert.strictEqual(resB.steps.length, 1);
      assert.strictEqual(resB.steps[0].toolName, "calculator");
      // Verify chat-beta state has 0 vision steps and 0 image leakage
      assert.ok(!resB.state.agents_invoked.includes("Vision Agent"));
      assert.strictEqual(resB.state.retrieved_facts.length, 0);
      assert.strictEqual(resB.response, "90");

      pass("Test 12 passed: Chat B starts with clean agent context and zero leakage from Chat A");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 13: Direct Specialist Service Verification
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 13] Direct Specialist Service Verification ---");
    {
      // 1. Research Agent direct call
      const researchRes = await researchAgentService.executeResearch({
        query: "bearing lubrication",
        retriever: async () => ({
          results: [{ source: "Lubrication.pdf", text: "ISO VG 46 synthetic oil required." }],
        }),
      });
      assert.strictEqual(researchRes.success, true);
      assert.strictEqual(researchRes.agent, "Research Agent");
      assert.strictEqual(researchRes.results.length, 1);

      // 2. Vision Agent direct call (mocked client)
      const visionRes = await visionAgentService.executeVisionTask({
        prompt: "Check gauge value",
        images: [SAMPLE_IMAGE_BASE64],
        visionClient: async () => "Gauge reads 4.2 bar with 1200 rpm indicator.",
      });
      assert.strictEqual(visionRes.success, true);
      assert.strictEqual(visionRes.agent, "Vision Agent");
      assert.ok(visionRes.extractedMeasurements.length > 0);

      // 3. Coding Agent direct call (mocked client & sandbox)
      const codingRes = await codingAgentService.generateCode({
        task: "Fibonacci function",
        language: "python",
        coderClient: async () => "def fib(n): return n if n <= 1 else fib(n-1) + fib(n-2)",
      });
      assert.strictEqual(codingRes.success, true);
      assert.strictEqual(codingRes.agent, "Coding Agent");
      assert.ok(codingRes.code.includes("fib"));

      const sandboxRes = await codingAgentService.executeSandbox({
        code: codingRes.code,
        sandboxRunner: async () => ({ success: true, exitCode: 0, stdout: "55\n" }),
      });
      assert.strictEqual(sandboxRes.success, true);
      assert.strictEqual(sandboxRes.stdout, "55\n");

      pass("Test 13 passed: Direct specialist service methods execute cleanly under model lock");
    }

    console.log("\n================================================================================");
    console.log(`ALL ${testsPassed} MULTI-AGENT ARCHITECTURE TESTS PASSED!`);
    console.log("================================================================================");
  } finally {
    // Reset test clients
    agentGraphService.resetAgentBrainLlmClient();
    agentGraphService.resetCoderLlmClient();
    agentGraphService.resetVisionLlmClient();
  }
}

runTests().catch((err) => {
  console.error("\n❌ TEST SUITE FAILED:", err);
  process.exit(1);
});
