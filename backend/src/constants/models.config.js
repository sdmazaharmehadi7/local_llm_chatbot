/**
 * Models Configuration — Single Source of Truth
 *
 * Defines the supported local Ollama models for Local Chat.
 * Excludes non-chat models (such as nomic-embed-text).
 */

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

/**
 * Check whether a given model ID is an allowed local chat model.
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
 * Get configuration object for a given model ID.
 * @param {string} modelId
 * @returns {object|null}
 */
export function getModelConfig(modelId) {
  return (
    LOCAL_CHAT_MODELS.find(
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
