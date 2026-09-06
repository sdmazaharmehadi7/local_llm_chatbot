/**
 * RAG Configuration — Single Source of Truth
 *
 * Reads RAG-specific options from environment variables with sensible defaults.
 */

import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const RAG_CONFIG = {
  // Toggle RAG on/off globally
  enabled: process.env.RAG_ENABLED !== "false",

  // Provider selection: 'gemini' | 'ollama'
  llmProvider: process.env.LLM_PROVIDER || "ollama",
  embeddingProvider: process.env.EMBEDDING_PROVIDER || "ollama",

  // Gemini model settings
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.6-flash",
  geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",

  // Embedding model in Ollama (defaults to nomic-embed-text, can be overridden via env)
  embeddingModel: process.env.EMBEDDING_MODEL || "nomic-embed-text",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",

  // Text chunking settings
  chunkSize: parseInt(process.env.RAG_CHUNK_SIZE || "500", 10),
  chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP || "50", 10),

  // Retrieval settings
  topK: parseInt(process.env.RAG_TOP_K || "3", 10),
  minSimilarityScore: parseFloat(process.env.RAG_MIN_SIMILARITY || "0.25"),

  // Storage paths
  documentsPath:
    process.env.RAG_DOCUMENTS_PATH || path.join(__dirname, "data", "documents"),
  vectorStorePath:
    process.env.RAG_VECTOR_STORE_PATH ||
    path.join(__dirname, "data", "vectors", "store.json"),
};

export default RAG_CONFIG;
