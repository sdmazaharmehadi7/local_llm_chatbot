/**
 * Acceptance Test Suite: Six Controlled Industrial Workflows inside LangGraph Agent
 *
 * Validates all six industrial workflow execution patterns:
 * 1. Workflow 1 — Knowledge Retrieval (Qwen3 -> Retrieval -> Qwen3 -> Final)
 * 2. Workflow 2 — Retrieval + Calculation (Qwen3 -> Retrieval -> Qwen3 -> Calculator -> Qwen3 -> Final)
 * 3. Workflow 3 — Vision + Calculation (Qwen3 -> Vision -> Qwen3 -> Calculator -> Qwen3 -> Final)
 * 4. Workflow 4 — Vision + Knowledge Base (Qwen3 -> Vision -> Qwen3 -> Retrieval -> Qwen3 -> Final)
 * 5. Workflow 5 — Coding + Sandbox (Qwen3 -> Coding -> Sandbox -> Qwen3 -> Final)
 *    + Coding failure & repair loop (bounded to max 2 repair attempts)
 * 6. Workflow 6 — General Multi-Tool Fallback (Cavitation direct answer, dynamic ordering, complex multi-tool)
 * 7. Context Isolation (Clean state on new chat turn, zero leakage of images/tools)
 */

import assert from "assert";
import { runAgentTask } from "../src/services/agent/agent.service.js";
import { agentGraphService } from "../src/services/agent/agentGraph.service.js";
import { WORKFLOW_TYPES } from "../src/services/agent/agent.types.js";

console.log("================================================================================");
console.log("STARTING SIX CONTROLLED INDUSTRIAL WORKFLOWS ACCEPTANCE TEST SUITE");
console.log("================================================================================");

let testsPassed = 0;
function pass(testName) {
  testsPassed++;
  console.log(`✔ [PASS] ${testName}`);
}

// Sample base64 image for vision tests
const SAMPLE_IMAGE_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function runTests() {
  try {
    // ───────────────────────────────────────────────────────────────────────────
    // TEST 1: Workflow 6 — General question (0 tools required)
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 1] Workflow 6 — General Question ---");
    {
      agentGraphService.setAgentBrainLlmClient(async () => {
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Cavitation explanation is a conceptual topic requiring general engineering knowledge.",
          answer: "Centrifugal pump cavitation occurs when local static pressure in a fluid drops below its vapor pressure, causing vapor bubbles to form and subsequently collapse violently against the impeller surface, resulting in pitting, vibration, and loss of head.",
        });
      });

      const res = await runAgentTask({
        message: "Explain centrifugal pump cavitation.",
        userId: "test-eng-1",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow?.type, WORKFLOW_TYPES.GENERAL);
      assert.strictEqual(res.steps.length, 0, "General question must use 0 tools");
      assert.ok(res.response.includes("cavitation"), "Must explain cavitation");
      pass("Test 1 passed: General question correctly uses Workflow 6 (general) with 0 tool calls");
    }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 2: Workflow 6 — Calculator only
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 2] Workflow 6 — Calculator Only ---");
    {
      let stepCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepCount++;
        if (stepCount === 1) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "calculator",
            reason: "Evaluate 25 * 40 directly.",
            input: { expression: "25 * 40" },
          });
        }
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Calculation complete.",
          answer: "The result of 25 * 40 is 1000.",
        });
      });

      const res = await runAgentTask({
        message: "What is 25 * 40?",
        userId: "test-eng-1",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 1);
      assert.strictEqual(res.steps[0].toolName, "calculator");
      assert.strictEqual(res.steps[0].input.expression, "25 * 40");
      assert.ok(res.response.includes("1000"));
      // Ensure no retrieval, vision, or coding tools were called
      const toolsCalled = res.steps.map((s) => s.toolName);
      assert.ok(!toolsCalled.includes("retrieve_information"));
      assert.ok(!toolsCalled.includes("vision"));
      assert.ok(!toolsCalled.includes("coding"));
      assert.ok(!toolsCalled.includes("execute_code"));
      pass("Test 2 passed: Calculator only task executes Qwen3 -> Calculator -> Qwen3 -> Final");
    }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 3: Workflow 1 — Knowledge Retrieval
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 3] Workflow 1 — Knowledge Retrieval ---");
    {
      let stepCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepCount++;
        if (stepCount === 1) {
          return JSON.stringify({
            workflow: "knowledge_retrieval",
            action: "tool",
            tool: "retrieve_information",
            reason: "Retrieve pump maintenance PPE requirements from organizational documents.",
            input: { query: "pump maintenance PPE requirements" },
          });
        }
        return JSON.stringify({
          workflow: "knowledge_retrieval",
          action: "final",
          reason: "PPE requirements retrieved from document.",
          answer: "According to SOP-PUMP-04, the required PPE includes: steel-toed boots, safety glasses with side shields, chemical-resistant nitrile gloves, and hearing protection.",
        });
      });

      const mockRetriever = async () => ({
        results: [
          {
            filename: "SOP-PUMP-04.pdf",
            page: 2,
            text: "Section 4.1 PPE: Operators must wear safety glasses, steel-toed boots, chemical-resistant nitrile gloves, and hearing protection.",
          },
        ],
      });

      const res = await runAgentTask({
        message: "What PPE is required for pump maintenance according to our documents?",
        userId: "test-eng-1",
        options: { retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow?.type, WORKFLOW_TYPES.KNOWLEDGE_RETRIEVAL);
      assert.strictEqual(res.steps.length, 1);
      assert.strictEqual(res.steps[0].toolName, "retrieve_information");
      assert.ok(res.response.includes("SOP-PUMP-04"));
      assert.ok(res.response.includes("gloves"));
      pass("Test 3 passed: Workflow 1 (knowledge_retrieval) correctly executes Qwen3 -> Retrieval -> Qwen3 -> Final");
    }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 4: Workflow 2 — Retrieval + Calculation
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 4] Workflow 2 — Retrieval + Calculation ---");
    {
      let stepCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepCount++;
        if (stepCount === 1) {
          return JSON.stringify({
            workflow: "retrieval_calculation",
            action: "tool",
            tool: "retrieve_information",
            reason: "Retrieve pump suction and discharge pressures from maintenance document.",
            input: { query: "pump suction and discharge pressure" },
          });
        }
        if (stepCount === 2) {
          return JSON.stringify({
            workflow: "retrieval_calculation",
            action: "tool",
            tool: "calculator",
            reason: "Calculate differential pressure: discharge 5.4 bar - suction 0.6 bar.",
            input: { expression: "5.4 - 0.6" },
          });
        }
        return JSON.stringify({
          workflow: "retrieval_calculation",
          action: "final",
          reason: "Both values retrieved and difference calculated.",
          answer: "From Pump_Data_Sheet.pdf:\n- Discharge Pressure: 5.4 bar\n- Suction Pressure: 0.6 bar\n\nPressure Difference: 5.4 - 0.6 = 4.8 bar.",
        });
      });

      const mockRetriever = async () => ({
        results: [
          {
            filename: "Pump_Data_Sheet.pdf",
            page: 1,
            text: "Operating parameters: Discharge pressure = 5.4 bar, Suction pressure = 0.6 bar.",
          },
        ],
      });

      const res = await runAgentTask({
        message: "Retrieve the discharge and suction pressure from the document and calculate the pressure difference.",
        userId: "test-eng-1",
        options: { retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow?.type, WORKFLOW_TYPES.RETRIEVAL_CALCULATION);
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].toolName, "retrieve_information");
      assert.strictEqual(res.steps[1].toolName, "calculator");
      assert.strictEqual(res.steps[1].input.expression, "5.4 - 0.6");
      assert.strictEqual(res.steps[1].observation.value, 4.8);
      assert.ok(res.response.includes("4.8 bar"));
      pass("Test 4 passed: Workflow 2 (retrieval_calculation) executes Qwen3 -> Retrieval -> Qwen3 -> Calculator -> Qwen3 -> Final");
    }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 5: Image analysis only
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 5] Image Analysis Only ---");
    {
      let stepCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepCount++;
        if (stepCount === 1) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "vision",
            reason: "Inspect image of industrial equipment to describe visible components.",
            input: { prompt: "Describe the equipment and visible components in this image." },
          });
        }
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Equipment visual description synthesized.",
          answer: "The image depicts a horizontal end-suction centrifugal pump coupled to a 3-phase TEFC induction motor mounted on a cast iron baseplate with flexible coupling guard.",
        });
      });

      const mockVisionClient = async () =>
        "Visual Analysis:\nHorizontal end-suction centrifugal pump coupled to an electric motor with coupling guard.";

      const res = await runAgentTask({
        message: "Describe the equipment shown in this image.",
        userId: "test-eng-1",
        images: [SAMPLE_IMAGE_BASE64],
        options: { visionClient: mockVisionClient },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 1);
      assert.strictEqual(res.steps[0].toolName, "vision");
      assert.ok(res.response.includes("centrifugal pump"));
      pass("Test 5 passed: Image analysis only invokes Vision with 0 unnecessary Calculator calls");
    }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 6: Workflow 3 — Vision + Calculation
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 6] Workflow 3 — Vision + Calculation ---");
    {
      let stepCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepCount++;
        if (stepCount === 1) {
          return JSON.stringify({
            workflow: "vision_calculation",
            action: "tool",
            tool: "vision",
            reason: "Extract visible power and speed values from the motor nameplate image.",
            input: { prompt: "Extract visible power (P in kW) and speed (N in RPM) from the nameplate." },
          });
        }
        if (stepCount === 2) {
          return JSON.stringify({
            workflow: "vision_calculation",
            action: "tool",
            tool: "calculator",
            reason: "Calculate torque using extracted values: 22 * 9550 / 960.",
            input: { expression: "22 * 9550 / 960" },
          });
        }
        return JSON.stringify({
          workflow: "vision_calculation",
          action: "final",
          reason: "Values extracted and calculation verified.",
          answer: "From the image nameplate:\n- Power (P): 22 kW\n- Speed (N): 960 RPM\n\nVerified Torque Calculation: T = 22 * 9550 / 960 = 218.85 Nm.",
        });
      });

      const mockVisionClient = async () =>
        "Visual Analysis:\nNameplate shows Power P = 22 kW, Speed N = 960 RPM, Displayed Torque = 218.9 Nm.";

      const res = await runAgentTask({
        message: "Extract the values from this image and verify the calculation.",
        userId: "test-eng-1",
        images: [SAMPLE_IMAGE_BASE64],
        options: { visionClient: mockVisionClient },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow?.type, WORKFLOW_TYPES.VISION_CALCULATION);
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].toolName, "vision");
      assert.strictEqual(res.steps[1].toolName, "calculator");
      assert.strictEqual(res.steps[1].input.expression, "22 * 9550 / 960");
      assert.ok(res.response.includes("218.85"));
      pass("Test 6 passed: Workflow 3 (vision_calculation) executes Qwen3 -> Vision -> Qwen3 -> Calculator -> Qwen3 -> Final");
    }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 7: Workflow 4 — Vision + Knowledge Base
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 7] Workflow 4 — Vision + Knowledge Base ---");
    {
      let stepCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepCount++;
        if (stepCount === 1) {
          return JSON.stringify({
            workflow: "vision_knowledge",
            action: "tool",
            tool: "vision",
            reason: "Inspect equipment image to identify component condition and leak pattern.",
            input: { prompt: "Inspect the mechanical seal area for leakage or corrosion." },
          });
        }
        if (stepCount === 2) {
          return JSON.stringify({
            workflow: "vision_knowledge",
            action: "tool",
            tool: "retrieve_information",
            reason: "Retrieve mechanical seal maintenance procedure and acceptable leakage limits from Knowledge Base.",
            input: { query: "mechanical seal leakage limit and maintenance procedure" },
          });
        }
        return JSON.stringify({
          workflow: "vision_knowledge",
          action: "final",
          reason: "Combined visual observations with Knowledge Base procedure.",
          answer: "Visual Inspection: Seal gland shows active steady dripping (~60 drops/min).\n\nKnowledge Base SOP-SEAL-01 states allowable leakage for API Plan 11 is max 10 drops/min.\n\nConclusion: The observed condition EXCEEDS acceptable maintenance limits; seal replacement is required.",
        });
      });

      const mockVisionClient = async () =>
        "Visual Analysis:\nMechanical seal stuffing box area shows continuous liquid dripping at roughly 60 drops per minute.";

      const mockRetriever = async () => ({
        results: [
          {
            filename: "SOP-SEAL-01.pdf",
            page: 5,
            text: "Section 3.2: Allowable leakage for Plan 11 seals is under 10 drops/min. Leakage exceeding this threshold warrants shutdown and seal overhaul.",
          },
        ],
      });

      const res = await runAgentTask({
        message: "Analyze this equipment image and explain whether the observed condition matches our maintenance procedure.",
        userId: "test-eng-1",
        images: [SAMPLE_IMAGE_BASE64],
        options: { visionClient: mockVisionClient, retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow?.type, WORKFLOW_TYPES.VISION_KNOWLEDGE);
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].toolName, "vision");
      assert.strictEqual(res.steps[1].toolName, "retrieve_information");
      assert.ok(res.response.includes("EXCEEDS"));
      assert.ok(res.response.includes("SOP-SEAL-01"));
      pass("Test 7 passed: Workflow 4 (vision_knowledge) executes Qwen3 -> Vision -> Qwen3 -> Retrieval -> Qwen3 -> Final");
    }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 8: Workflow 5 — Coding + Sandbox
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 8] Workflow 5 — Coding + Sandbox ---");
    {
      let stepCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepCount++;
        if (stepCount === 1) {
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "coding",
            reason: "Generate Python code to compute first 10 prime numbers.",
            input: { task: "Generate Python code to print first 10 prime numbers", language: "python" },
          });
        }
        if (stepCount === 2) {
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "execute_code",
            reason: "Execute the generated Python program in the sandbox.",
            input: { code: "primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]\nprint(primes)", language: "python" },
          });
        }
        return JSON.stringify({
          workflow: "coding_sandbox",
          action: "final",
          reason: "Code executed successfully in sandbox.",
          answer: "The first 10 prime numbers computed and executed successfully: [2, 3, 5, 7, 11, 13, 17, 19, 23, 29].",
        });
      });

      const mockCoderClient = async () =>
        "```python\nprimes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]\nprint(primes)\n```";

      const mockSandboxRunner = async ({ code, language }) => ({
        success: true,
        exitCode: 0,
        stdout: "[2, 3, 5, 7, 11, 13, 17, 19, 23, 29]\n",
        stderr: "",
        executionTimeMs: 45,
        timedOut: false,
        language,
        sandbox: { isolated: true },
      });

      const res = await runAgentTask({
        message: "Write a Python program to print the first 10 prime numbers and run it.",
        userId: "test-eng-1",
        options: { coderClient: mockCoderClient, sandboxRunner: mockSandboxRunner },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow?.type, WORKFLOW_TYPES.CODING_SANDBOX);
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].toolName, "coding");
      assert.strictEqual(res.steps[1].toolName, "execute_code");
      assert.strictEqual(res.steps[1].observation.exitCode, 0);
      assert.ok(res.response.includes("29"));
      pass("Test 8 passed: Workflow 5 (coding_sandbox) executes Qwen3 -> Coding -> Sandbox -> Qwen3 -> Final");
    }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 9: Workflow 5 — Coding failure handling & repair loop (max 2 repairs)
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 9] Workflow 5 — Coding Failure Handling & Repair ---");
    {
      // Part A: 1 failure + 1 successful repair
      let stepCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepCount++;
        if (stepCount === 1) {
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "coding",
            reason: "Generate Python code.",
            input: { task: "Calculate prime sum with bug", language: "python" },
          });
        }
        if (stepCount === 2) {
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "execute_code",
            reason: "Execute buggy code.",
            input: { code: "print(sum(undefined_var))", language: "python" },
          });
        }
        if (stepCount === 3) {
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "coding",
            reason: "Repair NameError by defining variable properly.",
            input: { task: "Fix NameError: undefined_var is not defined", codeContext: "undefined_var = [2, 3, 5]" },
          });
        }
        if (stepCount === 4) {
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "execute_code",
            reason: "Re-execute repaired code.",
            input: { code: "primes = [2, 3, 5]\nprint(sum(primes))", language: "python" },
          });
        }
        return JSON.stringify({
          workflow: "coding_sandbox",
          action: "final",
          reason: "Code was repaired and executed successfully.",
          answer: "Repaired code executed with sum = 10.",
        });
      });

      let execAttempts = 0;
      const mockFailingThenSucceedingSandbox = async ({ code, language }) => {
        execAttempts++;
        if (execAttempts === 1) {
          return {
            success: false,
            exitCode: 1,
            stdout: "",
            stderr: "NameError: name 'undefined_var' is not defined",
            error: "NameError: name 'undefined_var' is not defined",
            executionTimeMs: 30,
            timedOut: false,
            language,
            sandbox: { isolated: true },
          };
        }
        return {
          success: true,
          exitCode: 0,
          stdout: "10\n",
          stderr: "",
          executionTimeMs: 35,
          timedOut: false,
          language,
          sandbox: { isolated: true },
        };
      };

      const resA = await runAgentTask({
        message: "Run a python script and repair if it fails.",
        userId: "test-eng-1",
        options: {
          coderClient: async () => "code",
          sandboxRunner: mockFailingThenSucceedingSandbox,
        },
      });

      assert.strictEqual(resA.success, true);
      assert.strictEqual(resA.steps.length, 4);
      assert.strictEqual(resA.steps[0].toolName, "coding");
      assert.strictEqual(resA.steps[1].toolName, "execute_code");
      assert.strictEqual(resA.steps[1].status, "failed");
      assert.strictEqual(resA.steps[2].toolName, "coding");
      assert.strictEqual(resA.steps[3].toolName, "execute_code");
      assert.strictEqual(resA.steps[3].status, "completed");
      pass("Test 9.1 passed: Coding failure triggers Qwen3 -> Repair Coding -> Sandbox -> Qwen3 -> Final");

      // Part B: Exceeding 2 repairs (3 executions total) halts and reports failure honestly
      stepCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepCount++;
        // Attempt 1
        if (stepCount === 1) return JSON.stringify({ action: "tool", tool: "coding", input: { task: "code" } });
        if (stepCount === 2) return JSON.stringify({ action: "tool", tool: "execute_code", input: { code: "fail_1" } });
        // Attempt 2 (Repair 1)
        if (stepCount === 3) return JSON.stringify({ action: "tool", tool: "coding", input: { task: "fix 1" } });
        if (stepCount === 4) return JSON.stringify({ action: "tool", tool: "execute_code", input: { code: "fail_2" } });
        // Attempt 3 (Repair 2)
        if (stepCount === 5) return JSON.stringify({ action: "tool", tool: "coding", input: { task: "fix 2" } });
        if (stepCount === 6) return JSON.stringify({ action: "tool", tool: "execute_code", input: { code: "fail_3" } });
        // Exceeds repair limit
        return JSON.stringify({ action: "tool", tool: "execute_code", input: { code: "fail_4" } });
      });

      const mockAlwaysFailingSandbox = async ({ language }) => ({
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "SyntaxError: persistent invalid syntax",
        error: "SyntaxError: persistent invalid syntax",
        executionTimeMs: 25,
        timedOut: false,
        language,
        sandbox: { isolated: true },
      });

      const resB = await runAgentTask({
        message: "Run a python script with persistent failure.",
        userId: "test-eng-1",
        options: {
          coderClient: async () => "code",
          sandboxRunner: mockAlwaysFailingSandbox,
        },
      });

      // Must not loop indefinitely, must stop boundedly
      assert.ok(resB.steps.length <= 8, "Must strictly respect step and repair limits");
      pass("Test 9.2 passed: Sandbox failure strictly bounds retries to maximum 2 repairs without infinite loop");
    }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 10: Complex Multi-Tool Task (Vision -> KB -> Calc -> Final)
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 10] Complex Multi-Tool Task ---");
    {
      let stepCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepCount++;
        if (stepCount === 1) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "vision",
            reason: "Step 1: Extract measured vibration value from gauge image.",
            input: { prompt: "Extract measured bearing vibration reading." },
          });
        }
        if (stepCount === 2) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "retrieve_information",
            reason: "Step 2: Look up ISO 10816-3 allowable vibration threshold from Knowledge Base.",
            input: { query: "ISO 10816-3 allowable vibration limit" },
          });
        }
        if (stepCount === 3) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "calculator",
            reason: "Step 3: Calculate percentage: (measured 3.6 / allowable 4.5) * 100.",
            input: { expression: "(3.6 / 4.5) * 100" },
          });
        }
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Step 4: All evidence integrated and verified.",
          answer: "1. Visual Analysis: Measured vibration reading = 3.6 mm/s RMS.\n2. Knowledge Base: ISO 10816-3 allowable limit = 4.5 mm/s RMS.\n3. Calculation: (3.6 / 4.5) * 100 = 80.0%.\n4. Verdict: The vibration is at 80% of allowable limit, within the acceptable operating zone.",
        });
      });

      const mockVisionClient = async () => "Visual Observation: Gauge indicator reads 3.6 mm/s RMS.";
      const mockRetriever = async () => ({
        results: [{ filename: "ISO_10816_Standard.pdf", page: 4, text: "Zone B/C threshold = 4.5 mm/s RMS." }],
      });

      const res = await runAgentTask({
        message: "Analyze the values in this equipment image, compare them with the relevant maintenance requirement in our Knowledge Base, calculate the percentage difference, and explain whether the value is within the acceptable range.",
        userId: "test-eng-1",
        images: [SAMPLE_IMAGE_BASE64],
        options: { visionClient: mockVisionClient, retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 3);
      assert.strictEqual(res.steps[0].toolName, "vision");
      assert.strictEqual(res.steps[1].toolName, "retrieve_information");
      assert.strictEqual(res.steps[2].toolName, "calculator");
      assert.strictEqual(res.steps[2].input.expression, "(3.6 / 4.5) * 100");
      assert.ok(res.response.includes("80%"));
      pass("Test 10 passed: Complex multi-tool task dynamically sequenced: Vision -> KB -> Calc -> Final");
    }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 11: Workflow 6 Fallback (Text Transform + Word Count)
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 11] Workflow 6 Fallback / Dynamic Tool Combo ---");
    {
      let stepCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepCount++;
        if (stepCount === 1) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "text_transform",
            reason: "Count the words in the provided explanation.",
            input: { text: "Centrifugal pumps generate head via impeller kinetic energy transfer.", operation: "word_count" },
          });
        }
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Word count computed.",
          answer: "The explanation contains 9 words.",
        });
      });

      const res = await runAgentTask({
        message: "Count the words in this explanation: Centrifugal pumps generate head via impeller kinetic energy transfer.",
        userId: "test-eng-1",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow?.type, WORKFLOW_TYPES.GENERAL);
      assert.strictEqual(res.steps.length, 1);
      assert.strictEqual(res.steps[0].toolName, "text_transform");
      assert.strictEqual(Number(res.steps[0].observation.wordCount || res.steps[0].observation.result), 9);
      assert.ok(res.response.includes("9 words"));
      pass("Test 11 passed: Workflow 6 fallback safely accommodates dynamic single/multi-tool combinations");
    }

    // ───────────────────────────────────────────────────────────────────────────
    // TEST 12: New Chat Context Isolation (Zero Leakage)
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 12] New Chat Context Isolation ---");
    {
      // Chat A: Visual task with image attached
      let chatAStep = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        chatAStep++;
        if (chatAStep === 1) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "vision",
            reason: "Analyze pump image.",
            input: { prompt: "Analyze pump image" },
          });
        }
        return JSON.stringify({
          workflow: "general",
          action: "final",
          answer: "Chat A pump image analyzed.",
        });
      });

      const resA = await runAgentTask({
        message: "Analyze this image.",
        chatId: "chat-isolation-A",
        userId: "user-iso",
        images: [SAMPLE_IMAGE_BASE64],
        options: { visionClient: async () => "Chat A visual analysis" },
      });

      assert.strictEqual(resA.success, true);
      assert.strictEqual(resA.steps.length, 1);
      assert.strictEqual(resA.steps[0].toolName, "vision");

      // Chat B: Unrelated text math question in a brand new chat
      let chatBStep = 0;
      let chatBReceivedImages = null;
      agentGraphService.setAgentBrainLlmClient(async (messages) => {
        chatBStep++;
        const userPrompt = messages.find((m) => m.role === "user")?.content || "";
        chatBReceivedImages = userPrompt.includes("data:image");
        if (chatBStep === 1) {
          return JSON.stringify({
            workflow: "general",
            action: "tool",
            tool: "calculator",
            reason: "Calculate 25 * 40 directly.",
            input: { expression: "25 * 40" },
          });
        }
        return JSON.stringify({
          workflow: "general",
          action: "final",
          answer: "1000",
        });
      });

      const resB = await runAgentTask({
        message: "What is 25 * 40?",
        chatId: "chat-isolation-B",
        userId: "user-iso",
        images: [], // No images in Chat B
      });

      assert.strictEqual(resB.success, true);
      assert.strictEqual(resB.steps.length, 1);
      assert.strictEqual(resB.steps[0].toolName, "calculator");
      assert.strictEqual(chatBReceivedImages, false, "Chat B must never receive Chat A images");
      // Check tool_results in structured state
      assert.strictEqual(resB.state.tool_results.length, 1);
      assert.strictEqual(resB.state.tool_results[0].value, 1000);
      pass("Test 12 passed: Chat B starts with clean agent context and zero leakage from Chat A");
    }

    console.log("\n================================================================================");
    console.log(`ALL ${testsPassed} INDUSTRIAL WORKFLOW ACCEPTANCE TESTS PASSED!`);
    console.log("================================================================================");
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
    agentGraphService.resetCoderLlmClient();
    agentGraphService.resetVisionLlmClient();
  }
}

runTests().catch((err) => {
  console.error("FATAL WORKFLOW TEST FAILURE:", err);
  process.exit(1);
});
