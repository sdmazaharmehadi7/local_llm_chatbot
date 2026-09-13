/**
 * New Workflows Acceptance & Cross-Tool Test Suite
 *
 * Validates the 4 new workflows added to the existing 7 workflows:
 * 1. DOCUMENT_ANALYSIS ("document_analysis"): Direct uploaded document analysis / extraction / summarization
 * 2. DATA_ANALYSIS ("data_analysis"): Structured / tabular dataset calculations (statistics, trend analysis)
 * 3. COMPLIANCE_CHECK ("compliance_check"): Specification / limit comparison (with deterministic threshold check)
 * 4. MULTI_STEP_ANALYSIS ("multi_step_analysis"): Complex cross-domain sequential tool composition
 *
 * Cross-Tool Scenarios:
 * - MULTI_STEP_ANALYSIS -> Vision -> Retrieval -> Engineering Formula -> Threshold Check -> Final
 * - DATA_ANALYSIS -> Statistics -> Threshold Check -> Final
 * - DOCUMENT_ANALYSIS -> Engineering Formula -> Final
 *
 * Safety Safeguards:
 * - COMPLIANCE_CHECK never invents limits
 * - Single Qwen3 Agent Brain (NO multiple agents, NO Supervisor Agent)
 */

import assert from "assert";
import { runAgentTask } from "../src/services/agent/agent.service.js";
import { agentGraphService } from "../src/services/agent/agentGraph.service.js";
import { WORKFLOW_TYPES } from "../src/services/agent/agent.types.js";

console.log("================================================================================");
console.log("STARTING NEW WORKFLOWS (11 WORKFLOWS TOTAL) TEST SUITE");
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
    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 1: DOCUMENT_ANALYSIS Workflow
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Section 1] DOCUMENT_ANALYSIS Workflow ---");

    // 1.1: Direct Document Analysis / Summarization
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        return JSON.stringify({
          workflow: "document_analysis",
          action: "final",
          reason: "Summarized uploaded inspection report from provided document context.",
          answer: "The inspection report indicates pump P-101 has normal casing temperature (42°C) but elevated vibration velocity on bearing 2 (3.8 mm/s). Recommended action: schedule bearing lubrication.",
        });
      });

      const res = await runAgentTask({
        message: "Summarize the key findings in this uploaded maintenance inspection report:\n\n[DOCUMENT CONTEXT]\nEquipment: P-101 Centrifugal Pump\nDate: 2026-09-10\nCasing Temp: 42°C (Normal)\nBearing 2 Vibration: 3.8 mm/s RMS (Elevated)\nRecommendation: Lubricate bearing 2 during next shift.",
        userId: "doc-user-1",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "document_analysis");
      assert.strictEqual(res.steps.length, 0); // Direct answer from uploaded document, zero unneeded tools
      assert.ok(res.response.includes("P-101"));
      assert.ok(res.response.includes("3.8 mm/s"));

      pass("Test 1.1: DOCUMENT_ANALYSIS summarized uploaded document directly without forcing KB retrieval");
    }

    // 1.2: DOCUMENT_ANALYSIS -> Cross-Workflow Engineering Calculation
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "document_analysis",
            action: "tool",
            tool: "engineering_formula",
            input: {
              formula: "pressure_difference",
              discharge_pressure: 8.4,
              suction_pressure: 2.2,
              unit: "bar",
            },
            reason: "Calculate differential pressure from pressures stated in the uploaded report.",
          });
        }
        return JSON.stringify({
          workflow: "document_analysis",
          action: "final",
          reason: "Calculation complete.",
          answer: "According to the uploaded report, discharge pressure is 8.4 bar and suction pressure is 2.2 bar. The calculated differential pressure is 6.2 bar.",
        });
      });

      const res = await runAgentTask({
        message: "From this attached inspection report, calculate the differential pressure:\n\n[DOCUMENT CONTEXT]\nPump P-201 log:\nDischarge Pressure = 8.4 bar\nSuction Pressure = 2.2 bar",
        userId: "doc-user-2",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "document_analysis");
      assert.strictEqual(res.steps.length, 1);
      assert.strictEqual(res.steps[0].tool, "engineering_formula");
      assert.strictEqual(res.steps[0].observation.result, 6.2);
      assert.ok(res.response.includes("6.2 bar"));

      pass("Test 1.2: DOCUMENT_ANALYSIS smoothly invoked shared Engineering Formula tool");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 2: DATA_ANALYSIS Workflow
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Section 2] DATA_ANALYSIS Workflow ---");

    // 2.1: Statistical Data Analysis on Tabular/Structured Measurements
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "data_analysis",
            action: "tool",
            tool: "statistics",
            input: {
              values: [4.1, 4.3, 4.8, 4.2, 5.0, 4.6],
              unit: "bar",
            },
            reason: "Compute summary statistics for the pressure measurement dataset.",
          });
        }
        return JSON.stringify({
          workflow: "data_analysis",
          action: "final",
          reason: "Data analysis complete.",
          answer: "Analysis of the 6 pressure readings:\n- Mean: 4.5 bar\n- Min: 4.1 bar\n- Max: 5.0 bar\n- Standard Deviation: 0.35 bar",
        });
      });

      const res = await runAgentTask({
        message: "Analyze this pressure sensor dataset: [4.1, 4.3, 4.8, 4.2, 5.0, 4.6] bar. Find the average and extremes.",
        userId: "data-user-1",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "data_analysis");
      assert.strictEqual(res.steps.length, 1);
      assert.strictEqual(res.steps[0].tool, "statistics");
      assert.strictEqual(res.steps[0].observation.count, 6);
      assert.strictEqual(res.steps[0].observation.mean, 4.5);

      pass("Test 2.1: DATA_ANALYSIS workflow evaluated tabular measurements deterministically via statistics tool");
    }

    // 2.2: DATA_ANALYSIS -> Statistics -> Threshold Check Composition
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "data_analysis",
            action: "tool",
            tool: "statistics",
            input: {
              values: [2.1, 2.3, 2.5, 3.8, 2.4],
              unit: "mm/s",
            },
            reason: "Calculate maximum vibration in dataset.",
          });
        }
        if (callCount === 2) {
          return JSON.stringify({
            workflow: "data_analysis",
            action: "tool",
            tool: "threshold_check",
            input: {
              value: 3.8,
              limit: 3.5,
              operator: ">",
              unit: "mm/s",
            },
            reason: "Verify if peak vibration exceeds allowable limit 3.5 mm/s.",
          });
        }
        return JSON.stringify({
          workflow: "data_analysis",
          action: "final",
          reason: "Evaluation complete.",
          answer: "The peak vibration is 3.8 mm/s, which is ABOVE_LIMIT (exceeds 3.5 mm/s threshold by 0.3 mm/s).",
        });
      });

      const res = await runAgentTask({
        message: "Here are the vibration readings from the last shift: [2.1, 2.3, 2.5, 3.8, 2.4] mm/s. The allowable limit is 3.5 mm/s. Are all readings compliant?",
        userId: "data-user-2",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "data_analysis");
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].tool, "statistics");
      assert.strictEqual(res.steps[1].tool, "threshold_check");
      assert.strictEqual(res.steps[1].observation.is_breached, true);
      assert.strictEqual(res.steps[1].observation.status_code, "ABOVE_LIMIT");
      assert.ok(res.response.includes("ABOVE_LIMIT"));

      pass("Test 2.2: DATA_ANALYSIS composed Statistics -> Threshold Check seamlessly");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 3: COMPLIANCE_CHECK Workflow
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Section 3] COMPLIANCE_CHECK Workflow ---");

    // 3.1: Direct Compliance Check with Known Limit
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "compliance_check",
            action: "tool",
            tool: "threshold_check",
            input: {
              value: 7.2,
              limit: 5.0,
              operator: ">",
              unit: "bar",
            },
            reason: "Check if measured pressure 7.2 bar exceeds permitted limit 5.0 bar.",
          });
        }
        return JSON.stringify({
          workflow: "compliance_check",
          action: "final",
          reason: "Compliance evaluation complete.",
          answer: "The measured pressure is 7.2 bar, which EXCEEDS the permitted limit of 5.0 bar by 2.2 bar (144% of allowable limit). Status: NON-COMPLIANT.",
        });
      });

      const res = await runAgentTask({
        message: "Measured discharge pressure is 7.2 bar. The permitted operating limit is 5.0 bar. Is this operating condition compliant?",
        userId: "comp-user-1",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "compliance_check");
      assert.strictEqual(res.steps.length, 1);
      assert.strictEqual(res.steps[0].tool, "threshold_check");
      assert.strictEqual(res.steps[0].observation.is_breached, true);
      assert.strictEqual(res.steps[0].observation.difference, 2.2);
      assert.ok(res.response.includes("EXCEEDS") || res.response.includes("NON-COMPLIANT"));

      pass("Test 3.1: COMPLIANCE_CHECK evaluated measurement against limit using deterministic threshold check");
    }

    // 3.2: Compliance Check with Limit Retrieved from Knowledge Base
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "compliance_check",
            action: "tool",
            tool: "retrieve_information",
            input: { query: "ISO 10816-3 allowable vibration velocity limit for Class II pumps" },
            reason: "Lookup required vibration standard limit in Knowledge Base.",
          });
        }
        if (callCount === 2) {
          return JSON.stringify({
            workflow: "compliance_check",
            action: "tool",
            tool: "threshold_check",
            input: {
              value: 3.2,
              limit: 4.5,
              operator: "<=",
              unit: "mm/s",
            },
            reason: "Verify if measured vibration 3.2 mm/s complies with retrieved standard limit 4.5 mm/s.",
          });
        }
        return JSON.stringify({
          workflow: "compliance_check",
          action: "final",
          reason: "Compliance verification complete.",
          answer: "Under ISO 10816-3, the allowable limit is 4.5 mm/s RMS. The measured vibration of 3.2 mm/s is WITHIN_LIMIT (71.1% of allowable limit). Status: COMPLIANT.",
        });
      });

      const mockRetriever = async () => ({
        results: [{ source: "ISO_10816-3_Standard.pdf", content: "Class II medium pump Zone B allowable limit is 4.5 mm/s RMS." }],
      });

      const res = await runAgentTask({
        message: "The measured pump vibration is 3.2 mm/s. Does it satisfy the ISO 10816-3 standard limit?",
        userId: "comp-user-2",
        options: { retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "compliance_check");
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].tool, "retrieve_information");
      assert.strictEqual(res.steps[1].tool, "threshold_check");
      assert.strictEqual(res.steps[1].observation.is_breached, false);
      assert.strictEqual(res.steps[1].observation.status_code, "WITHIN_LIMIT");
      assert.ok(res.response.includes("COMPLIANT") || res.response.includes("WITHIN_LIMIT"));

      pass("Test 3.2: COMPLIANCE_CHECK retrieved limit from KB and executed deterministic threshold check");
    }

    // 3.3: Compliance Check Safeguard: Never Invent Missing Limits
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        return JSON.stringify({
          workflow: "compliance_check",
          action: "final",
          reason: "Required specification limit is not provided or found.",
          answer: "The measured bearing temperature is 88°C. However, the permitted temperature threshold was neither specified in your request nor found in documentation. In accordance with safety compliance safeguards, unverified limits will never be invented.",
        });
      });

      const res = await runAgentTask({
        message: "The bearing temperature is 88°C. Is it compliant with the safety threshold?",
        userId: "comp-user-3",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "compliance_check");
      assert.strictEqual(res.steps.length, 0); // Zero tool calls; safe refusal to invent limits
      assert.ok(res.response.includes("88°C"));
      assert.ok(res.response.includes("safeguard") || res.response.includes("never be invented") || res.response.includes("threshold"));

      pass("Test 3.3: COMPLIANCE_CHECK strictly refused to invent missing safety limits");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 4: MULTI_STEP_ANALYSIS Workflow
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Section 4] MULTI_STEP_ANALYSIS Workflow ---");

    // 4.1: Complex 4-Tool Chain: Vision -> Retrieval -> Engineering Formula -> Threshold Check -> Final
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "multi_step_analysis",
            action: "tool",
            tool: "vision",
            input: { prompt: "Read the discharge pressure gauge in the image." },
            reason: "Step 1: Extract measured discharge pressure from gauge photo.",
          });
        }
        if (callCount === 2) {
          return JSON.stringify({
            workflow: "multi_step_analysis",
            action: "tool",
            tool: "retrieve_information",
            input: { query: "CDU feed pump allowable differential pressure limit" },
            reason: "Step 2: Look up permitted differential pressure limit from Knowledge Base manual.",
          });
        }
        if (callCount === 3) {
          return JSON.stringify({
            workflow: "multi_step_analysis",
            action: "tool",
            tool: "engineering_formula",
            input: {
              formula: "pressure_difference",
              discharge_pressure: 8.5,
              suction_pressure: 2.5,
              unit: "bar",
            },
            reason: "Step 3: Calculate pressure difference using extracted discharge (8.5 bar) and suction (2.5 bar).",
          });
        }
        if (callCount === 4) {
          return JSON.stringify({
            workflow: "multi_step_analysis",
            action: "tool",
            tool: "threshold_check",
            input: {
              value: 6.0,
              limit: 5.0,
              operator: ">",
              unit: "bar",
            },
            reason: "Step 4: Check if calculated 6.0 bar differential exceeds retrieved 5.0 bar limit.",
          });
        }
        return JSON.stringify({
          workflow: "multi_step_analysis",
          action: "final",
          reason: "All 4 multi-step analysis stages complete.",
          answer: "Multi-Step Analysis Summary:\n1. Visual Inspection: Gauge PI-101 reads 8.5 bar discharge.\n2. Knowledge Base: CDU pump manual specifies max differential limit of 5.0 bar.\n3. Differential Calculation: 8.5 bar - 2.5 bar = 6.0 bar.\n4. Compliance Evaluation: 6.0 bar is ABOVE_LIMIT (exceeds 5.0 bar allowable limit by 1.0 bar). Non-compliant.",
        });
      });

      agentGraphService.setVisionLlmClient(async () => {
        return "Gauge reads 8.5 bar.";
      });

      const mockRetriever = async () => ({
        results: [{ source: "Pump_Manual.pdf", content: "Allowable differential pressure limit is 5.0 bar." }],
      });

      const res = await runAgentTask({
        message: "Read the gauge image, retrieve the equipment limit from the manual, calculate the pressure difference using suction pressure 2.5 bar, and determine whether the value is within the permitted range.",
        userId: "multi-user-1",
        images: [SAMPLE_BASE64_IMAGE],
        options: { retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "multi_step_analysis");
      assert.strictEqual(res.steps.length, 4);
      assert.strictEqual(res.steps[0].tool, "vision");
      assert.strictEqual(res.steps[1].tool, "retrieve_information");
      assert.strictEqual(res.steps[2].tool, "engineering_formula");
      assert.strictEqual(res.steps[2].observation.result, 6.0);
      assert.strictEqual(res.steps[3].tool, "threshold_check");
      assert.strictEqual(res.steps[3].observation.status_code, "ABOVE_LIMIT");
      assert.ok(res.response.includes("ABOVE_LIMIT") || res.response.includes("Non-compliant"));

      pass("Test 4.1: MULTI_STEP_ANALYSIS orchestrated Vision -> Retrieval -> Engineering Formula -> Threshold Check sequentially with a single Qwen3 brain");
    }

    agentGraphService.resetAgentBrainLlmClient();
    agentGraphService.resetVisionLlmClient();

    console.log("================================================================================");
    console.log(`ALL ${testsPassed} NEW WORKFLOW TESTS PASSED!`);
    console.log("================================================================================");
  } catch (err) {
    agentGraphService.resetAgentBrainLlmClient();
    agentGraphService.resetVisionLlmClient();
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
  }
}

runSuite();
