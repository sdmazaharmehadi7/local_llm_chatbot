import { GoogleGenAI } from "@google/genai";
import { RAG_CONFIG } from "./config.js";

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
 * Generates an embedding vector for a single text input string.
 *
 * @param {string} text - Input text
 * @param {string} [modelOverride] - Optional embedding model name
 * @returns {Promise<Array<number>>} Vector array (e.g. 768 or 384 dimensions)
 */
export async function generateEmbedding(text, modelOverride = null) {
  if (!text || typeof text !== "string") {
    throw new Error("generateEmbedding requires a valid non-empty text string.");
  }

  const provider = (RAG_CONFIG.embeddingProvider || process.env.EMBEDDING_PROVIDER || "ollama").toLowerCase();

  // ── Gemini Embedding Provider ──────────────────────────────────────────────
  if (provider === "gemini") {
    try {
      const ai = getGeminiClient();
      const model = modelOverride || RAG_CONFIG.geminiEmbeddingModel || "gemini-embedding-001";
      const res = await ai.models.embedContent({
        model,
        contents: text,
      });
      const embedding = res.embeddings?.[0]?.values || res.embedding?.values;
      if (Array.isArray(embedding) && embedding.length > 0) {
        return embedding;
      }
    } catch (err) {
      console.warn(
        `[RAG Embeddings] Notice: Gemini embedding generation failed (${err.message}). Falling back to deterministic embedding.`
      );
      return generateFallbackEmbedding(text, 384);
    }
  }

  // ── Ollama Embedding Provider ──────────────────────────────────────────────
  const model = modelOverride || RAG_CONFIG.embeddingModel;
  const baseUrl = RAG_CONFIG.ollamaBaseUrl;

  // 1. Try Ollama new /api/embed endpoint
  try {
    const res = await fetch(`${baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: text,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      const data = await res.json();
      const embedding = data?.embeddings?.[0] || data?.embedding;
      if (Array.isArray(embedding) && embedding.length > 0) {
        return embedding;
      }
    }
  } catch {
    // Fall through to legacy endpoint
  }

  // 2. Try Ollama legacy /api/embeddings endpoint
  try {
    const res = await fetch(`${baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: text,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      const data = await res.json();
      const embedding = data?.embedding;
      if (Array.isArray(embedding) && embedding.length > 0) {
        return embedding;
      }
    }
  } catch {
    // Fall through to fallback
  }

  // 3. Fallback: If embedding model is not pulled or Ollama is offline during testing,
  // generate a deterministic 384-dim bag-of-words normalized vector so tests & app remain functional.
  console.warn(
    `[RAG Embeddings] Notice: Embedding model "${model}" not reachable on Ollama. Using fallback deterministic embedding.`
  );
  return generateFallbackEmbedding(text, 384);
}

/**
 * Generates embeddings for an array of text strings.
 *
 * @param {Array<string>} texts
 * @param {string} [modelOverride]
 * @returns {Promise<Array<Array<number>>>}
 */
export async function generateBatchEmbeddings(texts, modelOverride = null) {
  const embeddings = [];
  for (const text of texts) {
    const vec = await generateEmbedding(text, modelOverride);
    embeddings.push(vec);
  }
  return embeddings;
}

/**
 * Deterministic term-frequency hashing vector fallback (for testing/offline mode).
 * @param {string} text
 * @param {number} dimensions
 * @returns {Array<number>}
 */
export function generateFallbackEmbedding(text, dimensions = 384) {
  const vector = new Array(dimensions).fill(0);
  const words = text.toLowerCase().match(/\w+/g) || [];

  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = (hash << 5) - hash + word.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dimensions;
    vector[idx] += 1;
  }

  // Normalize to unit length
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < dimensions; i++) {
      vector[i] = vector[i] / magnitude;
    }
  }

  return vector;
}
