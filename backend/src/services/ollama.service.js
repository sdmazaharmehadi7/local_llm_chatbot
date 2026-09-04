/**
 * Ollama Service
 *
 * Handles all communication with the local Ollama API.
 * Manages model lifecycle and enforces:
 * "Only ONE chat model should be loaded in Ollama RAM at a time."
 *
 * Architecture: React → Express → OllamaService → Ollama → [Selected Model]
 */

import {
  LOCAL_CHAT_MODELS,
  isValidModelId,
  getDefaultModel,
} from "../constants/models.config.js";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

// Active model state (defaults to env var or Qwen3 8B)
let currentActiveModel =
  process.env.OLLAMA_MODEL || getDefaultModel().id;

// Switching state flags & mutex queue to serialize concurrent switch requests
let isSwitchingModel = false;
let switchMutexChain = Promise.resolve();

// Helper sleep
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Model Discovery & RAM Inspection ────────────────────────────────────────

/**
 * Returns the list of supported local chat models.
 * @returns {Array<object>}
 */
export function getAvailableModels() {
  return LOCAL_CHAT_MODELS;
}

/**
 * Returns the ID of the currently active model.
 * @returns {string}
 */
export function getActiveModel() {
  return currentActiveModel;
}

/**
 * Sets the active model preference without triggering RAM loading.
 * @param {string} modelId
 */
export function setActiveModel(modelId) {
  if (isValidModelId(modelId)) {
    currentActiveModel = modelId;
  }
}

/**
 * Check whether Ollama service is reachable.
 * @returns {Promise<boolean>}
 */
export async function isOllamaReachable() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch list of installed model names from Ollama (/api/tags).
 * @returns {Promise<Array<string>>}
 */
export async function getInstalledModels() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.models || []).map((m) => m.name || m.model).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Returns whether a model switch is currently in progress.
 * @returns {boolean}
 */
export function isSwitching() {
  return isSwitchingModel;
}

/**
 * Queries Ollama's /api/ps endpoint to inspect models currently loaded in RAM.
 * @returns {Promise<Array<string>>} List of model names currently loaded
 */
export async function getLoadedModels() {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/ps`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    const models = data?.models || [];
    return models.map((m) => m.name || m.model).filter(Boolean);
  } catch {
    // If Ollama is not running or unreachable, return empty list
    return [];
  }
}

// ─── Unload & Load (One-Model-At-A-Time Enforcement) ─────────────────────────

/**
 * Unload a specific model from Ollama RAM by calling /api/generate with keep_alive: 0.
 * Polls until the model no longer appears in /api/ps.
 *
 * @param {string} modelId
 * @returns {Promise<void>}
 */
export async function unloadModel(modelId) {
  try {
    await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        keep_alive: 0,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Model might already be unloaded or unreachable
    console.warn(`[MODEL] Warning during unload request for ${modelId}:`, err.message);
  }

  // Poll until model disappears from RAM (max 10 seconds)
  const maxWaitMs = 10_000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const loaded = await getLoadedModels();
    const stillPresent = loaded.some(
      (m) => m === modelId || m.startsWith(modelId.split(":")[0])
    );
    if (!stillPresent) {
      break;
    }
    await sleep(250);
  }

  console.log(`[MODEL] ${modelId} unloaded`);
}

/**
 * Loads a specific model into Ollama RAM by sending a lightweight warmup request.
 * Polls until the model is reported in /api/ps.
 *
 * @param {string} modelId
 * @returns {Promise<void>}
 */
export async function loadModel(modelId) {
  try {
    await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelId,
        keep_alive: "5m",
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    console.warn(`[MODEL] Notice during load request for ${modelId}:`, err.message);
  }

  // Poll until model is ready in RAM (max 30 seconds)
  const maxWaitMs = 30_000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const loaded = await getLoadedModels();
    const isReady = loaded.some(
      (m) => m === modelId || m.startsWith(modelId.split(":")[0])
    );
    if (isReady) {
      break;
    }
    await sleep(300);
  }

  console.log(`[MODEL] ${modelId} ready`);
}

// ─── Serialized Model Switching (Mutex Queue) ────────────────────────────────

/**
 * Switch the active chat model, enforcing only ONE model in RAM at a time.
 * All switch requests are queued through switchMutexChain to prevent race conditions.
 *
 * @param {string} targetModelId
 * @returns {Promise<{success: boolean, activeModel: string, message: string}>}
 */
export function switchModel(targetModelId) {
  // Validate model before queueing
  if (!isValidModelId(targetModelId)) {
    return Promise.reject(
      new Error(`Selected model "${targetModelId}" is not available locally.`)
    );
  }

  // Chain execution so rapid switches execute sequentially without concurrency conflicts
  switchMutexChain = switchMutexChain
    .catch(() => {}) // don't break chain if previous switch failed
    .then(() => _executeModelSwitch(targetModelId));

  return switchMutexChain;
}

/**
 * Internal switch execution logic.
 */
async function _executeModelSwitch(targetModelId) {
  console.log(`[MODEL] Requested: ${targetModelId}`);
  console.log(`[MODEL] Current: ${currentActiveModel}`);

  isSwitchingModel = true;

  try {
    const loadedModels = await getLoadedModels();

    // 1. Check if the target model is ALREADY the only model in RAM
    const targetIsOnlyLoaded =
      loadedModels.length === 1 &&
      (loadedModels[0] === targetModelId ||
        loadedModels[0].startsWith(targetModelId.split(":")[0]));

    if (targetIsOnlyLoaded) {
      currentActiveModel = targetModelId;
      isSwitchingModel = false;
      console.log(`[MODEL] ${targetModelId} is already loaded and active.`);
      return {
        success: true,
        activeModel: targetModelId,
        message: `${targetModelId} is ready`,
      };
    }

    // 2. Unload any other model currently in RAM
    for (const loadedName of loadedModels) {
      const isTarget =
        loadedName === targetModelId ||
        loadedName.startsWith(targetModelId.split(":")[0]);

      if (!isTarget) {
        console.log(`[MODEL] Unloading: ${loadedName}`);
        await unloadModel(loadedName);
      }
    }

    // 3. Load the target model if not already present
    const recheckedLoaded = await getLoadedModels();
    const alreadyReady = recheckedLoaded.some(
      (m) =>
        m === targetModelId || m.startsWith(targetModelId.split(":")[0])
    );

    if (!alreadyReady) {
      console.log(`[MODEL] Loading: ${targetModelId}`);
      await loadModel(targetModelId);
    }

    currentActiveModel = targetModelId;
    isSwitchingModel = false;

    return {
      success: true,
      activeModel: targetModelId,
      message: `${targetModelId} is ready`,
    };
  } catch (err) {
    isSwitchingModel = false;
    console.error(`[MODEL] Model switch failure for ${targetModelId}:`, err.message);
    throw new Error(`Unable to switch model: ${err.message}`);
  }
}

// ─── Non-streaming Chat (Legacy testing) ──────────────────────────────────────

/**
 * Send a chat message to Ollama (non-streaming).
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {string|null} requestedModel - optional model override
 * @returns {Promise<string>}
 */
export async function sendChatToOllama(messages, requestedModel = null) {
  const modelToUse = requestedModel && isValidModelId(requestedModel)
    ? requestedModel
    : currentActiveModel;

  const url = `${OLLAMA_BASE_URL}/api/chat`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelToUse,
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

// ─── Streaming Chat (POST /api/chats/:id/completion) ──────────────────────────

/**
 * Stream a chat response from Ollama.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {AbortSignal|null} signal - optional abort signal
 * @param {string|null} requestedModel - optional model override
 * @returns {Promise<{stream: ReadableStream, modelUsed: string}>}
 */
export async function streamChatFromOllama(messages, signal = null, requestedModel = null) {
  const modelToUse = requestedModel && isValidModelId(requestedModel)
    ? requestedModel
    : currentActiveModel;

  const url = `${OLLAMA_BASE_URL}/api/chat`;

  let response;
  try {
    const fetchOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelToUse,
        messages,
        stream: true,
      }),
    };

    if (signal) {
      fetchOptions.signal = signal;
    }

    response = await fetch(url, fetchOptions);
  } catch (err) {
    if (err.name === "AbortError") {
      throw err;
    }
    throw new Error(
      `Could not reach Ollama at ${OLLAMA_BASE_URL}. Make sure Ollama is running.`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Ollama returned HTTP ${response.status}: ${body || response.statusText}`);
  }

  return { stream: response.body, modelUsed: modelToUse };
}

// ─── Health Check ────────────────────────────────────────────────────────────

/**
 * Check whether Ollama is reachable and active model is available.
 *
 * @returns {Promise<{reachable: boolean, modelAvailable: boolean, model: string}>}
 */
export async function checkOllamaHealth() {
  const model = currentActiveModel;

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
