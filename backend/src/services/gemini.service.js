/**
 * Gemini Service
 *
 * Handles streaming chat with Google Gemini 3.6 Flash via @google/genai.
 *
 * STRICT RULE: GEMINI_API_KEY is NEVER sent to the frontend.
 * All Gemini communication happens exclusively on this backend.
 *
 * Architecture: React → Express → GeminiService → Google AI API
 */

import { GoogleGenAI } from "@google/genai";

const GEMINI_MODEL_ID = "gemini-3.6-flash";

/** Lazily initialized GenAI client — created once on first use. */
let _client = null;

/**
 * Returns the GoogleGenAI client, initializing it on first call.
 * Throws if GEMINI_API_KEY is not configured.
 */
function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Add it to backend/.env to use Gemini."
    );
  }
  if (!_client) {
    _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _client;
}

/**
 * Check whether Gemini is usable (API key present, API reachable).
 * @returns {Promise<{available: boolean, reason: string|null}>}
 */
export async function checkGeminiAvailability() {
  if (!process.env.GEMINI_API_KEY) {
    return { available: false, reason: "GEMINI_API_KEY not configured." };
  }
  try {
    getClient();
    return { available: true, reason: null };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

/**
 * Convert our internal message format to Gemini's `contents` format.
 * Frontend sends: [{ role: "user"|"assistant", content: string }]
 * Gemini expects: [{ role: "user"|"model", parts: [{ text }] }]
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Array<{role: string, parts: Array<{text: string}>}>}
 */
function toGeminiContents(messages) {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content || "" }],
    }));
}

/**
 * Stream a chat response from Gemini 3.6 Flash.
 *
 * @param {Array<{role: string, content: string}>} messages  - full conversation history
 * @returns {Promise<AsyncIterable<string>>}  - async iterable of text deltas
 */
export async function* streamChatFromGemini(messages) {
  const client = getClient();

  const contents = toGeminiContents(messages);
  if (contents.length === 0) {
    throw new Error("No valid messages to send to Gemini.");
  }

  // Extract a system instruction if the first item is a system message
  const systemMessages = messages.filter((m) => m.role === "system");
  const systemInstruction =
    systemMessages.length > 0
      ? systemMessages.map((m) => m.content).join("\n")
      : undefined;

  const config = {
    ...(systemInstruction ? { systemInstruction } : {}),
  };

  const result = await client.models.generateContentStream({
    model: GEMINI_MODEL_ID,
    contents,
    config,
  });

  for await (const chunk of result) {
    // chunk.text is a string property in @google/genai (not a method)
    const delta =
      typeof chunk.text === "string"
        ? chunk.text
        : chunk?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (delta) yield delta;
  }
}

export { GEMINI_MODEL_ID };
