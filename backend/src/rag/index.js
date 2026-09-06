/**
 * RAG Module — Entry Point
 *
 * Exposes public interface for Document Loading, Text Chunking, Embeddings,
 * Vector Storage, Retrieval, and Prompt Augmentation.
 */

export { RAG_CONFIG } from "./config.js";
export { loadAllDocuments, loadDocumentFromFile, cleanText } from "./documentLoader.js";
export { splitTextIntoChunks, chunkDocument } from "./textSplitter.js";
export { generateEmbedding, generateBatchEmbeddings, generateFallbackEmbedding } from "./embeddings.js";
export { VectorStore, cosineSimilarity } from "./vectorStore.js";
export { retrieveRelevantChunks, formatChunksForContext } from "./retriever.js";
export { ragPipeline, default as RAGPipeline } from "./ragPipeline.js";
