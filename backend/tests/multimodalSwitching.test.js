/**
 * Multimodal Model Switching Unit Tests
 *
 * Deterministic, zero-inference test suite verifying:
 * 1. Image question with Qwen2.5-VL -> preserves image context.
 * 2. Switch to Qwen2.5-Coder in the SAME chat -> strips ALL images, text only, no multimodal error.
 * 3. Switch to Qwen3 in the SAME chat -> strips ALL images, text only.
 * 4. Switch from Coder -> Vision -> preserves image context for VL model.
 * 5. Switch from Qwen3 -> Vision -> preserves image context for VL model.
 * 6. Images field is completely absent (not undefined or empty array) for text-only models.
 * 7. Textual conversation history is 100% preserved across model switches.
 *
 * SAFETY: NO Ollama process started, NO real model inference executed.
 */

import assert from "node:assert/strict";
import { isMultimodalModel } from "../src/constants/models.config.js";
import { toOllamaMessages } from "../src/controllers/completion.controller.js";

async function runTests() {
  console.log("==================================================");
  console.log("RUNNING MULTIMODAL MODEL SWITCHING UNIT TESTS");
  console.log("==================================================");

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`✔ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}`);
      console.error(err);
      failed++;
    }
  }

  // ── TEST 1: Model Capability Classification ─────────────────────────────────
  test("Test 1: isMultimodalModel correctly classifies models", () => {
    // Multimodal models
    assert.strictEqual(isMultimodalModel("qwen2.5vl:7b"), true, "qwen2.5vl:7b must be multimodal");
    assert.strictEqual(isMultimodalModel("qwen2.5vl"), true, "qwen2.5vl must be multimodal");
    assert.strictEqual(isMultimodalModel("gemini-3.6-flash"), true, "gemini-3.6-flash must be multimodal");

    // Text-only models
    assert.strictEqual(isMultimodalModel("qwen3:8b"), false, "qwen3:8b must be text-only");
    assert.strictEqual(isMultimodalModel("qwen2.5-coder:7b"), false, "qwen2.5-coder:7b must be text-only");
    assert.strictEqual(isMultimodalModel("nomic-embed-text"), false, "nomic-embed-text must be text-only");
    assert.strictEqual(isMultimodalModel(null), false, "null must be text-only");
  });

  // ── TEST 2: Vision Model Receives Image Context ────────────────────────────
  test("Test 2: qwen2.5vl:7b preserves image payloads", () => {
    const rawMessages = [
      {
        role: "user",
        content: "What is depicted in this blueprint diagram?",
        images: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="],
      },
    ];

    const formatted = toOllamaMessages(rawMessages, "qwen2.5vl:7b");
    assert.strictEqual(formatted.length, 1);
    assert.strictEqual(formatted[0].role, "user");
    assert.strictEqual(formatted[0].content, "What is depicted in this blueprint diagram?");
    assert.ok(Array.isArray(formatted[0].images), "images array must be preserved for qwen2.5vl:7b");
    assert.strictEqual(formatted[0].images.length, 1);
  });

  // ── TEST 3: Acceptance Test - Vision -> Coder Switch ───────────────────────
  test("Test 3: Acceptance Test: Vision -> Coder switch in same chat strips images and keeps text only", () => {
    // Conversation history containing turn 1 (image question) and turn 2 (code question)
    const multiTurnHistory = [
      {
        role: "user",
        content: "Explain this diagram.",
        images: ["base64_image_data_turn_1"],
      },
      {
        role: "assistant",
        content: "The diagram shows a microservices architecture with an API gateway.",
      },
      {
        role: "user",
        content: "write a Java program for prime numbers",
      },
    ];

    // Formatted for text-only coding model: qwen2.5-coder:7b
    const coderMessages = toOllamaMessages(multiTurnHistory, "qwen2.5-coder:7b");

    assert.strictEqual(coderMessages.length, 3);

    // Turn 1 verification: text preserved, images completely absent
    assert.strictEqual(coderMessages[0].role, "user");
    assert.strictEqual(coderMessages[0].content, "Explain this diagram.");
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(coderMessages[0], "images"),
      false,
      "images field must be completely absent for qwen2.5-coder:7b"
    );
    assert.strictEqual(coderMessages[0].images, undefined);

    // Turn 2 assistant verification
    assert.strictEqual(coderMessages[1].role, "assistant");
    assert.strictEqual(coderMessages[1].content, "The diagram shows a microservices architecture with an API gateway.");

    // Turn 3 user verification
    assert.strictEqual(coderMessages[2].role, "user");
    assert.strictEqual(coderMessages[2].content, "write a Java program for prime numbers");
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(coderMessages[2], "images"),
      false,
      "images field must be absent on latest turn as well"
    );
  });

  // ── TEST 4: Vision -> Qwen3 Switch ─────────────────────────────────────────
  test("Test 4: Vision -> Qwen3 switch in same chat strips images and keeps text only", () => {
    const multiTurnHistory = [
      {
        role: "user",
        content: "Analyze this chart.",
        images: ["base64_chart_image"],
      },
      {
        role: "assistant",
        content: "The chart displays revenue growth over Q1 to Q4.",
      },
      {
        role: "user",
        content: "What are three takeaways from our conversation?",
      },
    ];

    const qwen3Messages = toOllamaMessages(multiTurnHistory, "qwen3:8b");

    assert.strictEqual(qwen3Messages.length, 3);
    for (const msg of qwen3Messages) {
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(msg, "images"),
        false,
        `images field must be absent for qwen3:8b in message with role ${msg.role}`
      );
    }
    assert.strictEqual(qwen3Messages[0].content, "Analyze this chart.");
    assert.strictEqual(qwen3Messages[2].content, "What are three takeaways from our conversation?");
  });

  // ── TEST 5: Coder -> Vision Switch ─────────────────────────────────────────
  test("Test 5: Coder -> Vision switch restores image payloads for multimodal model", () => {
    const multiTurnHistory = [
      {
        role: "user",
        content: "Here is an architecture diagram.",
        images: ["base64_architecture_diagram"],
      },
      {
        role: "assistant",
        content: "I see a database cluster with replication.",
      },
      {
        role: "user",
        content: "Now look at the bottom-left corner of the diagram, what component is that?",
      },
    ];

    // Formatted for multimodal model: qwen2.5vl:7b
    const visionMessages = toOllamaMessages(multiTurnHistory, "qwen2.5vl:7b");

    assert.strictEqual(visionMessages.length, 3);
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(visionMessages[0], "images"),
      true,
      "images field must be present for qwen2.5vl:7b"
    );
    assert.deepStrictEqual(visionMessages[0].images, ["base64_architecture_diagram"]);
  });

  // ── TEST 6: Qwen3 -> Vision Switch ─────────────────────────────────────────
  test("Test 6: Qwen3 -> Vision switch correctly provides images when switching to VL model", () => {
    const multiTurnHistory = [
      {
        role: "user",
        content: "Inspect this circuit schematic.",
        images: ["base64_schematic"],
      },
      {
        role: "assistant",
        content: "It includes an operational amplifier and a feedback resistor.",
      },
      {
        role: "user",
        content: "Can you re-examine the resistor value in the diagram?",
      },
    ];

    // When switching to qwen2.5vl:7b
    const visionMessages = toOllamaMessages(multiTurnHistory, "qwen2.5vl:7b");
    assert.ok(Array.isArray(visionMessages[0].images));
    assert.strictEqual(visionMessages[0].images.length, 1);
  });

  console.log("==================================================");
  console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failure:", err);
  process.exit(1);
});
