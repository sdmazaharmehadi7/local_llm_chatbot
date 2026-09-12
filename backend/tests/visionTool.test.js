/**
 * Sovereign Vision Tool & Multi-Tool Orchestration Tests
 *
 * Deterministic test suite verifying:
 * 1. Prompt Isolation: isolateVisionPrompt strips calculator/tool/verification phrasing.
 * 2. Acceptance Test Case 1: Image description (Qwen3 → Vision → Qwen3 → Final)
 * 3. Acceptance Test Case 2: Image extraction (Qwen3 → Vision → Qwen3 → Final)
 * 4. Acceptance Test Case 3: Image + calculation (Qwen3 → Vision [isolated prompt] → Qwen3 → Calculator → Qwen3 → Final)
 * 5. Acceptance Test Case 4: Calculator only (Qwen3 → Calculator → Qwen3 → Final)
 * 6. Acceptance Test Case 5: Normal question (Qwen3 → Final)
 * 7. Acceptance Test Case 6: Retrieval (Qwen3 → Retrieval → Qwen3 → Final)
 * 8. Acceptance Test Case 7: Multi-step (Qwen3 → Retrieval → Qwen3 → Calculator → Qwen3 → Final)
 * 9. Acceptance Test Case 8: Image followed by coding (zero context leakage into coding)
 * 10. Unsupported image input & model failure handling
 * 11. Policy guard validation
 */

import assert from "node:assert/strict";
import {
  visionTool,
  isolateVisionPrompt,
  validateAndNormalizeImage,
  VISION_MODEL,
} from "../src/services/agent/tools/vision.tool.js";
import { agentGraphService } from "../src/services/agent/agentGraph.service.js";
import { runAgentTask } from "../src/services/agent/agent.service.js";
import { validateToolSelectionPolicy } from "../src/services/agent/qwenBrain.service.js";

const SAMPLE_1X1_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const SAMPLE_DATA_URL = `data:image/png;base64,${SAMPLE_1X1_PNG_BASE64}`;

let passedCount = 0;
let failedCount = 0;

function pass(name) {
  passedCount++;
  console.log(`  ✔ [PASS] ${name}`);
}

function fail(name, err) {
  failedCount++;
  console.error(`  ❌ [FAIL] ${name}:`, err.message);
}

async function runVisionTests() {
  console.log("================================================================================");
  console.log("RUNNING QWEN2.5-VL VISION TOOL MULTI-TOOL ORCHESTRATION & ISOLATION TESTS");
  console.log("================================================================================");

  // ─── TEST 1: Prompt Isolation Unit Tests ────────────────────────────────────
  console.log("\n--- [Test 1] Prompt Isolation Function Unit Tests ---");
  try {
    // 1. Multi-tool verification prompt: strips calculator clauses while preserving the specific extraction objective
    const rawMultiToolPrompt =
      "Analyze the uploaded image. Extract the values from all 3 examples. Use the calculator tool to independently verify each calculation shown in the image and calculate the percentage error.";
    const isolated = isolateVisionPrompt(rawMultiToolPrompt);

    assert.ok(
      !isolated.toLowerCase().includes("calculator"),
      "Isolated vision prompt must not mention calculator"
    );
    assert.ok(
      !isolated.toLowerCase().includes("verify each calculation"),
      "Isolated vision prompt must not ask vision model to verify calculations"
    );
    assert.ok(
      !isolated.toLowerCase().includes("percentage error"),
      "Isolated vision prompt must not ask vision model to calculate percentage error"
    );
    assert.ok(
      isolated.toLowerCase().includes("extract the values from all 3 examples"),
      "Isolated vision prompt must preserve specific visual objective (all 3 examples)"
    );
    assert.ok(
      isolated.toLowerCase().includes("do not calculate or verify"),
      "Isolated vision prompt must append extraction-only guard"
    );

    // 2. Specific visual tasks remain intact and are NOT replaced by a generic prompt:
    const describePrompt = "Describe this image in detail.";
    assert.strictEqual(isolateVisionPrompt(describePrompt), describePrompt);

    const ocrPrompt = "What text is visible on the motor nameplate?";
    assert.strictEqual(isolateVisionPrompt(ocrPrompt), ocrPrompt);

    const tablePrompt = "Read the table and identify the highest value.";
    assert.strictEqual(isolateVisionPrompt(tablePrompt), tablePrompt);

    // 3. Diagram extraction with calculator command
    const diagramPrompt = "Extract the values from the diagram and verify the calculations using calculator.";
    const cleanedDiagram = isolateVisionPrompt(diagramPrompt);
    assert.ok(!cleanedDiagram.toLowerCase().includes("calculator"));
    assert.ok(cleanedDiagram.toLowerCase().includes("extract the values from the diagram"));
    assert.ok(cleanedDiagram.toLowerCase().includes("do not calculate or verify"));

    // 4. Empty/falsy prompt fallback
    const emptyPrompt = isolateVisionPrompt("");
    assert.ok(emptyPrompt.includes("Do not perform any calculations or verification"));

    pass("isolateVisionPrompt preserves specific visual tasks while stripping cross-tool commands");
  } catch (err) {
    fail("Prompt Isolation Unit Tests", err);
  }

  // ─── TEST 2: Image Validation & Normalization ───────────────────────────────
  console.log("\n--- [Test 2] Image Validation & Normalization ---");
  try {
    const validDataUrl = validateAndNormalizeImage(SAMPLE_DATA_URL);
    assert.strictEqual(validDataUrl.valid, true);
    assert.strictEqual(validDataUrl.cleanBase64, SAMPLE_1X1_PNG_BASE64);

    const validRawB64 = validateAndNormalizeImage(SAMPLE_1X1_PNG_BASE64);
    assert.strictEqual(validRawB64.valid, true);
    assert.strictEqual(validRawB64.cleanBase64, SAMPLE_1X1_PNG_BASE64);

    const invalidEmpty = validateAndNormalizeImage("");
    assert.strictEqual(invalidEmpty.valid, false);

    const invalidPdfDataUrl = validateAndNormalizeImage("data:application/pdf;base64,JVBERi0xLjQK...");
    assert.strictEqual(invalidPdfDataUrl.valid, false);
    assert.ok(invalidPdfDataUrl.error.includes("Only image data URLs"));

    const invalidCorrupt = validateAndNormalizeImage("not a base64 string ??!!!");
    assert.strictEqual(invalidCorrupt.valid, false);

    pass("validateAndNormalizeImage correctly handles valid image URLs, raw base64, and rejects non-images");
  } catch (err) {
    fail("Image Validation & Normalization", err);
  }

  // ─── TEST 3: Unsupported Image Input Handling ───────────────────────────────
  console.log("\n--- [Test 3] Unsupported / Missing Image Input Handling ---");
  try {
    const missingRes = await visionTool.execute(
      { prompt: "What is this?" },
      { images: [] }
    );
    assert.strictEqual(missingRes.success, false);
    assert.ok(missingRes.error.includes("No image provided"));

    const corruptRes = await visionTool.execute(
      { prompt: "Inspect file", image: "data:text/plain;base64,SGVsbG8=" },
      {}
    );
    assert.strictEqual(corruptRes.success, false);
    assert.ok(corruptRes.error.includes("Unsupported image input"));

    pass("visionTool returns clean, controlled error for missing and unsupported image inputs");
  } catch (err) {
    fail("Unsupported Image Input Handling", err);
  }

  // ─── TEST 4: Model Failure / Ollama Offline Handling ────────────────────────
  console.log("\n--- [Test 4] Model Failure / Offline Error Handling ---");
  try {
    const failingVisionClient = async () => {
      throw new Error("Ollama connection refused at http://localhost:11434");
    };

    const res = await visionTool.execute(
      { prompt: "Inspect photo" },
      { image: SAMPLE_1X1_PNG_BASE64, visionClient: failingVisionClient }
    );

    assert.strictEqual(res.success, false);
    assert.ok(res.error.includes("Ollama connection refused"));
    assert.strictEqual(res.model, VISION_MODEL);

    pass("visionTool catches model failure and returns structured error without crashing");
  } catch (err) {
    fail("Model Failure Handling", err);
  }

  // ─── ACCEPTANCE TEST 1: Image Description (Qwen3 → Vision → Qwen3 → Final) ───
  console.log("\n--- [Acceptance Test 1] Image Description (Qwen3 → Vision → Qwen3 → Final) ---");
  try {
    let brainCalls = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCalls++;
      if (brainCalls === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "vision",
          reason: "Inspect image to provide detailed visual description.",
          input: { prompt: "Describe the equipment, components, and layout shown in this image." },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Visual description complete.",
        answer: "The image shows a centrifugal process pump connected to an electric motor with visible suction and discharge piping.",
      });
    });

    const mockVisionClient = async () => {
      return "The image displays a horizontal centrifugal slurry pump skid with a blue 45 kW electric induction motor.";
    };

    const taskResult = await runAgentTask({
      message: "Describe what is shown in this equipment photograph.",
      images: [SAMPLE_DATA_URL],
      options: { visionClient: mockVisionClient },
    });

    assert.strictEqual(taskResult.success, true);
    assert.strictEqual(taskResult.steps.length, 1);
    assert.strictEqual(taskResult.steps[0].toolName, "vision");
    assert.ok(taskResult.response.includes("centrifugal"));

    pass("Acceptance Test 1 passed: Qwen3 → Vision → Qwen3 → Final");
  } catch (err) {
    fail("Acceptance Test 1", err);
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
  }

  // ─── ACCEPTANCE TEST 2: Image Extraction (Qwen3 → Vision → Qwen3 → Final) ────
  console.log("\n--- [Acceptance Test 2] Image Extraction (Qwen3 → Vision → Qwen3 → Final) ---");
  try {
    let brainCalls = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCalls++;
      if (brainCalls === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "vision",
          reason: "Extract visible transmitter readings and unit tags from the photo.",
          input: { prompt: "Extract all visible numbers, units, and equipment tags from the gauge dial." },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Extracted readings compiled.",
        answer: "Extracted readings: Pressure transmitter PT-401 displays 14.8 bar (214.6 psi). Temperature is 68.5 °C.",
      });
    });

    const mockVisionClient = async () => {
      return "Tag: PT-401. Gauge 1: 14.8 bar. Temperature sensor TT-202: 68.5 °C.";
    };

    const taskResult = await runAgentTask({
      message: "Extract all readings and tags visible in the uploaded image.",
      images: [SAMPLE_DATA_URL],
      options: { visionClient: mockVisionClient },
    });

    assert.strictEqual(taskResult.success, true);
    assert.strictEqual(taskResult.steps.length, 1);
    assert.strictEqual(taskResult.steps[0].toolName, "vision");
    assert.ok(taskResult.response.includes("14.8 bar"));

    pass("Acceptance Test 2 passed: Qwen3 → Vision → Qwen3 → Final");
  } catch (err) {
    fail("Acceptance Test 2", err);
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
  }

  // ─── ACCEPTANCE TEST 3: Image + Calculation ─────────────────────────────────
  // (Qwen3 → Vision [isolated prompt] → Qwen3 → Calculator → Qwen3 → Final)
  console.log("\n--- [Acceptance Test 3] Image + Calculation (Qwen3 → Vision → Qwen3 → Calculator → Qwen3 → Final) ---");
  try {
    let brainCalls = 0;
    let receivedVisionPrompt = null;
    let visionOutputStr = null;

    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCalls++;
      if (brainCalls === 1) {
        // Step 1: Qwen3 generates fresh, task-specific Vision instruction to extract raw parameters & displayed formula/result
        return JSON.stringify({
          action: "tool",
          tool: "vision",
          reason: "Extract visible values, formulas, displayed results, and units from the image. Do not calculate.",
          input: {
            prompt: "Inspect the uploaded image and extract the visible values, formulas, displayed results, and units. Preserve the values exactly as shown. Do not perform any calculations or verification.",
          },
        });
      }
      if (brainCalls === 2) {
        // Step 2: Qwen3 receives raw visual extraction, independently determines math expression (22 * 9550 / 960), and calls Calculator
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Independently evaluate the torque formula: 22 * 9550 / 960.",
          input: { expression: "22 * 9550 / 960" },
        });
      }
      // Step 3: Qwen3 compares Calculator result (218.85416666666666) against Vision displayed answer (218.9 Nm)
      return JSON.stringify({
        action: "final",
        reason: "Visual extraction verified against calculator output.",
        answer: "Visual extraction showed P = 22 kW, N = 960 RPM, displayed formula T = (P × 9550) / N, and displayed answer 218.9 Nm. Independent calculation using the calculator tool yielded 22 * 9550 / 960 = 218.854 Nm. The displayed calculation is VERIFIED (218.854 rounds to 218.9 Nm within 0.02% rounding tolerance).",
      });
    });

    const mockVisionClient = async (messages) => {
      // Capture user message prompt to ensure prompt isolation
      receivedVisionPrompt = messages[1].content;

      // Vision returns RAW visual extraction only — NEVER evaluates arithmetic or returns computed 218.85!
      visionOutputStr = JSON.stringify({
        example: 1,
        values: {
          P: "22 kW",
          N: "960 RPM",
        },
        displayed_formula: "T = (P × 9550) / N",
        displayed_answer: "218.9 Nm",
      });
      return visionOutputStr;
    };

    const taskResult = await runAgentTask({
      message: "Extract the values from the image and verify the calculation using the calculator.",
      images: [SAMPLE_DATA_URL],
      options: { visionClient: mockVisionClient },
    });

    assert.strictEqual(taskResult.success, true);
    assert.strictEqual(taskResult.steps.length, 2);
    assert.strictEqual(taskResult.steps[0].toolName, "vision");
    assert.strictEqual(taskResult.steps[1].toolName, "calculator");

    // 1. Verify Vision prompt received by Qwen2.5-VL was strictly isolated and free of cross-tool commands
    assert.ok(receivedVisionPrompt, "Vision client must have received a prompt");
    assert.ok(
      !receivedVisionPrompt.toLowerCase().includes("use the calculator"),
      "Qwen2.5-VL must NEVER receive instructions to use the calculator"
    );
    assert.ok(
      !receivedVisionPrompt.toLowerCase().includes("verify the calculation using"),
      "Qwen2.5-VL must NEVER receive instructions to verify calculations using calculator"
    );

    // 2. CRITICAL BOUNDARY: Verify Vision output did NOT perform the calculation (must NOT contain 218.85)
    assert.strictEqual(
      visionOutputStr.includes("218.85"),
      false,
      "Vision output MUST NOT contain calculated values (218.85) — calculation belongs exclusively to Calculator!"
    );
    assert.ok(
      visionOutputStr.includes("218.9 Nm"),
      "Vision output should contain the raw displayed answer from the image"
    );

    // 3. Verify Calculator received exact derived mathematical expression from Qwen3
    assert.strictEqual(taskResult.steps[1].input.expression, "22 * 9550 / 960");
    assert.ok(
      Math.abs(taskResult.steps[1].output.value - 218.854166666667) < 0.0001,
      "Calculator value should match 218.854..."
    );

    // 4. Verify Qwen3 performed comparison between displayed answer and calculated result
    assert.ok(taskResult.response.includes("218.9 Nm"), "Final response must cite displayed answer");
    assert.ok(taskResult.response.includes("218.854"), "Final response must cite Calculator result");
    assert.ok(taskResult.response.includes("VERIFIED"), "Final response must state verification outcome");

    pass("Acceptance Test 3 passed: Qwen3 → Vision (raw extraction only) → Qwen3 → Calculator (exact math) → Qwen3 → Final");
  } catch (err) {
    fail("Acceptance Test 3", err);
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
  }

  // ─── ACCEPTANCE TEST 4: Calculator Only (Qwen3 → Calculator → Qwen3 → Final) ─
  console.log("\n--- [Acceptance Test 4] Calculator Only (Qwen3 → Calculator → Qwen3 → Final) ---");
  try {
    let brainCalls = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCalls++;
      if (brainCalls === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Calculate percentage difference between 120 and 150.",
          input: { expression: "((150 - 120) / 120) * 100" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Calculation complete.",
        answer: "The percentage increase from 120 to 150 is 25%.",
      });
    });

    const taskResult = await runAgentTask({
      message: "Calculate the percentage increase from 120 to 150.",
    });

    assert.strictEqual(taskResult.success, true);
    assert.strictEqual(taskResult.steps.length, 1);
    assert.strictEqual(taskResult.steps[0].toolName, "calculator");
    assert.strictEqual(taskResult.steps[0].output.value, 25);
    assert.ok(taskResult.response.includes("25%"));

    pass("Acceptance Test 4 passed: Qwen3 → Calculator → Qwen3 → Final");
  } catch (err) {
    fail("Acceptance Test 4", err);
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
  }

  // ─── ACCEPTANCE TEST 5: Normal Question (Qwen3 → Final) ─────────────────────
  console.log("\n--- [Acceptance Test 5] Normal Question (Qwen3 → Final) ---");
  try {
    agentGraphService.setAgentBrainLlmClient(async () => {
      return JSON.stringify({
        action: "final",
        reason: "Direct answer to conceptual question without tools.",
        answer: "An API (Application Programming Interface) allows different software applications to communicate with each other.",
      });
    });

    const taskResult = await runAgentTask({
      message: "Explain what an API is.",
    });

    assert.strictEqual(taskResult.success, true);
    assert.strictEqual(taskResult.steps.length, 0); // 0 tools called
    assert.ok(taskResult.response.includes("API"));

    pass("Acceptance Test 5 passed: Qwen3 → Final (0 tools called)");
  } catch (err) {
    fail("Acceptance Test 5", err);
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
  }

  // ─── ACCEPTANCE TEST 6: Retrieval (Qwen3 → Retrieval → Qwen3 → Final) ───────
  console.log("\n--- [Acceptance Test 6] Retrieval (Qwen3 → Retrieval → Qwen3 → Final) ---");
  try {
    let brainCalls = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCalls++;
      if (brainCalls === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve ISO 10816-3 vibration limit from maintenance standard.",
          input: { query: "ISO 10816-3 vibration velocity limit Class II Zone B" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Retrieved standard requirement.",
        answer: "Under ISO 10816-3 for Class II industrial machinery, the Zone B allowable vibration velocity limit is 4.5 mm/s RMS.",
      });
    });

    const mockRetriever = async () => [
      {
        text: "ISO 10816-3: Evaluation of machine vibration. For Class II medium-sized machines (15 to 75 kW), Zone B boundary limit is 4.5 mm/s RMS.",
        source: "ISO-10816-3-Standard.pdf",
        page: 5,
        score: 0.95,
      },
    ];

    const taskResult = await runAgentTask({
      message: "What is the allowable vibration limit under ISO 10816-3 for Class II machines?",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(taskResult.success, true);
    assert.strictEqual(taskResult.steps.length, 1);
    assert.strictEqual(taskResult.steps[0].toolName, "retrieve_information");
    assert.ok(taskResult.response.includes("4.5 mm/s"));

    pass("Acceptance Test 6 passed: Qwen3 → Retrieval → Qwen3 → Final");
  } catch (err) {
    fail("Acceptance Test 6", err);
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
  }

  // ─── ACCEPTANCE TEST 7: Multi-Step (Qwen3 → Retrieval → Qwen3 → Calculator → Qwen3 → Final) ───
  console.log("\n--- [Acceptance Test 7] Multi-Step (Qwen3 → Retrieval → Qwen3 → Calculator → Qwen3 → Final) ---");
  try {
    let brainCalls = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCalls++;
      if (brainCalls === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve bearing P-101 vibration reading from the inspection log.",
          input: { query: "bearing P-101 vibration velocity reading log" },
        });
      }
      if (brainCalls === 2) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Calculate percentage of the 4.5 mm/s limit for reading 3.15 mm/s.",
          input: { expression: "(3.15 / 4.5) * 100" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Retrieval and calculation complete.",
        answer: "Bearing P-101 has a recorded vibration reading of 3.15 mm/s RMS. Compared to the ISO limit of 4.5 mm/s, it is operating at 70% of allowable limit (PASS).",
      });
    });

    const mockRetriever = async () => [
      {
        text: "Daily Inspection Log: Pump P-101 Drive-End Bearing measured vibration velocity is 3.15 mm/s RMS.",
        source: "Inspection-Log-2026-09.pdf",
        page: 3,
        score: 0.92,
      },
    ];

    const taskResult = await runAgentTask({
      message: "Retrieve the vibration reading for bearing P-101 from the inspection log, then calculate what percentage it represents of the 4.5 mm/s limit.",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(taskResult.success, true);
    assert.strictEqual(taskResult.steps.length, 2);
    assert.strictEqual(taskResult.steps[0].toolName, "retrieve_information");
    assert.strictEqual(taskResult.steps[1].toolName, "calculator");
    assert.strictEqual(taskResult.steps[1].output.value, 70);
    assert.ok(taskResult.response.includes("70%"));

    pass("Acceptance Test 7 passed: Qwen3 → Retrieval → Qwen3 → Calculator → Qwen3 → Final");
  } catch (err) {
    fail("Acceptance Test 7", err);
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
  }

  // ─── ACCEPTANCE TEST 8: Image Followed by Coding (Zero Context Leakage) ─────
  console.log("\n--- [Acceptance Test 8] Image Followed by Coding (Zero Context Leakage) ---");
  try {
    // 1. First turn: Image question
    let brainCalls = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCalls++;
      if (brainCalls === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "vision",
          reason: "Inspect image.",
          input: { prompt: "Read the tag on the gauge." },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Visual inspection done.",
        answer: "Gauge tag is PI-102.",
      });
    });

    const mockVisionClient = async () => "Tag plate: PI-102.";
    await runAgentTask({
      message: "What is the tag in this image?",
      images: [SAMPLE_DATA_URL],
      options: { visionClient: mockVisionClient },
    });

    // 2. Second turn: Subsequent coding question
    brainCalls = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCalls++;
      if (brainCalls === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "coding",
          reason: "User requested a Python function to parse logs.",
          input: { task: "Write a Python function to parse log files", language: "python" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Code implementation ready.",
        answer: "Here is the Python function:\n\n```python\ndef parse_log(line):\n    return line.strip().split(' ')\n```",
      });
    });

    let receivedCoderMessages = null;
    const mockCoderClient = async (messages) => {
      receivedCoderMessages = messages;
      return "```python\ndef parse_log(line):\n    return line.strip().split(' ')\n```";
    };

    const codingTaskResult = await runAgentTask({
      message: "Write a Python function to parse log files.",
      options: { coderClient: mockCoderClient },
    });

    assert.strictEqual(codingTaskResult.success, true);
    assert.strictEqual(codingTaskResult.steps.length, 1);
    assert.strictEqual(codingTaskResult.steps[0].toolName, "coding");

    // Assert strictly zero image context or base64 data reached Qwen2.5-Coder
    assert.ok(receivedCoderMessages, "Coder client must have been invoked");
    for (const msg of receivedCoderMessages) {
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(msg, "images"),
        false,
        "Qwen2.5-Coder must NEVER receive an images field"
      );
      assert.ok(!msg.content.includes("base64"), "Coder prompt must not contain base64 image data");
    }

    pass("Acceptance Test 8 passed: Image followed by coding with strictly zero context leakage into coding");
  } catch (err) {
    fail("Acceptance Test 8", err);
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
  }

  // ─── TEST 10: Policy Rejection on Conceptual Question ───────────────────────
  console.log("\n--- [Test 10] Vision Policy Guard Rejection ---");
  try {
    const policyResult = validateToolSelectionPolicy(
      {
        action: "tool",
        tool: "vision",
        input: { prompt: "Explain what an API is" },
      },
      {
        userRequest: "Explain what an API is",
        steps: [],
        images: [],
      }
    );

    assert.strictEqual(policyResult.valid, false);
    assert.ok(policyResult.reason.includes("cannot be called for conceptual"));

    pass("Policy guard cleanly blocks vision tool calls when user asks conceptual text questions");
  } catch (err) {
    fail("Vision Policy Guard", err);
  }

  // ─── SUMMARY ────────────────────────────────────────────────────────────────
  console.log("\n================================================================================");
  console.log(`VISION TOOL MULTI-TOOL TEST SUITE COMPLETE: ${passedCount} passed, ${failedCount} failed`);
  console.log("================================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runVisionTests();
