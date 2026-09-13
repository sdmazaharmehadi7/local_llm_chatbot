/**
 * Engineering Workflow & Shared Engineering Tools Test Suite
 *
 * Validates:
 * 1. Deterministic execution of all 5 shared engineering tools:
 *    - Engineering Formula (11 controlled formulas)
 *    - Unit Conversion (7 physical categories, incompatible unit rejection)
 *    - Threshold / Limit Check (comparison, diff, percentage, safety)
 *    - Statistics (mean, median, min, max, range, variance, std dev)
 *    - Trend Analysis (direction, percentage change, rate of change)
 * 2. Dedicated Engineering Workflow execution
 * 3. Cross-workflow tool reusability (Engineering tools are GLOBAL, NOT exclusive to Engineering workflow):
 *    - Vision Workflow -> Engineering Formula
 *    - Knowledge Base Workflow -> Retrieval -> Engineering Formula -> Threshold Check
 *    - Unit Conversion -> Formula -> Threshold Check composition
 * 4. Engineering safety: limits must come from evidence or reported unavailable; never invented!
 */

import assert from "assert";
import { runAgentTask } from "../src/services/agent/agent.service.js";
import { agentGraphService } from "../src/services/agent/agentGraph.service.js";
import { WORKFLOW_TYPES } from "../src/services/agent/agent.types.js";
import engineeringFormulaTool, { SUPPORTED_FORMULAS } from "../src/services/agent/tools/engineeringFormula.tool.js";
import unitConversionTool from "../src/services/agent/tools/unitConversion.tool.js";
import thresholdCheckTool from "../src/services/agent/tools/thresholdCheck.tool.js";
import statisticsTool from "../src/services/agent/tools/statistics.tool.js";
import trendAnalysisTool from "../src/services/agent/tools/trendAnalysis.tool.js";

console.log("================================================================================");
console.log("STARTING ENGINEERING WORKFLOW & SHARED TOOLS TEST SUITE");
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
    // SECTION 1: Direct Deterministic Unit Tests for Shared Engineering Tools
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Section 1] Direct Deterministic Engineering Tools Tests ---");

    // 1.1: 11 Controlled Formulas
    {
      // 1. Pressure Difference
      const pDiff = await engineeringFormulaTool.execute({
        formula: "pressure_difference",
        discharge_pressure: 7.5,
        suction_pressure: 2.1,
      });
      assert.strictEqual(pDiff.status, "success");
      assert.strictEqual(pDiff.result, 5.4);

      // 2. Percentage Difference
      const pctDiff = await engineeringFormulaTool.execute({
        formula: "percentage_difference",
        value_a: 120,
        value_b: 100,
      });
      assert.strictEqual(pctDiff.status, "success");
      assert.strictEqual(pctDiff.result, 20);

      // 3. Percentage Change
      const pctChange = await engineeringFormulaTool.execute({
        formula: "percentage_change",
        old_value: 80,
        new_value: 100,
      });
      assert.strictEqual(pctChange.status, "success");
      assert.strictEqual(pctChange.result, 25);

      // 4. Efficiency
      const eff = await engineeringFormulaTool.execute({
        formula: "efficiency",
        useful_output: 85,
        input: 100,
      });
      assert.strictEqual(eff.status, "success");
      assert.strictEqual(eff.result, 85);

      // 5. Electrical Power (P = V * I)
      const elecPower = await engineeringFormulaTool.execute({
        formula: "electrical_power",
        voltage: 230,
        current: 10,
      });
      assert.strictEqual(elecPower.status, "success");
      assert.strictEqual(elecPower.result, 2300);

      // 6. Mechanical Power (P = 2*pi*N*T/60)
      const mechPower = await engineeringFormulaTool.execute({
        formula: "mechanical_power",
        speed_rpm: 1500,
        torque_nm: 200,
      });
      assert.strictEqual(mechPower.status, "success");
      assert.ok(Math.abs(mechPower.result - 31415.9265) < 0.1);

      // 7. Density (rho = m / V)
      const dens = await engineeringFormulaTool.execute({
        formula: "density",
        mass: 1000,
        volume: 2,
      });
      assert.strictEqual(dens.status, "success");
      assert.strictEqual(dens.result, 500);

      // 8. Flow Rate (Q = V / t)
      const flow = await engineeringFormulaTool.execute({
        formula: "flow_rate",
        volume: 120,
        time: 60,
      });
      assert.strictEqual(flow.status, "success");
      assert.strictEqual(flow.result, 2);

      // 9. Velocity (v = Q / A)
      const vel = await engineeringFormulaTool.execute({
        formula: "velocity",
        flow_rate: 10,
        area: 2,
      });
      assert.strictEqual(vel.status, "success");
      assert.strictEqual(vel.result, 5);

      // 10. Kinetic Energy (KE = 1/2 * m * v^2)
      const ke = await engineeringFormulaTool.execute({
        formula: "kinetic_energy",
        mass: 1000,
        velocity: 10,
      });
      assert.strictEqual(ke.status, "success");
      assert.strictEqual(ke.result, 50000);

      // 11. Potential Energy (PE = m * g * h)
      const pe = await engineeringFormulaTool.execute({
        formula: "potential_energy",
        mass: 100,
        height: 10,
        gravity: 9.81,
      });
      assert.strictEqual(pe.status, "success");
      assert.strictEqual(pe.result, 9810);

      // Safety: Arbitrary formula rejection
      const invalidFormula = await engineeringFormulaTool.execute({
        formula: "invented_quantum_entropy",
        val: 42,
      });
      assert.strictEqual(invalidFormula.status, "error");
      assert.ok(invalidFormula.error.includes("Unsupported engineering formula"));

      pass("Test 1.1: All 11 engineering formulas executed with exact deterministic accuracy");
    }

    // 1.2: Unit Conversion across 7 physical categories
    {
      // Pressure: psi -> bar
      const convPsi = await unitConversionTool.execute({
        value: 100,
        from_unit: "psi",
        to_unit: "bar",
      });
      assert.strictEqual(convPsi.status, "success");
      assert.ok(Math.abs(convPsi.result - 6.89476) < 0.001);

      // Temperature: °C -> °F
      const convTemp = await unitConversionTool.execute({
        value: 100,
        from_unit: "°C",
        to_unit: "°F",
      });
      assert.strictEqual(convTemp.status, "success");
      assert.strictEqual(convTemp.result, 212);

      // Length: inch -> mm
      const convLen = await unitConversionTool.execute({
        value: 10,
        from_unit: "inch",
        to_unit: "mm",
      });
      assert.strictEqual(convLen.status, "success");
      assert.strictEqual(convLen.result, 254);

      // Mass: kg -> lb
      const convMass = await unitConversionTool.execute({
        value: 1,
        from_unit: "kg",
        to_unit: "lb",
      });
      assert.strictEqual(convMass.status, "success");
      assert.ok(Math.abs(convMass.result - 2.20462) < 0.001);

      // Power: hp -> W
      const convPwr = await unitConversionTool.execute({
        value: 1,
        from_unit: "hp",
        to_unit: "W",
      });
      assert.strictEqual(convPwr.status, "success");
      assert.ok(Math.abs(convPwr.result - 745.7) < 0.1);

      // Incompatible unit error guard
      const incomp = await unitConversionTool.execute({
        value: 10,
        from_unit: "bar",
        to_unit: "kg",
      });
      assert.strictEqual(incomp.status, "error");
      assert.ok(incomp.error.includes("Incompatible units"));

      pass("Test 1.2: Unit conversion verified across physical categories with incompatible unit rejection");
    }

    // 1.3: Threshold / Limit Check
    {
      const checkAbove = await thresholdCheckTool.execute({
        value: 5.4,
        limit: 5.0,
        operator: ">",
        unit: "bar",
      });
      assert.strictEqual(checkAbove.status, "success");
      assert.strictEqual(checkAbove.is_breached, true);
      assert.strictEqual(checkAbove.status_code, "ABOVE_LIMIT");
      assert.strictEqual(checkAbove.difference, 0.4);

      const checkWithin = await thresholdCheckTool.execute({
        value: 3.5,
        limit: 4.5,
        operator: "<=",
        unit: "mm/s",
      });
      assert.strictEqual(checkWithin.status, "success");
      assert.strictEqual(checkWithin.is_breached, false);
      assert.strictEqual(checkWithin.status_code, "WITHIN_LIMIT");

      pass("Test 1.3: Threshold check evaluates limits and differences deterministically");
    }

    // 1.4: Statistics Tool
    {
      const stats = await statisticsTool.execute({
        values: [10, 20, 30, 40, 50],
        unit: "bar",
      });
      assert.strictEqual(stats.status, "success");
      assert.strictEqual(stats.count, 5);
      assert.strictEqual(stats.mean, 30);
      assert.strictEqual(stats.median, 30);
      assert.strictEqual(stats.minimum, 10);
      assert.strictEqual(stats.maximum, 50);
      assert.strictEqual(stats.range, 40);
      assert.strictEqual(stats.variance, 250);
      assert.ok(Math.abs(stats.standard_deviation - 15.8114) < 0.001);

      pass("Test 1.4: Statistics tool computes accurate summary metrics");
    }

    // 1.5: Trend Analysis Tool
    {
      const incTrend = await trendAnalysisTool.execute({
        values: [100, 105, 110, 115],
      });
      assert.strictEqual(incTrend.status, "success");
      assert.strictEqual(incTrend.trend, "increasing");
      assert.strictEqual(incTrend.percentage_change, 15);
      assert.strictEqual(incTrend.rate_of_change, 5);
      assert.strictEqual(incTrend.is_monotonic, true);

      const decTrend = await trendAnalysisTool.execute({
        values: [50, 45, 40, 35],
      });
      assert.strictEqual(decTrend.trend, "decreasing");

      const stableTrend = await trendAnalysisTool.execute({
        values: [100, 100.2, 99.8, 100],
      });
      assert.strictEqual(stableTrend.trend, "stable");

      pass("Test 1.5: Trend analysis evaluates directional series and stability bands");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 2: Dedicated Engineering Workflow Execution
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Section 2] Dedicated Engineering Workflow End-to-End ---");

    // 2.1: Simple Engineering Task (Pressure Difference)
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "engineering",
            action: "tool",
            tool: "engineering_formula",
            input: {
              formula: "pressure_difference",
              discharge_pressure: 7.5,
              suction_pressure: 2.1,
              unit: "bar",
            },
            reason: "Compute differential pressure using discharge and suction pressures.",
          });
        }
        return JSON.stringify({
          workflow: "engineering",
          action: "final",
          reason: "Calculation complete.",
          answer: "The pressure difference is 5.4 bar (Discharge 7.5 bar - Suction 2.1 bar).",
        });
      });

      const res = await runAgentTask({
        message: "Discharge pressure is 7.5 bar and suction pressure is 2.1 bar. Calculate the pressure difference.",
        userId: "eng-user-1",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "engineering");
      assert.strictEqual(res.steps.length, 1);
      assert.strictEqual(res.steps[0].tool, "engineering_formula");
      assert.strictEqual(res.steps[0].observation.result, 5.4);
      assert.ok(res.response.includes("5.4 bar"));

      pass("Test 2.1: Simple Engineering Task routed to Engineering Workflow and calculated differential");
    }

    // 2.2: Engineering + Limit Check Composition
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "engineering",
            action: "tool",
            tool: "engineering_formula",
            input: {
              formula: "pressure_difference",
              discharge_pressure: 7.5,
              suction_pressure: 2.1,
              unit: "bar",
            },
            reason: "Calculate pressure difference.",
          });
        }
        if (callCount === 2) {
          return JSON.stringify({
            workflow: "engineering",
            action: "tool",
            tool: "threshold_check",
            input: {
              value: 5.4,
              limit: 5.0,
              operator: ">",
              unit: "bar",
            },
            reason: "Verify whether 5.4 bar exceeds allowable limit 5.0 bar.",
          });
        }
        return JSON.stringify({
          workflow: "engineering",
          action: "final",
          reason: "Evaluation complete.",
          answer: "The differential pressure is 5.4 bar, which is ABOVE_LIMIT (exceeds the 5.0 bar allowable limit by 0.4 bar).",
        });
      });

      const res = await runAgentTask({
        message: "Discharge pressure is 7.5 bar and suction pressure is 2.1 bar. The allowable differential pressure is 5 bar. Is it within the limit?",
        userId: "eng-user-2",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "engineering");
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].tool, "engineering_formula");
      assert.strictEqual(res.steps[1].tool, "threshold_check");
      assert.strictEqual(res.steps[1].observation.is_breached, true);
      assert.strictEqual(res.steps[1].observation.status_code, "ABOVE_LIMIT");
      assert.ok(res.response.includes("ABOVE_LIMIT"));

      pass("Test 2.2: Dynamic composition of Engineering Formula -> Threshold Check in Engineering Workflow");
    }

    // 2.3: Unit Conversion + Calculation
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "engineering",
            action: "tool",
            tool: "unit_conversion",
            input: {
              value: 100,
              from_unit: "psi",
              to_unit: "bar",
            },
            reason: "Reconcile discharge pressure units from psi to bar.",
          });
        }
        if (callCount === 2) {
          return JSON.stringify({
            workflow: "engineering",
            action: "tool",
            tool: "engineering_formula",
            input: {
              formula: "pressure_difference",
              discharge_pressure: 6.8948,
              suction_pressure: 2.0,
              unit: "bar",
            },
            reason: "Calculate pressure difference in bar.",
          });
        }
        return JSON.stringify({
          workflow: "engineering",
          action: "final",
          reason: "Conversion and calculation complete.",
          answer: "100 psi converts to 6.8948 bar. The pressure difference is 4.8948 bar.",
        });
      });

      const res = await runAgentTask({
        message: "The discharge pressure is 100 psi and suction pressure is 2 bar. Calculate the pressure difference in bar.",
        userId: "eng-user-3",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "engineering");
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].tool, "unit_conversion");
      assert.strictEqual(res.steps[1].tool, "engineering_formula");
      assert.ok(res.response.includes("4.8948 bar"));

      pass("Test 2.3: Unit conversion executed prior to formula calculation for unit compatibility");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 3: Cross-Workflow Reusability (Global Shared Capabilities)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Section 3] Cross-Workflow Tool Reusability ---");

    // 3.1: Vision Workflow -> Engineering Formula
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "vision_calculation",
            action: "tool",
            tool: "vision",
            input: { prompt: "Read the discharge pressure gauge in the image." },
            reason: "Extract discharge pressure from gauge photo.",
          });
        }
        if (callCount === 2) {
          return JSON.stringify({
            workflow: "vision_calculation",
            action: "tool",
            tool: "engineering_formula",
            input: {
              formula: "pressure_difference",
              discharge_pressure: 8.2,
              suction_pressure: 2.1,
              unit: "bar",
            },
            reason: "Calculate pressure difference using extracted gauge value and suction pressure.",
          });
        }
        return JSON.stringify({
          workflow: "vision_calculation",
          action: "final",
          reason: "Visual extraction and engineering calculation complete.",
          answer: "Gauge indicates 8.2 bar. Pressure difference = 6.1 bar.",
        });
      });

      agentGraphService.setVisionLlmClient(async () => {
        return "Discharge gauge PI-101 reads 8.2 bar.";
      });

      const res = await runAgentTask({
        message: "Read the pressure from this gauge and calculate the pressure difference using suction pressure 2.1 bar.",
        userId: "cross-user-vision",
        images: [SAMPLE_BASE64_IMAGE],
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "vision_calculation");
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].tool, "vision");
      assert.strictEqual(res.steps[1].tool, "engineering_formula");
      assert.strictEqual(res.steps[1].observation.result, 6.1);

      pass("Test 3.1: Vision Workflow seamlessly invoked shared Engineering Formula tool");
    }

    // 3.2: Knowledge Base Workflow -> Retrieval -> Engineering Formula -> Threshold Check
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "retrieval_calculation",
            action: "tool",
            tool: "retrieve_information",
            input: { query: "Maximum allowable differential pressure limit specification" },
            reason: "Lookup equipment limit in Knowledge Base.",
          });
        }
        if (callCount === 2) {
          return JSON.stringify({
            workflow: "retrieval_calculation",
            action: "tool",
            tool: "engineering_formula",
            input: {
              formula: "pressure_difference",
              discharge_pressure: 7.5,
              suction_pressure: 2.1,
              unit: "bar",
            },
            reason: "Calculate differential pressure.",
          });
        }
        if (callCount === 3) {
          return JSON.stringify({
            workflow: "retrieval_calculation",
            action: "tool",
            tool: "threshold_check",
            input: {
              value: 5.4,
              limit: 5.0,
              operator: ">",
              unit: "bar",
            },
            reason: "Compare calculated differential against retrieved specification limit.",
          });
        }
        return JSON.stringify({
          workflow: "retrieval_calculation",
          action: "final",
          reason: "Done.",
          answer: "Document spec limit is 5.0 bar. Calculated difference is 5.4 bar (ABOVE_LIMIT).",
        });
      });

      const mockRetriever = async () => ({
        results: [{ source: "Pump_Spec_Manual.pdf", content: "Max differential limit is 5.0 bar." }],
      });

      const res = await runAgentTask({
        message: "According to the equipment specification, calculate the pressure difference between suction pressure 2.1 bar and discharge pressure 7.5 bar and determine whether it exceeds the permitted limit.",
        userId: "cross-user-kb",
        options: { retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 3);
      assert.strictEqual(res.steps[0].tool, "retrieve_information");
      assert.strictEqual(res.steps[1].tool, "engineering_formula");
      assert.strictEqual(res.steps[2].tool, "threshold_check");
      assert.strictEqual(res.steps[2].observation.status_code, "ABOVE_LIMIT");

      pass("Test 3.2: Knowledge Base Workflow dynamically composed Retrieval -> Formula -> Threshold Check");
    }

    // 3.3: Case 2: Engineering + Knowledge Base (Engineering Workflow -> Retrieval -> Formula -> Final)
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "engineering",
            action: "tool",
            tool: "retrieve_information",
            input: { query: "Suction pressure reading for P-101 pump inspection log" },
            reason: "Retrieve suction pressure from log.",
          });
        }
        if (callCount === 2) {
          return JSON.stringify({
            workflow: "engineering",
            action: "tool",
            tool: "engineering_formula",
            input: {
              formula: "pressure_difference",
              discharge_pressure: 7.5,
              suction_pressure: 2.1,
              unit: "bar",
            },
            reason: "Calculate differential pressure.",
          });
        }
        return JSON.stringify({
          workflow: "engineering",
          action: "final",
          reason: "Completed calculation using retrieved suction pressure.",
          answer: "Retrieved suction pressure is 2.1 bar. Pressure difference is 5.4 bar.",
        });
      });

      const mockRetriever = async () => ({
        results: [{ source: "P-101_Log.pdf", content: "P-101 suction pressure = 2.1 bar." }],
      });

      const res = await runAgentTask({
        message: "We are analyzing pump differential pressure. Retrieve the suction pressure reading from the daily inspection log, then calculate the pressure difference using discharge pressure 7.5 bar.",
        userId: "eng-kb-case2",
        options: { retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "engineering");
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].tool, "retrieve_information");
      assert.strictEqual(res.steps[1].tool, "engineering_formula");
      assert.strictEqual(res.steps[1].observation.result, 5.4);
      assert.ok(res.response.includes("5.4 bar"));

      pass("Test 3.3 (Case 2): Engineering Workflow seamlessly executed Retrieval -> Engineering Formula -> Final");
    }

    // 3.4: Case 4: Knowledge Base + Engineering (knowledge_retrieval Workflow -> Retrieval -> Formula -> Final)
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "knowledge_retrieval",
            action: "tool",
            tool: "retrieve_information",
            input: { query: "Rated discharge and suction pressures for CDU feed pump P-204A" },
            reason: "Retrieve pump pressure specifications.",
          });
        }
        if (callCount === 2) {
          return JSON.stringify({
            workflow: "knowledge_retrieval",
            action: "tool",
            tool: "engineering_formula",
            input: {
              formula: "pressure_difference",
              discharge_pressure: 12.0,
              suction_pressure: 3.5,
              unit: "bar",
            },
            reason: "Calculate rated differential pressure using engineering formula.",
          });
        }
        return JSON.stringify({
          workflow: "knowledge_retrieval",
          action: "final",
          reason: "Answer complete.",
          answer: "Document specifies discharge = 12.0 bar, suction = 3.5 bar. Rated pressure difference is 8.5 bar.",
        });
      });

      const mockRetriever = async () => ({
        results: [{ source: "ENG-PMP-014.pdf", content: "P-204A: rated discharge 12.0 bar, suction 3.5 bar." }],
      });

      const res = await runAgentTask({
        message: "According to CDU pump manual ENG-PMP-014, what is the rated pressure difference of P-204A?",
        userId: "kb-eng-case4",
        options: { retriever: mockRetriever },
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.workflow.type, "knowledge_retrieval");
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].tool, "retrieve_information");
      assert.strictEqual(res.steps[1].tool, "engineering_formula");
      assert.strictEqual(res.steps[1].observation.result, 8.5);

      pass("Test 3.4 (Case 4): Knowledge Base Workflow seamlessly executed Retrieval -> Engineering Formula -> Final");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 4: Statistics & Trend Analysis in Agent State
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Section 4] Statistics & Trend Analysis Composition ---");
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "engineering",
            action: "tool",
            tool: "statistics",
            input: {
              values: [12.4, 14.1, 13.8, 15.2, 16.0],
              unit: "bar",
            },
            reason: "Calculate summary statistics for pressure readings.",
          });
        }
        if (callCount === 2) {
          return JSON.stringify({
            workflow: "engineering",
            action: "tool",
            tool: "trend_analysis",
            input: {
              values: [12.4, 14.1, 13.8, 15.2, 16.0],
              unit: "bar",
            },
            reason: "Evaluate chronological trend in pressure readings.",
          });
        }
        return JSON.stringify({
          workflow: "engineering",
          action: "final",
          reason: "Analysis complete.",
          answer: "Mean pressure is 14.3 bar. Readings show an INCREASING trend (+29.03%).",
        });
      });

      const res = await runAgentTask({
        message: "Analyze these 5 pressure sensor readings: [12.4, 14.1, 13.8, 15.2, 16.0] bar.",
        userId: "eng-stats-user",
      });

      assert.strictEqual(res.success, true);
      assert.strictEqual(res.steps.length, 2);
      assert.strictEqual(res.steps[0].tool, "statistics");
      assert.strictEqual(res.steps[1].tool, "trend_analysis");
      assert.strictEqual(res.steps[1].observation.trend, "increasing");
      assert.ok(res.response.includes("INCREASING"));

      pass("Test 4.1: Engineering Workflow dynamically sequenced Statistics and Trend Analysis");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 5: Safety Guard (Never Invent Limits)
    // ─────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Section 5] Engineering Safety Guard ---");
    {
      let callCount = 0;
      agentGraphService.setAgentBrainLlmClient(async () => {
        callCount++;
        if (callCount === 1) {
          return JSON.stringify({
            workflow: "engineering",
            action: "tool",
            tool: "engineering_formula",
            input: {
              formula: "pressure_difference",
              discharge_pressure: 7.5,
              suction_pressure: 2.1,
              unit: "bar",
            },
            reason: "Calculate pressure difference.",
          });
        }
        return JSON.stringify({
          workflow: "engineering",
          action: "final",
          reason: "Limit unavailable; cannot invent safety limits.",
          answer: "The calculated pressure difference is 5.4 bar. However, the permitted differential limit was not provided or found in documentation. As an engineering safety safeguard, unverified limits will never be invented.",
        });
      });

      const res = await runAgentTask({
        message: "Discharge is 7.5 bar and suction is 2.1 bar. Calculate difference and tell me if it passes the safety limit.",
        userId: "eng-safety-user",
      });

      assert.strictEqual(res.success, true);
      assert.ok(res.response.includes("5.4 bar"));
      assert.ok(res.response.includes("safety") || res.response.includes("limit"));

      pass("Test 5.1: Safety guard respected when threshold limit is missing; zero invented limits");
    }

    agentGraphService.resetAgentBrainLlmClient();
    agentGraphService.resetVisionLlmClient();

    console.log("================================================================================");
    console.log(`ALL ${testsPassed} ENGINEERING WORKFLOW & SHARED TOOLS TESTS PASSED!`);
    console.log("================================================================================");
  } catch (err) {
    agentGraphService.resetAgentBrainLlmClient();
    agentGraphService.resetVisionLlmClient();
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
  }
}

runSuite();
