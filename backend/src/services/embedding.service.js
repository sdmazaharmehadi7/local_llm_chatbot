/**
 * Embedding Service
 *
 * Handles generating text embeddings via Ollama using nomic-embed-text.
 *
 * STRICT RULES:
 * - nomic-embed-text is an EMBEDDING model, NOT a chat model.
 * - Never start Ollama automatically.
 * - Loaded on-demand when document ingestion or retrieval requires it.
 * - Dimension: 768
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const EMBEDDING_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text";

/**
 * Generate a single text embedding using Ollama /api/embeddings.
 *
 * @param {string} text - The input text to embed
 * @returns {Promise<number[]>} Array of 768 floating point numbers
 */
export async function generateEmbedding(text) {
  if (!text || typeof text !== "string" || !text.trim()) {
    throw new Error("Cannot generate embedding for empty text.");
  }

  const cleanText = text.trim();
  const url = `${OLLAMA_BASE_URL}/api/embeddings`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: cleanText,
      }),
      signal: AbortSignal.timeout(60000), // 60s timeout for local embedding
    });
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw new Error(`Embedding request timed out for model "${EMBEDDING_MODEL}".`);
    }
    throw new Error(`Ollama is not reachable at ${OLLAMA_BASE_URL}. Ensure Ollama is running.`);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `Ollama embedding error HTTP ${res.status}: ${errBody || res.statusText}`
    );
  }

  const data = await res.json();
  const vector = data?.embedding;

  if (!Array.isArray(vector) || vector.length === 0) {
    throw new Error(`Invalid embedding returned by Ollama for model "${EMBEDDING_MODEL}".`);
  }

  return vector;
}

/**
 * Generate embeddings for an array of texts in controlled batches.
 *
 * @param {string[]} texts
 * @param {number} [concurrency=3]
 * @returns {Promise<number[][]>}
 */
export async function generateBatchEmbeddings(texts, concurrency = 3) {
  if (!Array.isArray(texts) || texts.length === 0) {
    return [];
  }

  const results = new Array(texts.length);
  for (let i = 0; i < texts.length; i += concurrency) {
    const slice = texts.slice(i, i + concurrency);
    const sliceResults = await Promise.all(
      slice.map((text) => generateEmbedding(text))
    );
    for (let j = 0; j < sliceResults.length; j++) {
      results[i + j] = sliceResults[j];
    }
  }

  return results;
}
