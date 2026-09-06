/**
 * RAG Pipeline Orchestrator
 *
 * Coordinates document indexing, retrieval, and prompt augmentation.
 */

import { RAG_CONFIG } from "./config.js";
import { loadAllDocuments } from "./documentLoader.js";
import { chunkDocument } from "./textSplitter.js";
import { generateEmbedding } from "./embeddings.js";
import { VectorStore } from "./vectorStore.js";
import { retrieveRelevantChunks, formatChunksForContext } from "./retriever.js";

class RAGPipeline {
  constructor() {
    this.vectorStore = new VectorStore();
    this.isInitialized = false;
  }

  /**
   * Initializes RAG by loading saved vector index or building a new one if missing.
   */
  async initialize() {
    if (this.isInitialized) return;

    const loaded = await this.vectorStore.load();
    if (!loaded || this.vectorStore.entries.length === 0) {
      console.log("[RAG Pipeline] No existing index found. Building index from documents directory...");
      await this.buildIndex();
    } else {
      this.isInitialized = true;
    }
  }

  /**
   * Scans document directory, splits into chunks, generates embeddings, and saves vector index.
   * @param {string} [docsDir]
   */
  async buildIndex(docsDir = RAG_CONFIG.documentsPath) {
    console.log(`[RAG Pipeline] Scanning documents in ${docsDir}...`);
    const documents = await loadAllDocuments(docsDir);

    if (documents.length === 0) {
      console.log("[RAG Pipeline] No documents found to index.");
      this.vectorStore.clear();
      await this.vectorStore.save();
      this.isInitialized = true;
      return { documentCount: 0, chunkCount: 0 };
    }

    console.log(`[RAG Pipeline] Found ${documents.length} document(s). Chunking...`);
    const allChunks = [];
    for (const doc of documents) {
      const chunks = chunkDocument(doc);
      allChunks.push(...chunks);
    }

    console.log(`[RAG Pipeline] Generated ${allChunks.length} chunk(s). Generating embeddings...`);
    this.vectorStore.clear();

    for (let i = 0; i < allChunks.length; i++) {
      const chunk = allChunks[i];
      try {
        const vector = await generateEmbedding(chunk.text);
        this.vectorStore.addEntry({
          id: chunk.id,
          text: chunk.text,
          vector,
          metadata: {
            documentId: chunk.documentId,
            filename: chunk.filename,
            chunkIndex: chunk.chunkIndex,
            totalChunks: chunk.totalChunks,
            ...chunk.metadata,
          },
        });
      } catch (err) {
        console.error(`[RAG Pipeline] Error embedding chunk ${chunk.id}:`, err.message);
      }
    }

    await this.vectorStore.save();
    this.isInitialized = true;
    console.log(`[RAG Pipeline] Indexing complete. ${this.vectorStore.entries.length} chunks indexed.`);
    return {
      documentCount: documents.length,
      chunkCount: this.vectorStore.entries.length,
    };
  }

  /**
   * Retrieves relevant context for a user question.
   * @param {string} query
   * @param {object} [options]
   * @returns {Promise<{context: string, chunks: Array<object>}>}
   */
  async retrieveContext(query, options = {}) {
    if (!RAG_CONFIG.enabled) {
      return { context: "", chunks: [] };
    }

    await this.initialize();

    const chunks = await retrieveRelevantChunks(query, this.vectorStore, options);
    const context = formatChunksForContext(chunks);

    return { context, chunks };
  }

  /**
   * Augments chat messages array with retrieved context.
   *
   * @param {Array<{role: string, content: string}>} messages - Original conversation history
   * @param {string} context - Retrieved document context string
   * @returns {Array<{role: string, content: string}>} Augmented messages list
   */
  augmentMessages(messages, context) {
    if (!context || !context.trim() || !Array.isArray(messages) || messages.length === 0) {
      return messages;
    }

    const systemPromptInstruction = `You are a helpful local AI assistant. Use the following retrieved context documents to answer the user's question accurately. If the context does not contain the answer, rely on your general knowledge but state clearly when relying on context versus general knowledge.\n\n=== RETRIEVED CONTEXT ===\n${context}\n========================`;

    const copy = [...messages];
    const existingSystemIndex = copy.findIndex((m) => m.role === "system");

    if (existingSystemIndex >= 0) {
      // Append context to existing system prompt
      copy[existingSystemIndex] = {
        ...copy[existingSystemIndex],
        content: `${copy[existingSystemIndex].content}\n\n${systemPromptInstruction}`,
      };
    } else {
      // Prepend new system prompt with context
      copy.unshift({
        role: "system",
        content: systemPromptInstruction,
      });
    }

    return copy;
  }
}

export const ragPipeline = new RAGPipeline();
export default ragPipeline;
