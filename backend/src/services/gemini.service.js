/**
 * Gemini Service
 *
 * Handles HTTP communication with the Gemini API using @google/genai SDK.
 * Serves as an alternative provider to Ollama.
 */

import { GoogleGenAI } from "@google/genai";

let geminiClient = null;

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set.");
  }
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey });
  }
  return geminiClient;
}

/**
 * Converts standard message objects [{ role: 'system'|'user'|'assistant', content: string }]
 * into Gemini contents array and system instruction.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {{ systemInstruction: string, contents: Array<object> }}
 */
export function formatGeminiMessages(messages) {
  let systemInstruction = "";
  const contents = [];

  for (const msg of messages) {
    if (!msg || typeof msg.content !== "string") continue;

    if (msg.role === "system") {
      systemInstruction += (systemInstruction ? "\n\n" : "") + msg.content;
    } else {
      const role = msg.role === "assistant" ? "model" : "user";
      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts.push({ text: msg.content });
      } else {
        contents.push({
          role,
          parts: [{ text: msg.content }],
        });
      }
    }
  }

  if (contents.length === 0) {
    contents.push({ role: "user", parts: [{ text: "Hello" }] });
  }

  return { systemInstruction, contents };
}

/**
 * Send a chat message to Gemini API (non-streaming).
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {string|null} modelOverride
 * @returns {Promise<string>}
 */
export async function sendChatToGemini(messages, modelOverride = null) {
  const ai = getGeminiClient();
  const model = modelOverride || process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const { systemInstruction, contents } = formatGeminiMessages(messages);

  const config = {};
  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }

  const response = await ai.models.generateContent({
    model,
    contents,
    config,
  });

  return response.text || "";
}

/**
 * Stream chat response from Gemini API.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {AbortSignal|null} signal
 * @param {string|null} modelOverride
 * @returns {Promise<AsyncIterable<object>>}
 */
export async function streamChatFromGemini(messages, signal = null, modelOverride = null) {
  const ai = getGeminiClient();
  const model = modelOverride || process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const { systemInstruction, contents } = formatGeminiMessages(messages);

  const config = {};
  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }

  const responseStream = await ai.models.generateContentStream({
    model,
    contents,
    config,
  });

  return responseStream;
}
