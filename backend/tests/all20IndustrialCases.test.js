/**
 * Comprehensive Acceptance Test Suite: All 20 Industrial Test Cases
 *
 * Validates:
 * 1. KNOWLEDGE_RETRIEVAL (SOP-PRV-114 overhaul periods & test form)
 * 2. RETRIEVAL_CALCULATION (C-301 purchase note daily loss & recovery days)
 * 3. VISION_CALCULATION (gauge image inspection + torque calculation)
 * 4. VISION_KNOWLEDGE (image inspection + SOP manual retrieval)
 * 5. CODING_SANDBOX (Reynolds number Python script generation + execution)
 * 6. ENGINEERING (100 psi & 2 bar unit conversion + differential calculation)
 * 7. GENERAL (Cavitation conceptual explanation with 0 tools)
 * 8. DOCUMENT_ANALYSIS (Uploaded procedure safety equipment & LOTO directly)
 * 9. DATA_ANALYSIS (Sensor readings statistics & trend analysis)
 * 10. COMPLIANCE_CHECK (ENG-PMP-014 vibration 5.1 mm/s limit check)
 * 11. MULTI_STEP_ANALYSIS (Vision + Retrieval + Formula + Threshold check)
 * 12. EDGE CASE: Missing threshold safe refusal (142°C discharge temp)
 * 13. EDGE CASE: Incompatible units controlled error (15 bar -> kg)
 * 14. EDGE CASE: Cross-document synthesis (ENG-PMP-014 + SAF-PMP-001)
 * 15. EDGE CASE: Document analysis + engineering calculation (2.8 mm -> 2.1 mm = 25%)
 * 16. EDGE CASE: Division by zero safety (input = 0 efficiency)
 * 17. EDGE CASE: Coding sandbox execution
 * 18. EDGE CASE: Stable trend with tolerance (100.0, 100.2, ... tolerance 1.0% = STABLE)
 * 19. EDGE CASE: Duplicate retrieval protection (single focused retrieval)
 * 20. EDGE CASE: Cross-chat context isolation (Chat A vs Chat B)
 */

import assert from "assert";
import { runAgentTask } from "../src/services/agent/agent.service.js";
import { agentGraphService } from "../src/services/agent/agentGraph.service.js";
import { WORKFLOW_TYPES } from "../src/services/agent/agent.types.js";
import { classifyInitialWorkflow } from "../src/services/agent/qwenBrain.service.js";

console.log("================================================================================");
console.log("STARTING ALL 20 INDUSTRIAL TEST CASES ACCEPTANCE TEST SUITE");
console.log("================================================================================");

let testCount = 0;
let passCount = 0;

function pass(name) {
  testCount++;
  passCount++;
  console.log(`✔ [PASS ${testCount}/20] ${name}`);
}

const SAMPLE_IMAGE_BASE64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function runAll20Cases() {
  try {
    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: KNOWLEDGE_RETRIEVAL
    // Query: SOP-PRV-114 overhaul periods & test form
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 1] KNOWLEDGE_RETRIEVAL ---");
    {
      const initialWf = classifyInitialWorkflow({
        userRequest: "According to SOP-PRV-114, what are the overhaul periods and test form numbers for pressure relief valves?",
      });
      assert.strictEqual(initialWf, WORKFLOW_TYPES.KNOWLEDGE_RETRIEVAL);

      let stepNum = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "knowledge_retrieval",
            action: "tool",
            tool: "retrieve_information",
            reason: "Retrieve overhaul periods and test form from SOP-PRV-114.",
            input: { query: "SOP-PRV-114 overhaul period test form" },
          });
        }
        return JSON.stringify({
          workflow: "knowledge_retrieval",
          action: "final",
          reason: "Evidence gathered.",
          answer: "According to SOP-PRV-114, routine overhaul is required every 48 months for clean service and 24 months for sour service. Test results must be logged on Form KVI-F-221.",
        });
      });

      const res = await runAgentTask({
        message: "According to SOP-PRV-114, what are the overhaul periods and test form numbers for pressure relief valves?",
        userId: "test-user-1",
        options: {
          retriever: async () => ({
            success: true,
            content: "SOP-PRV-114: Overhaul period is 48 months for clean service, 24 months for corrosive service. Form KVI-F-221.",
            results: [{ filename: "SOP-PRV-114.pdf", page: 2, text: "Overhaul period 48 months and 24 months. Form KVI-F-221." }],
          }),
        },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "knowledge_retrieval");
      assert.ok(res.response.includes("48 months"));
      assert.ok(res.response.includes("24 months"));
      assert.ok(res.response.includes("KVI-F-221"));
      pass("Test 1: KNOWLEDGE_RETRIEVAL successfully routed and retrieved required facts");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: RETRIEVAL_CALCULATION
    // Query: C-301 purchase note daily loss and days to recover 1.84 crore
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 2] RETRIEVAL_CALCULATION ---");
    {
      const initialWf = classifyInitialWorkflow({
        userRequest: "From the Malabar Industrial Fabricators purchase note for compressor C-301, what is the estimated daily production loss and how many days does it take to recover ₹1.84 crore?",
      });
      assert.strictEqual(initialWf, WORKFLOW_TYPES.RETRIEVAL_CALCULATION);

      let stepNum = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "retrieval_calculation",
            action: "tool",
            tool: "retrieve_information",
            reason: "Retrieve daily loss and cost details from C-301 purchase note.",
            input: { query: "compressor C-301 daily production loss purchase note" },
          });
        }
        if (stepNum === 2) {
          return JSON.stringify({
            workflow: "retrieval_calculation",
            action: "tool",
            tool: "calculator",
            reason: "Compute payback period: 18400000 / 1400000.",
            input: { expression: "18400000 / 1400000" },
          });
        }
        return JSON.stringify({
          workflow: "retrieval_calculation",
          action: "final",
          reason: "Calculation verified.",
          answer: "The estimated daily production loss is ₹14,00,000. At this rate, recovering ₹1.84 crore (₹1,84,00,000) takes approximately 13.14 days (18,400,000 / 1,400,000 = 13.142857 days).",
        });
      });

      const res = await runAgentTask({
        message: "From the Malabar Industrial Fabricators purchase note for compressor C-301, what is the estimated daily production loss and how many days does it take to recover ₹1.84 crore?",
        userId: "test-user-2",
        options: {
          retriever: async () => ({
            success: true,
            content: "Purchase Note C-301: Estimated daily production loss during outage is ₹14,00,000. Total capital overhaul is ₹1,84,00,000.",
            results: [{ filename: "C-301_Purchase_Note.pdf", page: 1, text: "Daily loss: 1400000. Capital cost: 18400000." }],
          }),
        },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "retrieval_calculation");
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].toolName, "retrieve_information");
      assert.strictEqual(res.steps[1].toolName, "calculator");
      assert.ok(res.response.includes("13.14"));
      pass("Test 2: RETRIEVAL_CALCULATION routed correctly and used deterministic calculator (13.14 days)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: VISION_CALCULATION
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 3] VISION_CALCULATION ---");
    {
      const initialWf = classifyInitialWorkflow({
        userRequest: "Extract the power (kW) and speed (RPM) from this motor nameplate image and calculate the shaft torque.",
        images: [SAMPLE_IMAGE_BASE64],
      });
      assert.strictEqual(initialWf, WORKFLOW_TYPES.VISION_CALCULATION);

      let stepNum = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "vision_calculation",
            action: "tool",
            tool: "vision",
            input: { prompt: "Extract motor power in kW and rotational speed in RPM." },
            reason: "Read motor parameters from image.",
          });
        }
        if (stepNum === 2) {
          return JSON.stringify({
            workflow: "vision_calculation",
            action: "tool",
            tool: "calculator",
            input: { expression: "22 * 9550 / 960" },
            reason: "Calculate torque using formula P * 9550 / N.",
          });
        }
        return JSON.stringify({
          workflow: "vision_calculation",
          action: "final",
          reason: "Completed vision calculation.",
          answer: "The nameplate indicates Power = 22 kW, Speed = 960 RPM. The calculated shaft torque is 218.85 Nm.",
        });
      });

      const res = await runAgentTask({
        message: "Extract the power (kW) and speed (RPM) from this motor nameplate image and calculate the shaft torque.",
        images: [SAMPLE_IMAGE_BASE64],
        userId: "test-user-3",
        options: {
          visionClient: async () => "Motor Nameplate: Power = 22 kW, Speed = 960 RPM",
        },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "vision_calculation");
      assert.strictEqual(res.steps[0].toolName, "vision");
      assert.strictEqual(res.steps[1].toolName, "calculator");
      assert.ok(res.response.includes("218.85"));
      pass("Test 3: VISION_CALCULATION extracted image values and calculated torque deterministically");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: VISION_KNOWLEDGE
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 4] VISION_KNOWLEDGE ---");
    {
      const initialWf = classifyInitialWorkflow({
        userRequest: "Identify the pump model tag shown in this image and retrieve its standard operating procedure from documentation.",
        images: [SAMPLE_IMAGE_BASE64],
      });
      assert.strictEqual(initialWf, WORKFLOW_TYPES.VISION_KNOWLEDGE);

      let stepNum = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "vision_knowledge",
            action: "tool",
            tool: "vision",
            input: { prompt: "Extract the pump equipment tag from the image." },
            reason: "Read tag number.",
          });
        }
        if (stepNum === 2) {
          return JSON.stringify({
            workflow: "vision_knowledge",
            action: "tool",
            tool: "retrieve_information",
            input: { query: "P-204A standard operating procedure maintenance" },
            reason: "Retrieve maintenance SOP for P-204A.",
          });
        }
        return JSON.stringify({
          workflow: "vision_knowledge",
          action: "final",
          reason: "Completed vision knowledge workflow.",
          answer: "Image indicates equipment tag P-204A. Documentation specifies quarterly bearing lubrication and seal inspection.",
        });
      });

      const res = await runAgentTask({
        message: "Identify the pump model tag shown in this image and retrieve its standard operating procedure from documentation.",
        images: [SAMPLE_IMAGE_BASE64],
        userId: "test-user-4",
        options: {
          visionClient: async () => "Equipment Tag: P-204A",
          retriever: async () => ({
            success: true,
            content: "P-204A Maintenance SOP: Quarterly lubrication.",
            results: [{ filename: "ENG-PMP-014.pdf", page: 1, text: "P-204A maintenance SOP." }],
          }),
        },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "vision_knowledge");
      assert.strictEqual(res.steps[0].toolName, "vision");
      assert.strictEqual(res.steps[1].toolName, "retrieve_information");
      pass("Test 4: VISION_KNOWLEDGE combined visual tag inspection with KB document retrieval");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: CODING_SANDBOX
    // User explicitly requests writing and executing Python code for Reynolds number
    // Must NOT be routed to engineering!
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 5] CODING_SANDBOX ---");
    {
      const initialWf = classifyInitialWorkflow({
        userRequest: "Write and execute a Python script to calculate Reynolds number for water flow with D=0.05m, v=1.8m/s, rho=998kg/m3, mu=0.001002Pa.s.",
      });
      assert.strictEqual(initialWf, WORKFLOW_TYPES.CODING_SANDBOX, "Must prioritize CODING_SANDBOX over ENGINEERING");

      let stepNum = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "coding",
            input: { task: "Calculate Reynolds number and determine laminar/turbulent." },
            reason: "Generate Python code.",
          });
        }
        if (stepNum === 2) {
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "execute_code",
            input: {
              code: "D=0.05\nv=1.8\nrho=998\nmu=0.001002\nRe=(rho*v*D)/mu\nregime='TURBULENT' if Re > 4000 else 'LAMINAR'\nprint(f'Re={Re:.2f}, Regime={regime}')",
              language: "python",
            },
            reason: "Execute Python script in sandbox.",
          });
        }
        return JSON.stringify({
          workflow: "coding_sandbox",
          action: "final",
          reason: "Code executed in sandbox.",
          answer: "Executed Python script in isolated sandbox. Output: Re = 89640.72. Regime is TURBULENT (Re > 4000).",
        });
      });

      const res = await runAgentTask({
        message: "Write and execute a Python script to calculate Reynolds number for water flow with D=0.05m, v=1.8m/s, rho=998kg/m3, mu=0.001002Pa.s.",
        userId: "test-user-5",
        options: {
          coderClient: async () => ({
            language: "python",
            code: "D=0.05\nv=1.8\nrho=998\nmu=0.001002\nRe=(rho*v*D)/mu\nprint(f'Re={Re:.2f}')",
          }),
          sandboxRunner: async () => ({
            success: true,
            exitCode: 0,
            stdout: "Re=89640.72, Regime=TURBULENT",
            stderr: "",
          }),
        },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "coding_sandbox");
      assert.strictEqual(res.steps[0].toolName, "coding");
      assert.strictEqual(res.steps[1].toolName, "execute_code");
      assert.ok(res.response.includes("89640.72"));
      assert.ok(res.response.includes("TURBULENT"));
      pass("Test 5: CODING_SANDBOX correctly selected over engineering and executed Python in sandbox");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6: ENGINEERING
    // Unit conversion + formula calculation
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 6] ENGINEERING ---");
    {
      const initialWf = classifyInitialWorkflow({
        userRequest: "Pump discharge pressure is 100 psi and suction pressure is 2 bar. Convert 100 psi to bar and calculate the differential pressure.",
      });
      assert.strictEqual(initialWf, WORKFLOW_TYPES.ENGINEERING);

      let stepNum = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "engineering",
            action: "tool",
            tool: "unit_conversion",
            input: { value: 100, from_unit: "psi", to_unit: "bar" },
            reason: "Convert 100 psi to bar.",
          });
        }
        if (stepNum === 2) {
          return JSON.stringify({
            workflow: "engineering",
            action: "tool",
            tool: "engineering_formula",
            input: {
              formula: "pressure_difference",
              discharge_pressure: 6.894757,
              suction_pressure: 2.0,
              unit: "bar",
            },
            reason: "Calculate differential pressure in bar.",
          });
        }
        return JSON.stringify({
          workflow: "engineering",
          action: "final",
          reason: "Calculations complete.",
          answer: "100 psi converts to 6.894757 bar. With a suction pressure of 2.0 bar, the differential pressure is 4.894757 bar.",
        });
      });

      const res = await runAgentTask({
        message: "Pump discharge pressure is 100 psi and suction pressure is 2 bar. Convert 100 psi to bar and calculate the differential pressure.",
        userId: "test-user-6",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "engineering");
      assert.strictEqual(res.steps[0].toolName, "unit_conversion");
      assert.strictEqual(res.steps[1].toolName, "engineering_formula");
      assert.ok(res.response.includes("6.894757"));
      assert.ok(res.response.includes("4.894757"));
      pass("Test 6: ENGINEERING converted 100 psi to 6.89 bar and calculated differential pressure");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 7: GENERAL
    // Conceptual explanation, 0 tools
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 7] GENERAL ---");
    {
      const initialWf = classifyInitialWorkflow({
        userRequest: "Explain centrifugal pump cavitation.",
      });
      assert.strictEqual(initialWf, WORKFLOW_TYPES.GENERAL);

      agentGraphService.setAgentBrainLlmClient(async () => {
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Cavitation explanation is conceptual.",
          answer: "Cavitation in centrifugal pumps occurs when local pressure drops below liquid vapor pressure, creating vapor cavities that collapse violently against impeller surfaces.",
        });
      });

      const res = await runAgentTask({
        message: "Explain centrifugal pump cavitation.",
        userId: "test-user-7",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "general");
      assert.strictEqual(res.steps.length, 0);
      assert.ok(res.response.includes("Cavitation"));
      pass("Test 7: GENERAL answered conceptual question directly with 0 tools");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 8: DOCUMENT_ANALYSIS
    // Uploaded document context, must NOT route to persistent KB
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 8] DOCUMENT_ANALYSIS ---");
    {
      const initialWf = classifyInitialWorkflow({
        userRequest: "Summarize the required safety equipment and LOTO verification steps described in this uploaded procedure:\n\n[DOCUMENT CONTEXT]\nSection 4.1 Safety: Wear hard hat, safety glasses, face shield.\nSection 4.2 LOTO: De-energize feeder breaker, attach padlock and tag, verify zero energy with calibrated voltmeter.",
      });
      assert.strictEqual(initialWf, WORKFLOW_TYPES.DOCUMENT_ANALYSIS);

      agentGraphService.setAgentBrainLlmClient(async () => {
        return JSON.stringify({
          workflow: "document_analysis",
          action: "final",
          reason: "Summarized uploaded procedure directly.",
          answer: "Required Safety Equipment: Hard hat, safety glasses, and face shield. LOTO Verification Steps: De-energize feeder breaker, apply padlock and tag, and verify zero energy with a calibrated voltmeter.",
        });
      });

      const res = await runAgentTask({
        message: "Summarize the required safety equipment and LOTO verification steps described in this uploaded procedure:\n\n[DOCUMENT CONTEXT]\nSection 4.1 Safety: Wear hard hat, safety glasses, face shield.\nSection 4.2 LOTO: De-energize feeder breaker, attach padlock and tag, verify zero energy with calibrated voltmeter.",
        userId: "test-user-8",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "document_analysis");
      assert.strictEqual(res.steps.length, 0, "Uploaded document must not query persistent KB");
      assert.ok(res.response.includes("LOTO"));
      pass("Test 8: DOCUMENT_ANALYSIS used uploaded document directly without persistent KB retrieval");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 9: DATA_ANALYSIS
    // Array [34.5, 36.0, 37.8, 39.2, 41.0, 43.5] statistics & trend
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 9] DATA_ANALYSIS ---");
    {
      const initialWf = classifyInitialWorkflow({
        userRequest: "Analyze this dataset of temperature readings [34.5, 36.0, 37.8, 39.2, 41.0, 43.5] °C: compute the mean, range, and trend direction.",
      });
      assert.strictEqual(initialWf, WORKFLOW_TYPES.DATA_ANALYSIS);

      let stepNum = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "data_analysis",
            action: "tool",
            tool: "statistics",
            input: { values: [34.5, 36.0, 37.8, 39.2, 41.0, 43.5], unit: "°C" },
            reason: "Compute descriptive statistics.",
          });
        }
        if (stepNum === 2) {
          return JSON.stringify({
            workflow: "data_analysis",
            action: "tool",
            tool: "trend_analysis",
            input: { values: [34.5, 36.0, 37.8, 39.2, 41.0, 43.5], tolerance_percentage: 1.0, unit: "°C" },
            reason: "Evaluate trend direction.",
          });
        }
        return JSON.stringify({
          workflow: "data_analysis",
          action: "final",
          reason: "Analysis complete.",
          answer: "Statistical Analysis: Mean = 38.67 °C, Minimum = 34.5 °C, Maximum = 43.5 °C, Range = 9.0 °C. Trend Analysis: Trend is INCREASING with an overall change of +9.0 °C (+26.09%).",
        });
      });

      const res = await runAgentTask({
        message: "Analyze this dataset of temperature readings [34.5, 36.0, 37.8, 39.2, 41.0, 43.5] °C: compute the mean, range, and trend direction.",
        userId: "test-user-9",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "data_analysis");
      assert.strictEqual(res.steps[0].toolName, "statistics");
      assert.strictEqual(res.steps[1].toolName, "trend_analysis");
      assert.strictEqual(res.steps[0].observation.mean, 38.666667);
      assert.strictEqual(res.steps[1].observation.trend.toLowerCase(), "increasing");
      assert.ok(res.response.includes("38.67"));
      assert.ok(res.response.includes("INCREASING"));
      pass("Test 9: DATA_ANALYSIS computed exact statistics (Mean 38.67) and trend (INCREASING 26.09%)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 10: COMPLIANCE_CHECK
    // Vibration 5.1 mm/s vs ENG-PMP-014 limit
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 10] COMPLIANCE_CHECK ---");
    {
      const initialWf = classifyInitialWorkflow({
        userRequest: "The measured vibration is 5.1 mm/s. According to ENG-PMP-014, is this compliant?",
      });
      assert.strictEqual(initialWf, WORKFLOW_TYPES.COMPLIANCE_CHECK);

      let stepNum = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "compliance_check",
            action: "tool",
            tool: "retrieve_information",
            input: { query: "ENG-PMP-014 vibration limit threshold" },
            reason: "Retrieve allowable vibration limit from ENG-PMP-014.",
          });
        }
        if (stepNum === 2) {
          return JSON.stringify({
            workflow: "compliance_check",
            action: "tool",
            tool: "threshold_check",
            input: { value: 5.1, limit: 4.5, operator: ">", unit: "mm/s" },
            reason: "Compare 5.1 mm/s against 4.5 mm/s limit.",
          });
        }
        return JSON.stringify({
          workflow: "compliance_check",
          action: "final",
          reason: "Compliance checked.",
          answer: "According to ENG-PMP-014 Section 3, the allowable vibration limit is 4.5 mm/s. The measured vibration of 5.1 mm/s is ABOVE_LIMIT (+0.6 mm/s, 113.33% of allowable limit) and is therefore NON-COMPLIANT (ALERT).",
        });
      });

      const res = await runAgentTask({
        message: "The measured vibration is 5.1 mm/s. According to ENG-PMP-014, is this compliant?",
        userId: "test-user-10",
        options: {
          retriever: async () => ({
            success: true,
            content: "ENG-PMP-014 Section 3.2: Maximum allowable vibration threshold is 4.5 mm/s RMS.",
            results: [{ filename: "ENG-PMP-014.pdf", page: 4, text: "Vibration threshold limit is 4.5 mm/s." }],
          }),
        },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "compliance_check");
      assert.strictEqual(res.steps[0].toolName, "retrieve_information");
      assert.strictEqual(res.steps[1].toolName, "threshold_check");
      assert.strictEqual(res.steps[1].observation.is_breached, true);
      assert.strictEqual(res.steps[1].observation.status_code, "ABOVE_LIMIT");
      assert.ok(res.response.includes("NON-COMPLIANT") || res.response.includes("ABOVE_LIMIT"));
      pass("Test 10: COMPLIANCE_CHECK retrieved 4.5 mm/s limit and performed deterministic threshold check (ABOVE_LIMIT)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 11: MULTI_STEP_ANALYSIS
    // Vision + Retrieval + Formula + Threshold check
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 11] MULTI_STEP_ANALYSIS ---");
    {
      const initialWf = classifyInitialWorkflow({
        userRequest: "Read the discharge gauge image, retrieve rated differential pressure from specification, calculate differential with suction=1.8 bar, and compare if compliant.",
        images: [SAMPLE_IMAGE_BASE64],
      });
      assert.strictEqual(initialWf, WORKFLOW_TYPES.MULTI_STEP_ANALYSIS);

      let stepNum = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "multi_step_analysis",
            action: "tool",
            tool: "vision",
            input: { prompt: "Read gauge pressure reading." },
            reason: "Extract discharge pressure from gauge.",
          });
        }
        if (stepNum === 2) {
          return JSON.stringify({
            workflow: "multi_step_analysis",
            action: "tool",
            tool: "retrieve_information",
            input: { query: "pump rated differential pressure specification" },
            reason: "Retrieve rated limit.",
          });
        }
        if (stepNum === 3) {
          return JSON.stringify({
            workflow: "multi_step_analysis",
            action: "tool",
            tool: "engineering_formula",
            input: { formula: "pressure_difference", discharge_pressure: 6.5, suction_pressure: 1.8, unit: "bar" },
            reason: "Calculate differential pressure.",
          });
        }
        if (stepNum === 4) {
          return JSON.stringify({
            workflow: "multi_step_analysis",
            action: "tool",
            tool: "threshold_check",
            input: { value: 4.7, limit: 4.0, operator: ">", unit: "bar" },
            reason: "Check against rated differential limit.",
          });
        }
        return JSON.stringify({
          workflow: "multi_step_analysis",
          action: "final",
          reason: "Multi-step analysis completed.",
          answer: "Gauge reading: 6.5 bar. Suction: 1.8 bar. Calculated differential pressure is 4.7 bar. Rated limit is 4.0 bar. Result: 4.7 > 4.0 bar (ABOVE_LIMIT / EXCEEDS SPECIFICATION).",
        });
      });

      const res = await runAgentTask({
        message: "Read the discharge gauge image, retrieve rated differential pressure from specification, calculate differential with suction=1.8 bar, and compare if compliant.",
        images: [SAMPLE_IMAGE_BASE64],
        userId: "test-user-11",
        options: {
          visionClient: async () => "Gauge reading: 6.5 bar",
          retriever: async () => ({
            success: true,
            content: "Pump specification: Rated differential pressure is 4.0 bar.",
            results: [{ filename: "PUMP-SPEC.pdf", page: 1, text: "Rated differential pressure: 4.0 bar." }],
          }),
        },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "multi_step_analysis");
      assert.strictEqual(res.steps.length, 4);
      assert.strictEqual(res.steps[0].toolName, "vision");
      assert.strictEqual(res.steps[1].toolName, "retrieve_information");
      assert.strictEqual(res.steps[2].toolName, "engineering_formula");
      assert.strictEqual(res.steps[3].toolName, "threshold_check");
      pass("Test 11: MULTI_STEP_ANALYSIS orchestrated Vision -> Retrieval -> Formula -> Threshold check");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 12: EDGE CASE — Missing Threshold Safe Refusal
    // 142°C discharge temp, no limit exists -> Safe refusal, never invent limit
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 12] EDGE CASE: Missing Threshold Safe Refusal ---");
    {
      let stepNum = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "compliance_check",
            action: "tool",
            tool: "retrieve_information",
            input: { query: "compressor discharge temperature safety shutdown limit" },
            reason: "Search for shutdown limit.",
          });
        }
        // Qwen3 attempts threshold_check without a limit
        if (stepNum === 2) {
          return JSON.stringify({
            workflow: "compliance_check",
            action: "tool",
            tool: "threshold_check",
            input: { value: 142 }, // Notice: limit is missing!
            reason: "Attempt threshold check.",
          });
        }
        return JSON.stringify({
          workflow: "compliance_check",
          action: "final",
          reason: "Limit unavailable.",
          answer: "The measured compressor discharge temperature is 142°C. However, documentation does not specify a safety shutdown limit for this equipment. In accordance with sovereign safety principles, the limit is unavailable and cannot be inferred.",
        });
      });

      const res = await runAgentTask({
        message: "The compressor discharge temperature is 142°C. Does this pass the safety shutdown limit?",
        userId: "test-user-12",
        options: {
          retriever: async () => ({
            success: true,
            content: "General compressor notes: Operating temperatures fluctuate with load.",
            results: [],
          }),
        },
      });

      assert.strictEqual(res.success, true);
      // Tool guard must prevent threshold_check from executing with undefined limit
      const executedThreshold = res.steps.find((s) => s.toolName === "threshold_check");
      if (executedThreshold) {
        assert.strictEqual(executedThreshold.observation.code, "MISSING_LIMIT");
      }
      assert.ok(res.response.includes("unavailable") || res.response.includes("not specified"));
      pass("Test 12: Missing threshold resulted in controlled safe refusal without inventing limits");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 13: EDGE CASE — Incompatible Units Error
    // 15 bar -> kg (pressure to mass)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 13] EDGE CASE: Incompatible Units Error ---");
    {
      let stepNum = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "engineering",
            action: "tool",
            tool: "unit_conversion",
            input: { value: 15, from_unit: "bar", to_unit: "kg" },
            reason: "Convert bar to kg.",
          });
        }
        return JSON.stringify({
          workflow: "engineering",
          action: "final",
          reason: "Explain incompatible units.",
          answer: "Cannot convert 15 bar to kg: bar is a unit of pressure while kg is a unit of mass. They are physically incompatible dimensions without specifying a surface area and local gravity.",
        });
      });

      const res = await runAgentTask({
        message: "Convert 15 bar to kg.",
        userId: "test-user-13",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps[0].toolName, "unit_conversion");
      assert.strictEqual(res.steps[0].observation.code, "INCOMPATIBLE_UNITS");
      assert.ok(res.response.includes("pressure") && res.response.includes("mass"));
      pass("Test 13: Incompatible units (15 bar -> kg) returned structured error and clear dimensional explanation");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 14: EDGE CASE — Cross-Document Synthesis
    // ENG-PMP-014 (motor power, inspection) + SAF-PMP-001 (PPE)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 14] EDGE CASE: Cross-Document Synthesis ---");
    {
      let stepNum = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "knowledge_retrieval",
            action: "tool",
            tool: "retrieve_information",
            input: { query: "pump P-204A motor power inspection frequency and maintenance PPE" },
            reason: "Retrieve pump specs and PPE safety requirements.",
          });
        }
        return JSON.stringify({
          workflow: "knowledge_retrieval",
          action: "final",
          reason: "Synthesize from both documents.",
          answer: "Pump P-204A Specifications (ENG-PMP-014): Motor power is 45 kW, inspection frequency is quarterly. Required PPE (SAF-PMP-001): Hard hat, safety glasses, chemical-resistant gloves, and steel-toe boots.",
        });
      });

      const res = await runAgentTask({
        message: "What is the motor power and inspection frequency of pump P-204A, and what PPE is required before maintenance?",
        userId: "test-user-14",
        options: {
          retriever: async () => ({
            success: true,
            content: "ENG-PMP-014: P-204A motor power 45 kW, quarterly inspection.\nSAF-PMP-001: Required PPE: hard hat, safety glasses, chemical-resistant gloves.",
            results: [
              { filename: "ENG-PMP-014.pdf", page: 2, text: "Motor power 45 kW, quarterly inspection." },
              { filename: "SAF-PMP-001.pdf", page: 1, text: "Required PPE: hard hat, safety glasses, chemical-resistant gloves." },
            ],
          }),
        },
      });

      assert.strictEqual(res.success, true);
      assert.ok(res.response.includes("ENG-PMP-014") || res.response.includes("45 kW"));
      assert.ok(res.response.includes("SAF-PMP-001") || res.response.includes("glasses"));
      pass("Test 14: Cross-document synthesis captured facts from both ENG-PMP-014 and SAF-PMP-001");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 15: EDGE CASE — Document Analysis + Engineering Calculation
    // Uploaded doc: Original = 2.8 mm, Measured = 2.1 mm -> 25% reduction
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 15] EDGE CASE: Document Analysis + Engineering Calculation ---");
    {
      let stepNum = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "document_analysis",
            action: "tool",
            tool: "engineering_formula",
            input: {
              formula: "percentage_change",
              old_value: 2.8,
              new_value: 2.1,
              unit: "%",
            },
            reason: "Compute wall thickness reduction from document measurements.",
          });
        }
        return JSON.stringify({
          workflow: "document_analysis",
          action: "final",
          reason: "Calculation complete.",
          answer: "Based on the uploaded ultrasonic inspection report, original thickness was 2.8 mm and measured thickness is 2.1 mm. The wall thickness reduction is 25.0% (-25.0%).",
        });
      });

      const res = await runAgentTask({
        message: "From this uploaded inspection report, calculate the percentage reduction in pipe wall thickness:\n\n[DOCUMENT CONTEXT]\nPipe Section: Boiler Feed 3\nOriginal nominal thickness = 2.8 mm\nMeasured ultrasonic thickness = 2.1 mm",
        userId: "test-user-15",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "document_analysis");
      assert.strictEqual(res.steps[0].toolName, "engineering_formula");
      assert.strictEqual(res.steps[0].observation.result, -25);
      assert.ok(res.response.includes("25"));
      pass("Test 15: DOCUMENT_ANALYSIS invoked shared engineering formula tool to compute 25% reduction");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 16: EDGE CASE — Division by Zero Safety
    // Input power = 0, output = 15 -> Controlled DIVISION_BY_ZERO error
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 16] EDGE CASE: Division by Zero Safety ---");
    {
      let stepNum = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "engineering",
            action: "tool",
            tool: "engineering_formula",
            input: {
              formula: "efficiency",
              useful_output: 15,
              input: 0,
            },
            reason: "Calculate efficiency with input power 0.",
          });
        }
        return JSON.stringify({
          workflow: "engineering",
          action: "final",
          reason: "Explain zero division error.",
          answer: "Efficiency cannot be calculated because input power is zero (division by zero). A system cannot produce 15 kW output with zero input power.",
        });
      });

      const res = await runAgentTask({
        message: "Calculate the efficiency of a motor with output 15 kW and input 0 kW.",
        userId: "test-user-16",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps[0].toolName, "engineering_formula");
      assert.strictEqual(res.steps[0].observation.code, "DIVISION_BY_ZERO");
      assert.strictEqual(res.steps[0].observation.message, "Efficiency cannot be calculated because input power is zero.");
      assert.ok(res.response.includes("zero"));
      pass("Test 16: Division by zero produced structured DIVISION_BY_ZERO error and clear explanation without looping");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 17: EDGE CASE — Coding Sandbox Execution
    // Factorial of 7 = 5040
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 17] EDGE CASE: Coding Sandbox Execution ---");
    {
      let stepNum = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "coding_sandbox",
            action: "tool",
            tool: "execute_code",
            input: {
              code: "import math\nprint(math.factorial(7))",
              language: "python",
            },
            reason: "Compute factorial of 7 in sandbox.",
          });
        }
        return JSON.stringify({
          workflow: "coding_sandbox",
          action: "final",
          reason: "Execution complete.",
          answer: "Factorial of 7 computed in sandbox is 5040.",
        });
      });

      const res = await runAgentTask({
        message: "Write and run a Python script in sandbox to compute factorial of 7.",
        userId: "test-user-17",
        options: {
          sandboxRunner: async () => ({
            success: true,
            exitCode: 0,
            stdout: "5040\n",
            stderr: "",
          }),
        },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "coding_sandbox");
      assert.strictEqual(res.steps[0].toolName, "execute_code");
      assert.ok(res.response.includes("5040"));
      pass("Test 17: Coding sandbox executed Python snippet and returned 5040");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 18: EDGE CASE — Stable Trend with Tolerance
    // [100.0, 100.2, 99.8, 100.1, 99.9] with tolerance 1.0% -> STABLE
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 18] EDGE CASE: Stable Trend with Tolerance ---");
    {
      let stepNum = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "data_analysis",
            action: "tool",
            tool: "trend_analysis",
            input: {
              values: [100.0, 100.2, 99.8, 100.1, 99.9],
              tolerance_percentage: 1.0,
            },
            reason: "Evaluate stability with 1.0% tolerance.",
          });
        }
        return JSON.stringify({
          workflow: "data_analysis",
          action: "final",
          reason: "Trend evaluated.",
          answer: "The sequential readings [100.0, 100.2, 99.8, 100.1, 99.9] exhibit a STABLE trend within the 1.0% tolerance band (percentage change = -0.1%).",
        });
      });

      const res = await runAgentTask({
        message: "Analyze the trend of readings [100.0, 100.2, 99.8, 100.1, 99.9] with tolerance 1.0%.",
        userId: "test-user-18",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps[0].toolName, "trend_analysis");
      assert.strictEqual(res.steps[0].observation.trend.toLowerCase(), "stable");
      assert.ok(res.response.includes("STABLE"));
      pass("Test 18: Trend analysis with 1.0% tolerance band correctly evaluated to STABLE");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 19: EDGE CASE — Duplicate Retrieval Protection
    // Identical query executed once, duplicate attempts reuse state
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 19] EDGE CASE: Duplicate Retrieval Protection ---");
    {
      let stepNum = 0;
      let actualRetrieverCalls = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        stepNum++;
        if (stepNum === 1) {
          return JSON.stringify({
            workflow: "knowledge_retrieval",
            action: "tool",
            tool: "retrieve_information",
            input: { query: "PRV set pressure CDU-2" },
            reason: "First retrieval query.",
          });
        }
        // Attempt duplicate query on step 2
        if (stepNum === 2) {
          return JSON.stringify({
            workflow: "knowledge_retrieval",
            action: "tool",
            tool: "retrieve_information",
            input: { query: "PRV set pressure CDU-2" },
            reason: "Repeated retrieval query.",
          });
        }
        return JSON.stringify({
          workflow: "knowledge_retrieval",
          action: "final",
          reason: "Complete.",
          answer: "The set pressure of PRV valves on CDU-2 is 12.5 bar gauge.",
        });
      });

      const res = await runAgentTask({
        message: "What is the set pressure of PRV valves on CDU-2?",
        userId: "test-user-19",
        options: {
          retriever: async () => {
            actualRetrieverCalls++;
            return {
              success: true,
              content: "CDU-2 PRV set pressure is 12.5 bar.",
              results: [{ filename: "CDU-2-PRV.pdf", page: 1, text: "Set pressure: 12.5 bar." }],
            };
          },
        },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(actualRetrieverCalls, 1, "Duplicate retrieval call MUST be deduplicated/reused from state");
      assert.ok(res.response.includes("12.5 bar"));
      pass("Test 19: Duplicate retrieval was deduplicated and executed exactly 1 external search");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 20: EDGE CASE — Cross-Chat Context Isolation
    // Chat A has vibration = 3.6 mm/s. Chat B must NOT receive Chat A's value.
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Test 20] EDGE CASE: Cross-Chat Context Isolation ---");
    {
      // Turn in Chat A
      agentGraphService.setAgentBrainLlmClient(async () => {
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Chat A answer.",
          answer: "In Chat A, pump bearing vibration measured 3.6 mm/s.",
        });
      });

      const resA = await runAgentTask({
        message: "Pump bearing vibration is 3.6 mm/s.",
        chatId: "chat-uuid-alpha",
        userId: "engineer-alice",
      });

      assert.strictEqual(resA.success, true);

      // Query in separate Chat B
      agentGraphService.setAgentBrainLlmClient(async (messages) => {
        // Inspect prompt given to Qwen3 in Chat B: must contain zero references to 3.6 mm/s
        const promptText = messages.map((m) => m.content).join("\n");
        assert.ok(
          !promptText.includes("3.6 mm/s"),
          "Chat B Agent prompt must NEVER contain Chat A's vibration value"
        );
        return JSON.stringify({
          workflow: "general",
          action: "final",
          reason: "Chat B isolated answer.",
          answer: "I do not have access to measurements from previous independent chats.",
        });
      });

      const resB = await runAgentTask({
        message: "What was the vibration value measured in our previous chat?",
        chatId: "chat-uuid-beta",
        userId: "engineer-alice",
      });

      assert.strictEqual(resB.success, true);
      assert.ok(!resB.response.includes("3.6 mm/s"));
      pass("Test 20: Cross-chat context isolation confirmed (zero data leaked from Chat A to Chat B)");
    }

    console.log("\n================================================================================");
    console.log(`ALL 20 TEST CASES PASSED SUCCESSFULLY: ${passCount} / 20`);
    console.log("================================================================================");
  } catch (err) {
    console.error(`\n❌ TEST SUITE FAILED at Test ${testCount + 1}:`, err);
    process.exit(1);
  }
}

runAll20Cases();
