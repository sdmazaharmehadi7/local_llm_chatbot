/**
 * Ollama Service
 *
 * Handles all communication with the local Ollama API.
 * Architecture: React → Express → OllamaService → Ollama → qwen3:8b
 *
 * Exports:
 *   sendChatToOllama(messages)         — non-streaming, returns string
 *   streamChatFromOllama(messages, cb) — streaming, calls cb per token
 *   checkOllamaHealth()                — reachability + model check
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";

// ─── Non-streaming (used by legacy POST /api/chat) ───────────────────────────

/**
 * Send a chat message to Ollama (non-streaming) and return the assistant reply.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<string>}
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
      signal: AbortSignal.timeout(300_000), // 5-minute timeout
    });
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw new Error("Ollama request timed out. The model may be slow or not running.");
    }
    throw new Error(
      `Could not reach Ollama at ${OLLAMA_BASE_URL}. Make sure Ollama is running.`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Ollama returned HTTP ${response.status}: ${body || response.statusText}`);
  }

  const data = await response.json();
  const content = data?.message?.content;
  if (!content) {
    throw new Error("Ollama returned an unexpected response format.");
  }

  return content;
}

// ─── Streaming (used by POST /api/chats/:id/completion) ──────────────────────

/**
 * Stream a chat response from Ollama, calling onToken for each text chunk.
 * Returns a readable stream of raw Ollama NDJSON lines.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {AbortSignal|null} signal - optional abort signal to cancel
 * @returns {Promise<ReadableStream>} - raw fetch body stream from Ollama
 */
export async function streamChatFromOllama(messages, signal = null) {
  const url = `${OLLAMA_BASE_URL}/api/chat`;

  let response;
  try {
    const fetchOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: true,
      }),
    };

    // Combine caller's signal with a 5-minute timeout
    if (signal) {
      fetchOptions.signal = signal;
    }

    response = await fetch(url, fetchOptions);
  } catch (err) {
    if (err.name === "AbortError") {
      throw err; // propagate cancel
    }
    throw new Error(
      `Could not reach Ollama at ${OLLAMA_BASE_URL}. Make sure Ollama is running.`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Ollama returned HTTP ${response.status}: ${body || response.statusText}`);
  }

  // Return the raw body stream — the controller will read and transform it
  return response.body;
}

// ─── Health check ─────────────────────────────────────────────────────────────

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
