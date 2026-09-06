/**
 * Vector Store
 *
 * In-memory vector database with persistent JSON storage.
 * Performs similarity search using Cosine Similarity.
 */

import fs from "fs/promises";
import path from "path";
import { RAG_CONFIG } from "./config.js";

/**
 * Computes Cosine Similarity between two vectors.
 *
 * @param {Array<number>} vecA
 * @param {Array<number>} vecB
 * @returns {number} Cosine similarity in range [-1, 1]
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class VectorStore {
  /**
   * @param {string} [storagePath]
   */
  constructor(storagePath = RAG_CONFIG.vectorStorePath) {
    this.storagePath = storagePath;
    /** @type {Array<{id: string, text: string, vector: Array<number>, metadata: object}>} */
    this.entries = [];
  }

  /**
   * Adds or updates a chunk entry in the vector store.
   *
   * @param {{id: string, text: string, vector: Array<number>, metadata: object}} entry
   */
  addEntry(entry) {
    const existingIndex = this.entries.findIndex((e) => e.id === entry.id);
    if (existingIndex >= 0) {
      this.entries[existingIndex] = entry;
    } else {
      this.entries.push(entry);
    }
  }

  /**
   * Adds multiple chunk entries in bulk.
   * @param {Array<{id: string, text: string, vector: Array<number>, metadata: object}>} entries
   */
  addEntries(entries) {
    for (const entry of entries) {
      this.addEntry(entry);
    }
  }

  /**
   * Clears all entries in the vector store.
   */
  clear() {
    this.entries = [];
  }

  /**
   * Performs similarity search against query vector.
   *
   * @param {Array<number>} queryVector - Query embedding vector
   * @param {object} [options]
   * @param {number} [options.topK] - Max results to return
   * @param {number} [options.minScore] - Minimum similarity threshold
   * @returns {Array<{id: string, text: string, score: number, metadata: object}>}
   */
  search(queryVector, options = {}) {
    const topK = options.topK || RAG_CONFIG.topK;
    const minScore =
      options.minScore !== undefined
        ? options.minScore
        : RAG_CONFIG.minSimilarityScore;

    if (!queryVector || this.entries.length === 0) {
      return [];
    }

    const scored = this.entries
      .map((entry) => {
        const score = cosineSimilarity(queryVector, entry.vector);
        return {
          id: entry.id,
          text: entry.text,
          score,
          metadata: entry.metadata,
        };
      })
      .filter((item) => item.score >= minScore)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, topK);
  }

  /**
   * Saves the current vector store to JSON file.
   * @param {string} [customPath]
   */
  async save(customPath = this.storagePath) {
    try {
      const dir = path.dirname(customPath);
      await fs.mkdir(dir, { recursive: true });

      const payload = {
        updatedAt: new Date().toISOString(),
        count: this.entries.length,
        entries: this.entries,
      };

      await fs.writeFile(customPath, JSON.stringify(payload, null, 2), "utf-8");
      console.log(`[RAG VectorStore] Saved ${this.entries.length} vectors to ${customPath}`);
    } catch (err) {
      console.error("[RAG VectorStore] Error saving vector store:", err.message);
    }
  }

  /**
   * Loads vector store entries from JSON file.
   * @param {string} [customPath]
   * @returns {Promise<boolean>} Success status
   */
  async load(customPath = this.storagePath) {
    try {
      const data = await fs.readFile(customPath, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed.entries)) {
        this.entries = parsed.entries;
        console.log(`[RAG VectorStore] Loaded ${this.entries.length} vectors from ${customPath}`);
        return true;
      }
      return false;
    } catch (err) {
      // File may not exist yet on first run
      if (err.code !== "ENOENT") {
        console.warn("[RAG VectorStore] Warning loading vector store:", err.message);
      }
      return false;
    }
  }
}

export default VectorStore;
