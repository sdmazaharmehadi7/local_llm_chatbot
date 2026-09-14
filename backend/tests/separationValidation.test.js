/**
 * Verification Test Suite: Clean Separation of /agent and /workflow
 *
 * Validates:
 * 1. /agent simple question (direct answer, no workflow selected, no workflow logs)
 * 2. /agent calculator question (tool execution, no workflow selected, no workflow logs)
 * 3. /workflow simple question (workflow selection occurs -> general, workflow logs present)
 * 4. /workflow retrieval question (workflow selection occurs -> knowledge_retrieval)
 * 5. /workflow retrieval + calculator question (workflow selection occurs -> retrieval_calculation)
 * 6. /workflow retrieval + calculator + unit conversion question (multiple sequential tools)
 * 7. /workflow vision + calculator question (vision_calculation workflow)
 * 8. Streaming on both endpoints independently
 */

import assert from "assert";
import { runAgentTask } from "../src/services/agent/agent.service.js";
import { runWorkflowTask } from "../src/services/workflow/workflow.service.js";
import { agentGraphService } from "../src/services/agent/agentGraph.service.js";
import { workflowGraphService } from "../src/services/workflow/workflowGraph.service.js";
import { createAgentTask } from "../src/controllers/agent.controller.js";
import { createWorkflowTask } from "../src/controllers/workflow.controller.js";
import { WORKFLOW_TYPES } from "../src/services/agent/agent.types.js";

console.log("================================================================================");
console.log("RUNNING SEPARATION VALIDATION SUITE: /agent vs /workflow");
console.log("================================================================================");

let testsPassed = 0;
function pass(name) {
  testsPassed++;
  console.log(`✔ [PASS] ${name}`);
}

async function runSuite() {
  try {
    // ───────────────────────────────────────────────────────────────────────────
    // SCENARIO 1: /agent simple question
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Scenario 1] /agent simple question ---");
    {
      const capturedLogs = [];
      const originalLog = console.log;
      console.log = (...args) => {
        capturedLogs.push(args.join(" "));
        originalLog(...args);
      };

      try {
        agentGraphService.setAgentBrainLlmClient(async () => {
          return JSON.stringify({
            action: "final",
            reason: "Explain what an API is directly.",
            answer: "An API (Application Programming Interface) enables software components to communicate.",
          });
        });

        let statusCode = 0;
        let responseBody = null;
        const mockRes = {
          status: (code) => {
            statusCode = code;
            return {
              json: (body) => {
                responseBody = body;
              },
            };
          },
        };

        await createAgentTask({ body: { message: "Explain what an API is." } }, mockRes);

        assert.strictEqual(statusCode, 200);
        assert.strictEqual(responseBody.success, true);
        assert.strictEqual(responseBody.framework, "langgraph");
        assert.strictEqual(responseBody.workflow, undefined, "/agent response must NOT contain workflow metadata");
        assert.ok(responseBody.response.includes("API"));

        // Verify NO workflow logs appeared
        const allLogs = capturedLogs.join("\n");
        assert.ok(!allLogs.includes("[Workflow]"), "/agent execution must NOT output [Workflow] logs");
        assert.ok(!allLogs.includes("Completed:"), "/agent execution must NOT log workflow completion");

        pass("Scenario 1 passed: /agent simple question uses Simple Agent, 0 tools, no workflow selected, no workflow logs");
      } finally {
        console.log = originalLog;
      }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // SCENARIO 2: /agent calculator question
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Scenario 2] /agent calculator question ---");
    {
      const capturedLogs = [];
      const originalLog = console.log;
      console.log = (...args) => {
        capturedLogs.push(args.join(" "));
        originalLog(...args);
      };

      try {
        let step = 0;
        agentGraphService.setAgentBrainLlmClient(async () => {
          step++;
          if (step === 1) {
            return JSON.stringify({
              action: "tool",
              tool: "calculator",
              reason: "Compute 120 * 3 directly.",
              input: { expression: "120 * 3" },
            });
          }
          return JSON.stringify({
            action: "final",
            reason: "Calculation complete.",
            answer: "The result is 360.",
          });
        });

        let statusCode = 0;
        let responseBody = null;
        const mockRes = {
          status: (code) => {
            statusCode = code;
            return {
              json: (body) => {
                responseBody = body;
              },
            };
          },
        };

        await createAgentTask({ body: { message: "Calculate 120 * 3" } }, mockRes);

        assert.strictEqual(statusCode, 200);
        assert.strictEqual(responseBody.success, true);
        assert.strictEqual(responseBody.framework, "langgraph");
        assert.strictEqual(responseBody.workflow, undefined, "/agent response must NOT contain workflow metadata");
        assert.strictEqual(responseBody.steps.length, 1);
        assert.strictEqual(responseBody.steps[0].toolName, "calculator");
        assert.ok(responseBody.response.includes("360"));

        const allLogs = capturedLogs.join("\n");
        assert.ok(!allLogs.includes("[Workflow]"), "/agent execution must NOT output [Workflow] logs");
        assert.ok(!allLogs.includes("Completed:"), "/agent execution must NOT log workflow completion");

        pass("Scenario 2 passed: /agent calculator question executes tool directly with no workflow routing or logs");
      } finally {
        console.log = originalLog;
      }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // SCENARIO 3: /workflow simple question
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Scenario 3] /workflow simple question ---");
    {
      const capturedLogs = [];
      const originalLog = console.log;
      console.log = (...args) => {
        capturedLogs.push(args.join(" "));
        originalLog(...args);
      };

      try {
        workflowGraphService.setAgentBrainLlmClient(async () => {
          return JSON.stringify({
            workflow: "general",
            action: "final",
            reason: "Conceptual question directly answered under general workflow.",
            answer: "Cavitation occurs when local static pressure falls below vapor pressure.",
          });
        });

        let statusCode = 0;
        let responseBody = null;
        const mockRes = {
          status: (code) => {
            statusCode = code;
            return {
              json: (body) => {
                responseBody = body;
              },
            };
          },
        };

        await createWorkflowTask({ body: { message: "Explain pump cavitation." } }, mockRes);

        assert.strictEqual(statusCode, 200);
        assert.strictEqual(responseBody.success, true);
        assert.strictEqual(responseBody.framework, "langgraph-workflows");
        assert.strictEqual(responseBody.workflow?.type, WORKFLOW_TYPES.GENERAL);
        assert.strictEqual(responseBody.steps.length, 0);

        const allLogs = capturedLogs.join("\n");
        assert.ok(allLogs.includes("[Workflow]"), "/workflow execution MUST output [Workflow] log");
        assert.ok(allLogs.includes("Completed: general"), "/workflow execution MUST log workflow completion");

        pass("Scenario 3 passed: /workflow simple question selects 'general' workflow and outputs workflow metadata");
      } finally {
        console.log = originalLog;
      }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // SCENARIO 4: /workflow retrieval question
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Scenario 4] /workflow retrieval question ---");
    {
      const capturedLogs = [];
      const originalLog = console.log;
      console.log = (...args) => {
        capturedLogs.push(args.join(" "));
        originalLog(...args);
      };

      try {
        let step = 0;
        workflowGraphService.setAgentBrainLlmClient(async () => {
          step++;
          if (step === 1) {
            return JSON.stringify({
              workflow: "knowledge_retrieval",
              action: "tool",
              tool: "retrieve_information",
              reason: "Retrieve P-204 specs.",
              input: { query: "P-204 suction pressure" },
            });
          }
          return JSON.stringify({
            workflow: "knowledge_retrieval",
            action: "final",
            reason: "Answer based on retrieved knowledge.",
            answer: "According to specifications, the suction pressure for P-204 is 1.8 bar.",
          });
        });

        const mockRetriever = async () => ({
          results: [{ filename: "P204_Specs.pdf", page: 1, text: "Pump P-204 suction pressure is 1.8 bar." }],
        });

        const res = await runWorkflowTask({
          message: "What is the suction pressure of P-204 according to documentation?",
          userId: "val-user",
          options: { retriever: mockRetriever },
        });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.framework, "langgraph-workflows");
        assert.strictEqual(res.workflow?.type, WORKFLOW_TYPES.KNOWLEDGE_RETRIEVAL);
        assert.strictEqual(res.steps.length, 1);
        assert.strictEqual(res.steps[0].toolName, "retrieve_information");

        const allLogs = capturedLogs.join("\n");
        assert.ok(allLogs.includes("Completed: knowledge_retrieval"));

        pass("Scenario 4 passed: /workflow retrieval question selects 'knowledge_retrieval' workflow");
      } finally {
        console.log = originalLog;
      }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // SCENARIO 5: /workflow retrieval + calculator question
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Scenario 5] /workflow retrieval + calculator question ---");
    {
      const capturedLogs = [];
      const originalLog = console.log;
      console.log = (...args) => {
        capturedLogs.push(args.join(" "));
        originalLog(...args);
      };

      try {
        let step = 0;
        workflowGraphService.setAgentBrainLlmClient(async () => {
          step++;
          if (step === 1) {
            return JSON.stringify({
              workflow: "retrieval_calculation",
              action: "tool",
              tool: "retrieve_information",
              reason: "Retrieve suction and discharge pressures.",
              input: { query: "P-204 suction discharge" },
            });
          }
          if (step === 2) {
            return JSON.stringify({
              workflow: "retrieval_calculation",
              action: "tool",
              tool: "calculator",
              reason: "Calculate differential 7.2 - 1.8.",
              input: { expression: "7.2 - 1.8" },
            });
          }
          return JSON.stringify({
            workflow: "retrieval_calculation",
            action: "final",
            reason: "Final differential answer.",
            answer: "The pressure differential for P-204 is 5.4 bar (7.2 - 1.8).",
          });
        });

        const mockRetriever = async () => ({
          results: [{ filename: "P204_Specs.pdf", page: 2, text: "Suction = 1.8 bar, Discharge = 7.2 bar." }],
        });

        const res = await runWorkflowTask({
          message: "According to the knowledge base, calculate the pressure differential for P-204.",
          userId: "val-user",
          options: { retriever: mockRetriever },
        });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.workflow?.type, WORKFLOW_TYPES.RETRIEVAL_CALCULATION);
        assert.strictEqual(res.steps.length, 2);
        assert.strictEqual(res.steps[0].toolName, "retrieve_information");
        assert.strictEqual(res.steps[1].toolName, "calculator");
        assert.ok(res.response.includes("5.4"));

        const allLogs = capturedLogs.join("\n");
        assert.ok(allLogs.includes("Completed: retrieval_calculation"));

        pass("Scenario 5 passed: /workflow retrieval + calculation sequences Retrieval -> Calculator under 'retrieval_calculation'");
      } finally {
        console.log = originalLog;
      }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // SCENARIO 6: /workflow retrieval + calculator + unit conversion question
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Scenario 6] /workflow retrieval + calculator + unit conversion ---");
    {
      const capturedLogs = [];
      const originalLog = console.log;
      console.log = (...args) => {
        capturedLogs.push(args.join(" "));
        originalLog(...args);
      };

      try {
        let step = 0;
        workflowGraphService.setAgentBrainLlmClient(async () => {
          step++;
          if (step === 1) {
            return JSON.stringify({
              workflow: "retrieval_calculation",
              action: "tool",
              tool: "retrieve_information",
              reason: "Retrieve pressure values.",
              input: { query: "P-204 pressures" },
            });
          }
          if (step === 2) {
            return JSON.stringify({
              workflow: "retrieval_calculation",
              action: "tool",
              tool: "calculator",
              reason: "Compute differential: 7.2 - 1.8",
              input: { expression: "7.2 - 1.8" },
            });
          }
          if (step === 3) {
            return JSON.stringify({
              workflow: "retrieval_calculation",
              action: "tool",
              tool: "unit_converter",
              reason: "Convert differential 5.4 bar to psi.",
              input: { value: 5.4, fromUnit: "bar", toUnit: "psi" },
            });
          }
          return JSON.stringify({
            workflow: "retrieval_calculation",
            action: "final",
            reason: "Complete multi-tool conversion response.",
            answer: "The pressure differential of P-204 is 5.4 bar, which converts to 78.32 psi.",
          });
        });

        const mockRetriever = async () => ({
          results: [{ filename: "P204_Specs.pdf", page: 2, text: "Suction = 1.8 bar, Discharge = 7.2 bar." }],
        });

        const res = await runWorkflowTask({
          message: "Calculate the pressure differential of P-204 from the knowledge base and convert it to psi.",
          userId: "val-user",
          options: { retriever: mockRetriever },
        });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.steps.length, 3);
        assert.strictEqual(res.steps[0].toolName, "retrieve_information");
        assert.strictEqual(res.steps[1].toolName, "calculator");
        assert.strictEqual(res.steps[2].toolName, "unit_converter");
        assert.ok(res.response.includes("78.32"));

        pass("Scenario 6 passed: /workflow multi-tool sequences Retrieval -> Calculator -> Unit Converter seamlessly");
      } finally {
        console.log = originalLog;
      }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // SCENARIO 7: /workflow vision + calculator question
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Scenario 7] /workflow vision + calculator question ---");
    {
      const capturedLogs = [];
      const originalLog = console.log;
      console.log = (...args) => {
        capturedLogs.push(args.join(" "));
        originalLog(...args);
      };

      try {
        let step = 0;
        workflowGraphService.setAgentBrainLlmClient(async () => {
          step++;
          if (step === 1) {
            return JSON.stringify({
              workflow: "vision_calculation",
              action: "tool",
              tool: "vision",
              reason: "Read motor nameplate specs.",
              input: { prompt: "Read motor power and speed" },
            });
          }
          if (step === 2) {
            return JSON.stringify({
              workflow: "vision_calculation",
              action: "tool",
              tool: "calculator",
              reason: "Calculate torque: 22 * 9550 / 960",
              input: { expression: "22 * 9550 / 960" },
            });
          }
          return JSON.stringify({
            workflow: "vision_calculation",
            action: "final",
            reason: "Provide verified torque calculation.",
            answer: "Based on the nameplate, the motor produces 218.85 Nm of torque.",
          });
        });

        const mockVisionClient = async () => ({
          success: true,
          analysis: "Nameplate: Power = 22 kW, Speed = 960 RPM",
        });

        const res = await runWorkflowTask({
          message: "From this nameplate image, calculate the operating torque.",
          userId: "val-user",
          images: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="],
          options: { visionClient: mockVisionClient },
        });

        assert.strictEqual(res.success, true);
        assert.strictEqual(res.workflow?.type, WORKFLOW_TYPES.VISION_CALCULATION);
        assert.strictEqual(res.steps.length, 2);
        assert.strictEqual(res.steps[0].toolName, "vision");
        assert.strictEqual(res.steps[1].toolName, "calculator");
        assert.ok(res.response.includes("218.85"));

        const allLogs = capturedLogs.join("\n");
        assert.ok(allLogs.includes("Completed: vision_calculation"));

        pass("Scenario 7 passed: /workflow vision + calculator chains Vision -> Calculator under 'vision_calculation'");
      } finally {
        console.log = originalLog;
      }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // SCENARIO 8: Streaming validation on both endpoints
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n--- [Scenario 8] Streaming on /agent and /workflow ---");
    {
      // /agent streaming
      agentGraphService.setAgentBrainLlmClient(async () => {
        return JSON.stringify({ action: "final", answer: "Simple agent streamed." });
      });
      const agentChunks = [];
      const mockAgentSse = {
        setHeader: () => {},
        flushHeaders: () => {},
        write: (chunk) => agentChunks.push(chunk),
        end: () => {},
      };
      await createAgentTask({ body: { message: "Test streaming", stream: true } }, mockAgentSse);
      const agentStreamOutput = agentChunks.join("");
      assert.ok(agentStreamOutput.includes("agent_start"));
      assert.ok(agentStreamOutput.includes("agent_complete"));
      assert.ok(!agentStreamOutput.includes("workflow_start"), "/agent stream must NOT emit workflow_start");
      pass("Scenario 8.1 passed: /agent streaming emits pure agent SSE events (no workflow events)");

      // /workflow streaming
      workflowGraphService.setAgentBrainLlmClient(async () => {
        return JSON.stringify({ workflow: "general", action: "final", answer: "Workflow agent streamed." });
      });
      const workflowChunks = [];
      const mockWorkflowSse = {
        setHeader: () => {},
        flushHeaders: () => {},
        write: (chunk) => workflowChunks.push(chunk),
        end: () => {},
      };
      await createWorkflowTask({ body: { message: "Test streaming", stream: true } }, mockWorkflowSse);
      const workflowStreamOutput = workflowChunks.join("");
      assert.ok(workflowStreamOutput.includes("workflow_start"));
      assert.ok(workflowStreamOutput.includes("workflow_complete"));
      assert.ok(workflowStreamOutput.includes("general"));
      pass("Scenario 8.2 passed: /workflow streaming emits workflow SSE events with workflow metadata");
    }

    console.log("\n================================================================================");
    console.log(`ALL ${testsPassed} SEPARATION VALIDATION TESTS PASSED!`);
    console.log("================================================================================");
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
    workflowGraphService.resetAgentBrainLlmClient();
  }
}

runSuite().catch((err) => {
  console.error("VALIDATION TEST FAILED:", err);
  process.exit(1);
});
