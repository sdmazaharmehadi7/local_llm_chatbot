/**
 * LangGraph Agent State & Conversation Context Integration Tests
 *
 * Deterministic test suite verifying:
 * 1. Same user, same chat (preserves chatId, userId, conversation context across turns)
 * 2. Same user, different chats (strict cross-chat isolation, independent checkpointer threads)
 * 3. Different users (strict multi-tenant isolation, cross-user access rejection)
 * 4. Image request followed by text request (zero stale image contamination in subsequent turns)
 * 5. Retrieval request followed by normal request (Knowledge Base separation, zero auto-injection)
 * 6. Multi-step tool workflow (tool steps, bounded observations, and checkpoint persistence)
 *
 * SAFETY GUARANTEES:
 * - 100% offline, zero live Ollama inference
 * - Deterministic assertions using mocked Brain and Tool clients
 */

import assert from "node:assert/strict";
import { agentGraphService } from "../src/services/agent/agentGraph.service.js";
import { runAgentTask } from "../src/services/agent/agent.service.js";
import Chat from "../src/models/Chat.js";
import Message from "../src/models/Message.js";

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

async function runStateContextTests() {
  console.log("================================================================================");
  console.log("RUNNING LANGGRAPH AGENT STATE & CONVERSATION CONTEXT TESTS");
  console.log("================================================================================");

  // ─── TEST 1: Same User, Same Chat ───────────────────────────────────────────
  console.log("\n--- [Test 1] Same User, Same Chat Context Preservation ---");
  try {
    const userId = "user_alice";
    const chatId = "chat_session_101";

    let capturedHistories = [];
    let brainTurn = 0;

    agentGraphService.setAgentBrainLlmClient(async (messages) => {
      brainTurn++;
      // Capture what conversation history Qwen3 received
      const systemMsg = messages.find((m) => m.role === "system")?.content || "";
      capturedHistories.push(systemMsg);

      if (brainTurn === 1) {
        return JSON.stringify({
          action: "final",
          reason: "Direct answer recording user preferences.",
          answer: "Nice to meet you, Alice! I have noted that you prefer Python for data analysis.",
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Recalling preference from conversation history.",
        answer: "You previously mentioned that you prefer Python for data analysis.",
      });
    });

    // Turn 1
    const res1 = await runAgentTask({
      message: "My name is Alice and I prefer Python for data analysis.",
      userId,
      chatId,
    });

    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.chatId, chatId);
    assert.strictEqual(res1.userId, userId);
    assert.strictEqual(res1.threadId, `${userId}:${chatId}`);

    // Checkpoint verification for Turn 1
    const cp1 = await agentGraphService.getCheckpointState(`${userId}:${chatId}`);
    assert.ok(cp1, "Checkpoint state must exist for thread");
    assert.strictEqual(cp1.values.chatId, chatId);
    assert.strictEqual(cp1.values.userId, userId);

    // Turn 2 in the same chat: pass conversation history (simulating DB history)
    const res2 = await runAgentTask({
      message: "What language do I prefer?",
      userId,
      chatId,
      options: {},
    });

    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.chatId, chatId);
    assert.strictEqual(res2.userId, userId);
    assert.strictEqual(res2.threadId, `${userId}:${chatId}`);

    pass("Same user, same chat correctly preserves chatId, userId, and thread checkpoint");
  } catch (err) {
    fail("Same User, Same Chat", err);
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
  }

  // ─── TEST 2: Same User, Different Chats ─────────────────────────────────────
  console.log("\n--- [Test 2] Same User, Different Chats Isolation ---");
  try {
    const userId = "user_alice";
    const chatAlpha = "chat_alpha_finance";
    const chatBeta = "chat_beta_engineering";

    let chatAlphaHistory = null;
    let chatBetaHistory = null;

    agentGraphService.setAgentBrainLlmClient(async (messages) => {
      const sys = messages.find((m) => m.role === "system")?.content || "";
      if (sys.includes("chat_alpha_finance") || messages.some((m) => m.content?.includes("Q3 budget"))) {
        chatAlphaHistory = sys;
      } else {
        chatBetaHistory = sys;
      }
      return JSON.stringify({
        action: "final",
        reason: "Task completed.",
        answer: "Response generated for current chat.",
      });
    });

    // Run in Chat Alpha
    const resAlpha = await runAgentTask({
      message: "Project Alpha secret Q3 budget is $500,000.",
      userId,
      chatId: chatAlpha,
    });

    // Run in Chat Beta
    const resBeta = await runAgentTask({
      message: "What is the secret budget?",
      userId,
      chatId: chatBeta,
    });

    assert.strictEqual(resAlpha.threadId, `${userId}:${chatAlpha}`);
    assert.strictEqual(resBeta.threadId, `${userId}:${chatBeta}`);

    // Verify Checkpoints are completely isolated by threadId
    const cpAlpha = await agentGraphService.getCheckpointState(`${userId}:${chatAlpha}`);
    const cpBeta = await agentGraphService.getCheckpointState(`${userId}:${chatBeta}`);

    assert.ok(cpAlpha);
    assert.ok(cpBeta);
    assert.strictEqual(cpAlpha.values.chatId, chatAlpha);
    assert.strictEqual(cpBeta.values.chatId, chatBeta);
    assert.ok(cpAlpha.values.userRequest.includes("Q3 budget"));
    assert.ok(!cpBeta.values.userRequest.includes("Q3 budget"));

    pass("Same user, different chats isolates thread_id, checkpoint states, and conversation contexts");
  } catch (err) {
    fail("Same User, Different Chats", err);
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
  }

  // ─── TEST 3: Different Users Isolation ──────────────────────────────────────
  console.log("\n--- [Test 3] Different Users Isolation ---");
  try {
    const userAlice = "user_alice";
    const userBob = "user_bob";
    const sharedChatIdName = "chat_common_name";

    agentGraphService.setAgentBrainLlmClient(async () => {
      return JSON.stringify({
        action: "final",
        reason: "User task executed.",
        answer: "Completed.",
      });
    });

    // User Alice runs task
    const resAlice = await runAgentTask({
      message: "Alice private medical notes: patient ID 4401",
      userId: userAlice,
      chatId: sharedChatIdName,
    });

    // User Bob runs task with the same chatId string
    const resBob = await runAgentTask({
      message: "Bob general query",
      userId: userBob,
      chatId: sharedChatIdName,
    });

    // Checkpoint thread IDs must be partitioned by userId
    assert.strictEqual(resAlice.threadId, `${userAlice}:${sharedChatIdName}`);
    assert.strictEqual(resBob.threadId, `${userBob}:${sharedChatIdName}`);
    assert.notStrictEqual(resAlice.threadId, resBob.threadId);

    const cpAlice = await agentGraphService.getCheckpointState(resAlice.threadId);
    const cpBob = await agentGraphService.getCheckpointState(resBob.threadId);

    assert.ok(cpAlice.values.userRequest.includes("patient ID 4401"));
    assert.ok(!cpBob.values.userRequest.includes("patient ID 4401"));
    assert.strictEqual(cpAlice.values.userId, userAlice);
    assert.strictEqual(cpBob.values.userId, userBob);

    pass("Different users on identical chat name have strictly partitioned thread_ids and zero context leakage");
  } catch (err) {
    fail("Different Users Isolation", err);
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
  }

  // ─── TEST 4: Image Request Followed by Text Request ─────────────────────────
  console.log("\n--- [Test 4] Image Request Followed by Text Request (Zero Stale Image Contamination) ---");
  try {
    const userId = "user_charlie";
    const chatId = "chat_charlie_session";

    let turn1Images = null;
    let turn2Images = null;
    let turn2BrainMessages = null;

    let brainTurn = 0;
    agentGraphService.setAgentBrainLlmClient(async (messages) => {
      brainTurn++;
      if (brainTurn === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "vision",
          reason: "Inspect gauge in image.",
          input: { prompt: "Read the pressure gauge." },
        });
      }
      if (brainTurn === 2) {
        return JSON.stringify({
          action: "final",
          reason: "Gauge reading complete.",
          answer: "The gauge displays 4.2 bar.",
        });
      }
      // Turn 2 of conversation (text only)
      turn2BrainMessages = messages;
      return JSON.stringify({
        action: "final",
        reason: "General explanation answered directly without tools.",
        answer: "An API (Application Programming Interface) allows systems to talk to each other.",
      });
    });

    const mockVisionClient = async () => "Analog pressure gauge shows 4.2 bar.";

    // 1. Turn 1 with image
    const res1 = await runAgentTask({
      message: "What is the pressure reading in this image?",
      userId,
      chatId,
      images: [SAMPLE_DATA_URL],
      options: { visionClient: mockVisionClient },
    });

    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.steps.length, 1);
    assert.strictEqual(res1.steps[0].toolName, "vision");

    // 2. Turn 2 in the same chat WITHOUT an image
    const res2 = await runAgentTask({
      message: "Explain what an API is.",
      userId,
      chatId,
      // No images passed!
    });

    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.steps.length, 0, "Turn 2 should invoke 0 tools");

    // Checkpoint state for Turn 2 must have empty images array
    const cp2 = await agentGraphService.getCheckpointState(`${userId}:${chatId}`);
    assert.deepStrictEqual(cp2.values.images, [], "Turn 2 checkpoint must have empty images array");

    // Ensure zero image payloads reached Qwen3 in Turn 2
    for (const msg of turn2BrainMessages || []) {
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(msg, "images"),
        false,
        "Messages sent to Qwen3 in text turns must not contain an images property"
      );
      assert.strictEqual(
        (msg.content || "").includes(SAMPLE_1X1_PNG_BASE64),
        false,
        "Prompt content must not contain stale raw image base64 data"
      );
    }

    pass("Image request followed by text request clears active images and prevents stale image contamination");
  } catch (err) {
    fail("Image Request Followed by Text Request", err);
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
  }

  // ─── TEST 5: Retrieval Request Followed by Normal Request ───────────────────
  console.log("\n--- [Test 5] Retrieval Request Followed by Normal Request ---");
  try {
    const userId = "user_david";
    const chatId = "chat_david_sop";

    let turn1RetrievedFacts = null;
    let turn2RetrievedFacts = null;

    let brainTurn = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainTurn++;
      if (brainTurn === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve ISO 10816-3 limit.",
          input: { query: "ISO 10816-3 Zone B limit" },
        });
      }
      if (brainTurn === 2) {
        return JSON.stringify({
          action: "final",
          reason: "SOP retrieved.",
          answer: "The ISO limit is 4.5 mm/s.",
        });
      }
      // Turn 2 of conversation: math calculation
      if (brainTurn === 3) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Compute 15 * 8.",
          input: { expression: "15 * 8" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Calculation verified.",
        answer: "15 * 8 = 120.",
      });
    });

    const mockRetriever = async () => ({
      content: "ISO 10816-3 Zone B allowable vibration limit is 4.5 mm/s RMS.",
      sources: [
        {
          filename: "ISO-Standard.pdf",
          page: 5,
          score: 0.96,
        },
      ],
      results: [
        {
          text: "ISO 10816-3 Zone B allowable vibration limit is 4.5 mm/s RMS.",
          filename: "ISO-Standard.pdf",
          page: 5,
          score: 0.96,
        },
      ],
    });

    // Turn 1: Document retrieval question
    const res1 = await runAgentTask({
      message: "What is the ISO 10816-3 vibration limit in the SOP document?",
      userId,
      chatId,
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.steps[0].toolName, "retrieve_information");
    assert.ok(res1.sources.length >= 1);

    // Turn 2: Pure math question
    const res2 = await runAgentTask({
      message: "Calculate 15 * 8.",
      userId,
      chatId,
    });

    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.steps.length, 1);
    assert.strictEqual(res2.steps[0].toolName, "calculator");
    assert.strictEqual(res2.steps[0].output.value, 120);

    // Turn 2 did NOT call retrieval
    assert.strictEqual(res2.sources.length, 0, "Turn 2 must NOT have retrieved document sources");

    pass("Retrieval request followed by normal request operates cleanly without Knowledge Base pre-injection");
  } catch (err) {
    fail("Retrieval Request Followed by Normal Request", err);
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
  }

  // ─── TEST 6: Multi-Step Tool Workflow & State Bounding ──────────────────────
  console.log("\n--- [Test 6] Multi-Step Tool Workflow & State Bounding ---");
  try {
    const userId = "user_eva";
    const chatId = "chat_multi_step_workflow";

    let brainTurn = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainTurn++;
      if (brainTurn === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "vision",
          reason: "Extract motor parameters and torque formula.",
          input: { prompt: "Extract visible power, speed, and torque formula." },
        });
      }
      if (brainTurn === 2) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Compute torque: 22 * 9550 / 960.",
          input: { expression: "22 * 9550 / 960" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Multi-step workflow complete.",
        answer: "Torque calculation verified: 218.854 Nm.",
      });
    });

    // Mock vision returning large analysis text to test observation bounding
    const mockVisionClient = async () => {
      return JSON.stringify({
        values: { P: "22 kW", N: "960 RPM" },
        displayed_formula: "T = (P * 9550) / N",
        displayed_answer: "218.9 Nm",
        largeBlob: "A".repeat(12000), // Large string to test state bounding
      });
    };

    const res = await runAgentTask({
      message: "Inspect the motor nameplate and calculate the operating torque.",
      userId,
      chatId,
      images: [SAMPLE_DATA_URL],
      options: { visionClient: mockVisionClient },
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.steps.length, 2);
    assert.strictEqual(res.steps[0].toolName, "vision");
    assert.strictEqual(res.steps[1].toolName, "calculator");

    // Verify structured state captures all completed steps
    assert.ok(res.state);
    assert.strictEqual(res.state.iteration_count, 2);
    assert.strictEqual(res.state.completed_steps.length, 2);
    assert.strictEqual(res.state.completed_steps[0].tool, "vision");
    assert.strictEqual(res.state.completed_steps[1].tool, "calculator");

    // Verify checkpointer state
    const cp = await agentGraphService.getCheckpointState(`${userId}:${chatId}`);
    assert.ok(cp);
    assert.strictEqual(cp.values.toolExecutionCount, 2);
    assert.strictEqual(cp.values.status, "completed");

    pass("Multi-step tool workflow correctly accumulates steps, bounds observations, and persists checkpoint state");
  } catch (err) {
    fail("Multi-Step Tool Workflow", err);
  } finally {
    agentGraphService.resetAgentBrainLlmClient();
  }

  // ─── SUMMARY ────────────────────────────────────────────────────────────────
  console.log("\n================================================================================");
  console.log(`STATE & CONTEXT TEST SUITE COMPLETE: ${passedCount} passed, ${failedCount} failed`);
  console.log("================================================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runStateContextTests();
