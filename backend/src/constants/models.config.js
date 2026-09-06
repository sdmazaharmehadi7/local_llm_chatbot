/**
 * Models Configuration — Single Source of Truth
 *
 * Defines the supported local Ollama models and cloud models for Local Chat.
 * Excludes non-chat models (such as nomic-embed-text).
 */

/** Local Ollama models */
export const LOCAL_CHAT_MODELS = [
  {
    id: "qwen3:8b",
    model_id: "qwen3:8b",
    name: "Qwen3 8B",
    display_name: "Qwen3 8B",
    description: "General reasoning and chat",
    type: "text",
    provider: "ollama",
    provider_display_name: "Ollama",
    enabled: true,
    is_default: true,
    context_window: 40960,
    metadata: {
      supports_tools: false,
      description: "General reasoning, chat, writing, and analysis",
    },
  },
  {
    id: "qwen2.5-coder:7b",
    model_id: "qwen2.5-coder:7b",
    name: "Qwen2.5 Coder 7B",
    display_name: "Qwen2.5 Coder 7B",
    description: "Coding and debugging",
    type: "text",
    provider: "ollama",
    provider_display_name: "Ollama",
    enabled: true,
    is_default: false,
    context_window: 32768,
    metadata: {
      supports_tools: true,
      description: "Programming, debugging, code generation, and technical questions",
    },
  },
  {
    id: "qwen2.5vl:7b",
    model_id: "qwen2.5vl:7b",
    name: "Qwen2.5 VL 7B",
    display_name: "Qwen2.5 VL 7B",
    description: "Images and visual documents",
    type: "text",
    provider: "ollama",
    provider_display_name: "Ollama",
    enabled: true,
    is_default: false,
    context_window: 128000,
    metadata: {
      supports_tools: false,
      description: "Images, scanned documents, visual understanding, and multimodal questions",
    },
  },
];

/** Cloud / API-based models */
export const CLOUD_CHAT_MODELS = [
  {
    id: "gemini-3.6-flash",
    model_id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    display_name: "Gemini 3.6 Flash",
    description: "Fast and capable Google model",
    type: "text",
    provider: "google",
    provider_display_name: "Google",
    enabled: true,
    is_default: false,
    context_window: 1048576,
    metadata: {
      supports_tools: false,
      description: "Google Gemini 3.6 Flash — fast, smart, multimodal cloud model",
      requires_api_key: "GEMINI_API_KEY",
    },
  },
];

/** All models combined — what gets returned by GET /api/models */
export function getAllChatModels() {
  const models = [...LOCAL_CHAT_MODELS];
  // Only include Gemini if the API key is present
  if (process.env.GEMINI_API_KEY) {
    models.push(...CLOUD_CHAT_MODELS);
  }
  return models;
}

/**
 * Check whether a given model ID is an allowed local Ollama model.
 * @param {string} modelId
 * @returns {boolean}
 */
export function isValidModelId(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  return LOCAL_CHAT_MODELS.some(
    (m) => m.id === modelId || m.model_id === modelId
  );
}

/**
 * Check whether a given model ID is a known cloud (Gemini) model.
 * @param {string} modelId
 * @returns {boolean}
 */
export function isCloudModelId(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  return CLOUD_CHAT_MODELS.some(
    (m) => m.id === modelId || m.model_id === modelId
  );
}

/**
 * Get configuration object for a given model ID (local or cloud).
 * @param {string} modelId
 * @returns {object|null}
 */
export function getModelConfig(modelId) {
  return (
    [...LOCAL_CHAT_MODELS, ...CLOUD_CHAT_MODELS].find(
      (m) => m.id === modelId || m.model_id === modelId
    ) || null
  );
}

/**
 * Get the default local chat model.
 * @returns {object}
 */
export function getDefaultModel() {
  return (
    LOCAL_CHAT_MODELS.find((m) => m.is_default) || LOCAL_CHAT_MODELS[0]
  );
}

