/**
 * Ollama Service
 *
 * Handles all communication with the local Ollama API.
 * React → Express → OllamaService → Ollama → qwen3:8b
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";

/**
 * Send a chat message to Ollama and return the model's response.
 *
 * @param {Array<{role: string, content: string}>} messages - Conversation history
 * @returns {Promise<string>} - The assistant's reply text
 */
export async function sendChatToOllama(messages) {
  const url = `${OLLAMA_BASE_URL}/api/chat`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
      }),
      // 5-minute timeout for slow/large models
      signal: AbortSignal.timeout(300_000),
    });
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw new Error("Ollama request timed out. The model may be slow or not running.");
    }
    // fetch() itself throws if the server is completely unreachable
    throw new Error(
      `Could not reach Ollama at ${OLLAMA_BASE_URL}. Make sure Ollama is running.`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Ollama returned HTTP ${response.status}: ${body || response.statusText}`
    );
  }

  const data = await response.json();

  // Ollama /api/chat response shape: { message: { role, content }, ... }
  const content = data?.message?.content;
  if (!content) {
    throw new Error("Ollama returned an unexpected response format.");
  }

  return content;
}

/**
 * Check whether Ollama is reachable and the configured model is available.
 *
 * @returns {Promise<{reachable: boolean, modelAvailable: boolean, model: string}>}
 */
export async function checkOllamaHealth() {
  const model = OLLAMA_MODEL;

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return { reachable: false, modelAvailable: false, model };
    }

    const data = await response.json();
    const models = data?.models || [];
    const modelAvailable = models.some(
      (m) => m.name === model || m.name.startsWith(model.split(":")[0])
    );

    return { reachable: true, modelAvailable, model };
  } catch {
    return { reachable: false, modelAvailable: false, model };
  }
}
