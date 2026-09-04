/**
 * Models Controller
 *
 * Handles HTTP request/response logic for model listing, status, and selection.
 *
 * Endpoints:
 *   GET  /api/models          — list supported local chat models
 *   GET  /api/models/status   — inspect active model, RAM state, switching flag
 *   POST /api/models/select   — switch active model with RAM unloading/loading
 */

import {
  getAvailableModels,
  getLoadedModels,
  getActiveModel,
  isSwitching,
  switchModel,
} from "../services/ollama.service.js";
import { isValidModelId } from "../constants/models.config.js";

/**
 * GET /api/models
 * Returns available local chat models.
 * Compatible with frontend providersClient.getEnabledModelsByType(type).
 */
export async function getModels(req, res) {
  try {
    const allModels = getAvailableModels();
    // Filter by type if specifically requested (both "text" and "chat" match local chat models)
    let models = allModels;
    if (type && type !== "text" && type !== "chat") {
      models = allModels.filter((m) => m.type === type);
    }

    return res.json({
      success: true,
      models,
    });
  } catch (err) {
    console.error("[models.controller] Error listing models:", err.message);
    return res.status(500).json({
      success: false,
      error: "Failed to retrieve models.",
    });
  }
}

/**
 * GET /api/models/status
 * Returns current backend model state: active model, loaded RAM models, and switching flag.
 */
export async function getModelStatus(req, res) {
  try {
    const activeModel = getActiveModel();
    const loadedModels = await getLoadedModels();
    const switching = isSwitching();

    return res.json({
      success: true,
      activeModel,
      loadedModels,
      switching,
    });
  } catch (err) {
    console.error("[models.controller] Error getting model status:", err.message);
    return res.status(500).json({
      success: false,
      error: "Failed to check model status.",
    });
  }
}

/**
 * POST /api/models/select
 * Selects and activates a local model, ensuring only ONE model is loaded in RAM.
 *
 * Request body:
 *   { "model": "qwen2.5-coder:7b" }
 */
export async function selectModel(req, res) {
  const { model } = req.body;

  if (!model || typeof model !== "string") {
    return res.status(400).json({
      success: false,
      error: "Request body must include a 'model' string.",
    });
  }

  // Validate model against allowed local models list
  if (!isValidModelId(model)) {
    return res.status(400).json({
      success: false,
      error: `Selected model "${model}" is not available locally. Allowed models: ${getAvailableModels().map((m) => m.id).join(", ")}`,
    });
  }

  try {
    const result = await switchModel(model);
    return res.json({
      success: true,
      activeModel: result.activeModel,
      message: result.message,
    });
  } catch (err) {
    console.error(`[models.controller] Model switch error for ${model}:`, err.message);
    const isConnErr = err.message.includes("Could not reach Ollama");
    return res.status(isConnErr ? 503 : 500).json({
      success: false,
      error: isConnErr ? "Local AI service unavailable" : err.message,
    });
  }
}
