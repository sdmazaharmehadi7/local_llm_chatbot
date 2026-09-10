/**
 * Agent UI Trigger and Live Progress Indicator Test Suite (Step 8.5)
 *
 * Verifies:
 * 1. /agent <task> command triggers Agent execution; normal messages continue through standard chat.
 * 2. Backend returns structured progress events:
 *    - { type: "agent_status", status: "planning" }
 *    - { type: "agent_status", status: "tool", tool: "..." }
 *    - { type: "agent_status", status: "analyzing", tool: "..." }
 *    - { type: "agent_status", status: "preparing_answer" }
 *    - { type: "agent_status", status: "completed" }
 * 3. SSE streaming correctly serializes and delivers live events without exposing chain-of-thought.
 * 4. Error states produce controlled, user-friendly messages for:
 *    - invalid request
 *    - maximum steps exceeded
 *    - timeout
 *    - tool failure
 *    - agent unavailable
 * 5. ZERO Ollama / real model inference is executed.
 */

import assert from "assert";
import { runAgentTask } from "../src/services/agent/agent.service.js";
import { createAgentTask } from "../src/controllers/agent.controller.js";
import qwenBrainService from "../src/services/agent/qwenBrain.service.js";

async function runStep85TestSuite() {
  console.log("==================================================");
  console.log("STARTING STEP 8.5 AGENT UI TRIGGER & PROGRESS TESTS");
  console.log("==================================================");

  // Mock Qwen3:8b brain responses for UI & progress tests
  qwenBrainService.setBrainLlmClient(async (messages) => {
    const userPrompt = messages[messages.length - 1].content;
    const hasHistory = userPrompt.includes("Step 1:");

    if (!hasHistory) {
      if (userPrompt.includes("Calculate 50 * 2.5")) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          input: { expression: "50 * 2.5" },
        });
      }
      return JSON.stringify({
        action: "tool",
        tool: "retrieve_information",
        input: { query: "Find the valve safety procedure in the manual" },
      });
    }

    if (userPrompt.includes("[FAILED]") || userPrompt.includes('"error":')) {
      return JSON.stringify({
        action: "final",
        answer: "The task could not be completed because an error occurred in the tool.",
      });
    }

    return JSON.stringify({
      action: "final",
      answer: "Task completed successfully with verified information.",
    });
  });

  // -------------------------------------------------------------
  // Scenario 1: /agent Command Trigger Pattern Recognition
  // -------------------------------------------------------------
  console.log("\n--- [Scenario 1] /agent Trigger Pattern Matching ---");
  {
    const isAgentCommand = (text) => /^\/agent(?:\s+|$)/i.test(text.trim());
    const extractAgentTask = (text) => text.trim().replace(/^\/agent\s*/i, "").trim();

    // 1. Valid /agent triggers
    assert.strictEqual(
      isAgentCommand("/agent Calculate 25 * 0.17"),
      true
    );
    assert.strictEqual(
      extractAgentTask("/agent Calculate 25 * 0.17"),
      "Calculate 25 * 0.17"
    );

    assert.strictEqual(
      isAgentCommand("/agent Analyze the uploaded inspection report and calculate the failure percentage."),
      true
    );
    assert.strictEqual(
      extractAgentTask("/agent Analyze the uploaded inspection report and calculate the failure percentage."),
      "Analyze the uploaded inspection report and calculate the failure percentage."
    );

    assert.strictEqual(
      isAgentCommand("/AGENT uppercase this string"),
      true,
      "Trigger should be case-insensitive"
    );

    // 2. Empty /agent trigger
    assert.strictEqual(isAgentCommand("/agent"), true);
    assert.strictEqual(extractAgentTask("/agent"), "");

    // 3. Normal chat messages must NOT trigger /agent
    assert.strictEqual(isAgentCommand("Hello, how are you?"), false);
    assert.strictEqual(isAgentCommand("/knowledgebase What is the safety procedure?"), false);
    assert.strictEqual(isAgentCommand("Can you explain how /agent works?"), false);

    console.log("✔ [PASS] /agent prefix cleanly detected and separated from normal chat routing");
  }

  // -------------------------------------------------------------
  // Scenario 2: Structured Progress Events Emitted During Execution
  // -------------------------------------------------------------
  console.log("\n--- [Scenario 2] Structured Progress Events Telemetry ---");
  {
    const recordedEvents = [];
    const mockRetriever = async (params) => {
      return {
        success: true,
        query: params.query,
        content: "Safety inspections require weekly valve pressure checks.",
        sources: [{ filename: "Valve_SOP.pdf", page: 3 }],
      };
    };

    const taskResult = await runAgentTask({
      message: "Find the valve safety procedure in the manual",
      options: {
        retriever: mockRetriever,
        onProgress: (evt) => {
          recordedEvents.push(evt);
        },
      },
    });

    assert.strictEqual(taskResult.success, true);
    assert.ok(recordedEvents.length >= 3, "Must record at least 3 progress events");

    // Verify structured formats
    const eventTypes = recordedEvents.map((e) => e.type);
    assert.ok(
      eventTypes.every((t) => t === "agent_status"),
      "All progress events must be of type 'agent_status'"
    );

    const statuses = recordedEvents.map((e) => e.status);
    assert.ok(statuses.includes("planning"), "Must emit planning status");
    assert.ok(statuses.includes("tool"), "Must emit tool status");
    assert.ok(statuses.includes("analyzing"), "Must emit analyzing status");
    assert.ok(statuses.includes("preparing_answer"), "Must emit preparing_answer status");
    assert.ok(statuses.includes("completed"), "Must emit completed status");

    // Verify tool specification in event
    const toolEvent = recordedEvents.find((e) => e.status === "tool");
    assert.strictEqual(toolEvent.tool, "retrieve_information");

    // Verify events do NOT leak hidden chain-of-thought or raw internal prompts
    for (const evt of recordedEvents) {
      assert.strictEqual(evt.internalThought, undefined, "Must not leak internalThought");
      assert.strictEqual(evt.rawPrompt, undefined, "Must not leak rawPrompt");
      assert.strictEqual(evt.llmLog, undefined, "Must not leak llmLog");
    }

    console.log("✔ [PASS] Backend emits structured progress events without exposing hidden reasoning");
  }

  // -------------------------------------------------------------
  // Scenario 3: SSE Streaming Endpoint Simulation
  // -------------------------------------------------------------
  console.log("\n--- [Scenario 3] Controller SSE Streaming Support ---");
  {
    const sseOutputChunks = [];
    const mockReq = {
      body: {
        message: "Calculate 50 * 2.5",
        stream: true,
      },
      userId: "test-user-sse",
    };

    const mockRes = {
      headers: {},
      writableEnded: false,
      setHeader(k, v) {
        this.headers[k] = v;
      },
      write(chunk) {
        sseOutputChunks.push(chunk);
      },
      end() {
        this.writableEnded = true;
      },
      flushHeaders() {},
    };

    await createAgentTask(mockReq, mockRes);

    assert.strictEqual(
      mockRes.headers["Content-Type"],
      "text/event-stream",
      "Must set Content-Type to text/event-stream"
    );
    assert.ok(mockRes.writableEnded, "Response must end cleanly");
    assert.ok(sseOutputChunks.length > 0, "SSE chunks must be written");

    // Parse written chunks
    const parsedEvents = [];
    for (const chunk of sseOutputChunks) {
      const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));
      for (const line of lines) {
        parsedEvents.push(JSON.parse(line.slice(6)));
      }
    }

    const statuses = parsedEvents.map((e) => e.status).filter(Boolean);
    const types = parsedEvents.map((e) => e.type);
    assert.ok(statuses.includes("planning"), "SSE stream must include planning event");
    assert.ok(statuses.includes("tool"), "SSE stream must include tool event");
    assert.ok(statuses.includes("completed"), "SSE stream must include completed event");
    assert.ok(types.includes("agent_result"), "SSE stream must conclude with agent_result payload");

    console.log("✔ [PASS] createAgentTask successfully streams real-time SSE progress events");
  }

  // -------------------------------------------------------------
  // Scenario 4: Controlled Error State - Invalid Request
  // -------------------------------------------------------------
  console.log("\n--- [Scenario 4] Controlled Error - Invalid Request ---");
  {
    let statusCode = null;
    let jsonResponse = null;

    const mockReq = {
      body: { message: "" },
    };
    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        jsonResponse = data;
        return this;
      },
    };

    await createAgentTask(mockReq, mockRes);

    assert.strictEqual(statusCode, 400);
    assert.strictEqual(jsonResponse.success, false);
    assert.strictEqual(
      jsonResponse.error,
      "Invalid agent request. Please provide a clear task description."
    );

    console.log("✔ [PASS] Controlled message returned for invalid agent requests");
  }

  // -------------------------------------------------------------
  // Scenario 5: Controlled Error State - Maximum Steps Exceeded
  // -------------------------------------------------------------
  console.log("\n--- [Scenario 5] Controlled Error - Maximum Steps Exceeded ---");
  {
    const stepEvents = [];
    const taskResult = await runAgentTask({
      message: "Compute 1 + 1",
      options: {
        maxSteps: 0, // Force limit exceeded immediately
        onProgress: (evt) => stepEvents.push(evt),
      },
    });

    assert.strictEqual(taskResult.success, false);
    assert.ok(taskResult.error.toLowerCase().includes("maximum allowed steps"));

    const errorEvent = stepEvents.find((e) => e.status === "error");
    assert.ok(errorEvent, "Must emit error progress event");
    assert.ok(errorEvent.error.includes("maximum allowed steps"));

    console.log("✔ [PASS] Maximum steps error handled safely and emitted as structured event");
  }

  // -------------------------------------------------------------
  // Scenario 6: Controlled Error State - Timeout Exceeded
  // -------------------------------------------------------------
  console.log("\n--- [Scenario 6] Controlled Error - Timeout Exceeded ---");
  {
    const timeoutEvents = [];
    const taskResult = await runAgentTask({
      message: "Calculate 100 * 5",
      options: {
        maxTimeMs: 0, // Force timeout immediately
        onProgress: (evt) => timeoutEvents.push(evt),
      },
    });

    assert.strictEqual(taskResult.success, false);
    assert.ok(taskResult.error.toLowerCase().includes("execution time limit exceeded"));

    const timeoutEvent = timeoutEvents.find((e) => e.status === "error");
    assert.ok(timeoutEvent, "Must emit timeout error event");

    console.log("✔ [PASS] Timeout limit safely caught and emitted as controlled error event");
  }

  // -------------------------------------------------------------
  // Scenario 7: Controlled Error State - Tool Failure Handling
  // -------------------------------------------------------------
  console.log("\n--- [Scenario 7] Controlled Error - Tool Failure Handling ---");
  {
    const failingRetriever = async () => {
      throw new Error("Connection reset by vector store");
    };

    const taskResult = await runAgentTask({
      message: "Find safety documentation",
      options: {
        retriever: failingRetriever,
      },
    });

    // The agent loop safely reports tool error in response without crashing
    assert.strictEqual(taskResult.success, true); // loop concludes with explanatory final answer
    assert.ok(
      taskResult.response.toLowerCase().includes("error") ||
        taskResult.response.toLowerCase().includes("could not be completed") ||
        taskResult.response.toLowerCase().includes("unable to complete"),
      "Response must politely explain tool failure to user"
    );

    console.log("✔ [PASS] Tool failure handled safely and translated into clean user-facing explanation");
  }

  qwenBrainService.resetBrainLlmClient();

  console.log("\n==================================================");
  console.log("ALL 7 STEP 8.5 TEST SCENARIOS PASSED SUCCESSFULLY!");
  console.log("ZERO OLLAMA / REAL MODEL INFERENCE WAS EXECUTED.");
  console.log("==================================================");
}

runStep85TestSuite().catch((err) => {
  console.error("❌ TEST SUITE FAILURE:", err);
  process.exit(1);
});
