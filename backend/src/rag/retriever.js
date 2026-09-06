/**
 * Retriever
 *
 * Takes user search queries, generates query embeddings, and retrieves top-k relevant document chunks.
 */

import { generateEmbedding } from "./embeddings.js";
import { RAG_CONFIG } from "./config.js";

/**
 * Retrieves top-k matching document chunks for a query from a vector store instance.
 *
 * @param {string} query - User search question
 * @param {import("./vectorStore.js").VectorStore} vectorStore - VectorStore instance
 * @param {object} [options]
 * @param {number} [options.topK] - Max chunks to retrieve
 * @param {number} [options.minScore] - Similarity threshold
 * @returns {Promise<Array<{id: string, text: string, score: number, metadata: object}>>}
 */
export async function retrieveRelevantChunks(query, vectorStore, options = {}) {
  if (!query || typeof query !== "string" || !query.trim()) {
    return [];
  }

  const topK = options.topK || RAG_CONFIG.topK;

  try {
    // 1. Generate embedding for query
    const queryVector = await generateEmbedding(query.trim());

    // 2. Perform similarity search against vector store
    const results = vectorStore.search(queryVector, {
      topK,
      minScore: options.minScore,
    });

    return results;
  } catch (err) {
    console.error("[RAG Retriever] Search error:", err.message);
    return [];
  }
}

/**
 * Formats retrieved text chunks into a structured context string for prompt augmentation.
 *
 * @param {Array<{id: string, text: string, score: number, metadata: object}>} chunks
 * @returns {string} Formatted context block
 */
export function formatChunksForContext(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return "";
  }

  const contextBlocks = chunks.map((chunk, i) => {
    const filename = chunk.metadata?.filename || `Document ${i + 1}`;
    return `[Context Source ${i + 1}: ${filename}]\n${chunk.text}`;
  });

  return contextBlocks.join("\n\n---\n\n");
}
