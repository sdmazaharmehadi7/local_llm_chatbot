import { apiFetch, MOCK_MODELS } from "@/lib/api";

export const providersClient = {
  async getProviders() {
    try {
      return await apiFetch("/api/admin/providers");
    } catch {
      return [
        {
          id: "ollama",
          name: "ollama",
          display_name: "Ollama",
          provider_type: "ollama",
          base_url: "http://localhost:11434",
          is_local: true,
          enabled: true,
        },
      ];
    }
  },

  async getAvailableProviders() {
    try {
      return await apiFetch("/api/admin/providers/available");
    } catch {
      return ["ollama", "openai", "anthropic", "groq", "mistral"];
    }
  },

  async createProvider(name, displayName, providerType, baseUrl, apiKey) {
    return apiFetch("/api/admin/providers", {
      method: "POST",
      body: JSON.stringify({ name, displayName, providerType, baseUrl, apiKey }),
    });
  },

  async updateProvider(providerId, updates) {
    return apiFetch(`/api/admin/providers/${providerId}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
  },

  async refreshModels(providerId) {
    return apiFetch(`/api/admin/providers/${providerId}/refresh-models`, {
      method: "POST",
    });
  },

  async deleteProvider(providerId) {
    return apiFetch(`/api/admin/providers/${providerId}`, {
      method: "DELETE",
    });
  },

  async setAllModelsEnabled(providerId, enabled) {
    return apiFetch(`/api/admin/providers/${providerId}/models/enable`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    });
  },

  async getAllModels() {
    try {
      return await apiFetch("/api/admin/models");
    } catch {
      return { models: MOCK_MODELS };
    }
  },

  async getEnabledModels() {
    try {
      const res = await apiFetch("/api/models");
      return res?.models?.length ? res : { models: MOCK_MODELS };
    } catch {
      return { models: MOCK_MODELS };
    }
  },

  async getEnabledModelsByType(modelType) {
    try {
      const params = modelType ? `?type=${modelType}` : "";
      const res = await apiFetch(`/api/models${params}`);
      return res?.models?.length ? res : { models: MOCK_MODELS };
    } catch {
      return { models: MOCK_MODELS };
    }
  },

  async getModelStatus() {
    return apiFetch("/api/models/status");
  },

  async selectModel(model) {
    return apiFetch("/api/models/select", {
      method: "POST",
      body: JSON.stringify({ model }),
    });
  },

  async updateModel(modelId, updates) {
    return apiFetch(`/api/admin/models/${modelId}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
  },

  async setDefaultModel(modelId) {
    return apiFetch(`/api/admin/models/${modelId}/default`, {
      method: "PUT",
    });
  },

  async deleteModel(modelId) {
    return apiFetch(`/api/admin/models/${modelId}`, {
      method: "DELETE",
    });
  },
};
