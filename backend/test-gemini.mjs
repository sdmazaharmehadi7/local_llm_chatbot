/**
 * Minimal Gemini integration test.
 * Run with: node test-gemini.mjs
 *
 * Tests that @google/genai streams from Gemini 3.6 Flash correctly.
 * Requires GEMINI_API_KEY to be set in backend/.env
 */
import "dotenv/config";
import { streamChatFromGemini } from "./src/services/gemini.service.js";

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.log("⚠️  GEMINI_API_KEY is not set in .env — skipping test.");
  console.log("   Add your key to backend/.env: GEMINI_API_KEY=your_key_here");
  process.exit(0);
}

console.log("✅  GEMINI_API_KEY found. Starting Gemini 3.6 Flash stream test...\n");

try {
  const messages = [
    { role: "user", content: "Say exactly: 'Gemini 3.6 Flash integration is working!'" },
  ];

  process.stdout.write("Response: ");
  for await (const delta of streamChatFromGemini(messages)) {
    if (delta) process.stdout.write(delta);
  }
  console.log("\n\n✅  Gemini streaming test PASSED.");
} catch (err) {
  console.error("❌  Gemini test FAILED:", err.message);
  process.exit(1);
}
