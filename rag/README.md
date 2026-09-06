# RAG (Retrieval-Augmented Generation) Module for Local LLM Chatbot

## Overview
Retrieval-Augmented Generation (RAG) extends your local LLM's capabilities by injecting relevant context retrieved from your internal documents into the prompt before generating answers.

This module is designed to run **100% locally and privately**, working seamlessly with your existing Express backend and Ollama local model engine (`qwen3:8b`, `qwen2.5-coder:7b`, etc.) without requiring any external cloud APIs (OpenAI, Gemini, Claude).

---

## Architecture & Data Flow

```text
Knowledge Files (.txt, .md, .pdf in rag/data/documents/)
         ↓
Document Loader (documentLoader.js)
         ↓
Text Cleaning & Normalization
         ↓
Text Chunking (textSplitter.js - Recursive character splitter with overlap)
         ↓
Embedding Generation (embeddings.js - via local Ollama /api/embed API)
         ↓
Vector Store (vectorStore.js - JSON / In-Memory store with Cosine Similarity)
         ↓
Retriever (retriever.js - similarity search top-k lookup)
         ↓
Prompt Construction (ragPipeline.js - Context + Question system prompt)
         ↓
Existing Local LLM (ollama.service.js -> Qwen3/Ollama)
         ↓
Streamed Response to UI
```

---

## Directory Structure

```text
local_llm_chatbot/
├── backend/
│   ├── src/
│   │   ├── rag/
│   │   │   ├── index.js           # Public API entry point
│   │   │   ├── config.js          # RAG settings (chunk size, overlap, top_k, paths)
│   │   │   ├── documentLoader.js  # Loader for .txt, .md, and .pdf files
│   │   │   ├── textSplitter.js    # Recursive text chunking algorithm
│   │   │   ├── embeddings.js      # Ollama local embeddings client
│   │   │   ├── vectorStore.js     # Vector DB & Cosine Similarity search engine
│   │   │   ├── retriever.js       # Context lookup & formatters
│   │   │   ├── ragPipeline.js     # RAG pipeline orchestrator
│   │   │   ├── test-rag.js        # Automated test suite
│   │   │   └── data/
│   │   │       ├── documents/     # Place your knowledge files here
│   │   │       └── vectors/       # Persistent store.json vector index
│   │   └── controllers/
│   │       ├── completion.controller.js # Stream completions with RAG context
│   │       └── chat.controller.js       # Non-stream completions with RAG context
│   └── package.json               # Package dependencies & RAG scripts
└── rag/
    └── README.md                  # RAG System Documentation
```

---

## Configuration Options

RAG configuration parameters can be customized via environment variables in `.env` or left to their sensible defaults in [`backend/src/rag/config.js`](file:///d:/sih/local_llm_chatbot/backend/src/rag/config.js):

| Variable | Description | Default |
| :--- | :--- | :--- |
| `RAG_ENABLED` | Global toggle to enable/disable RAG | `true` |
| `EMBEDDING_MODEL` | Ollama model name for vector embeddings | `"nomic-embed-text"` |
| `RAG_CHUNK_SIZE` | Target character count per document chunk | `500` |
| `RAG_CHUNK_OVERLAP` | Character overlap between consecutive chunks | `50` |
| `RAG_TOP_K` | Number of top document chunks to retrieve | `3` |
| `RAG_MIN_SIMILARITY` | Minimum cosine similarity threshold | `0.25` |
| `RAG_DOCUMENTS_PATH` | Path to knowledge documents directory | `./data/documents` |
| `RAG_VECTOR_STORE_PATH` | Path to persistent vector index file | `./data/vectors/store.json` |

---

## How to Add Knowledge Documents

1. Place your knowledge files in the documents folder:
   `backend/src/rag/data/documents/`
2. Supported file formats:
   - Plain text files (`.txt`)
   - Markdown documents (`.md`)
   - PDF documents (`.pdf`)
3. Rebuild the vector index index by running:
   ```bash
   cd backend
   npm run rag:build
   ```

---

## How to Run & Test RAG

### 1. Run Automated Test Suite
To verify that document loading, chunking, embeddings, vector search, and prompt augmentation are functioning properly:
```bash
cd backend
npm run rag:test
```

### 2. Build / Update Vector Index
Whenever you add or update documents in `data/documents/`:
```bash
cd backend
npm run rag:build
```

### 3. Start Chatbot Server
Start the Express backend:
```bash
cd backend
npm run dev
```

---

## Connection to the Existing Local LLM

The RAG module interacts with your existing chatbot through **prompt augmentation**:
1. When a user question is received at `/api/chats/:id/completion` or `/api/chat`, `ragPipeline.retrieveContext(query)` performs a vector search against `vectorStore`.
2. If relevant document chunks are found, `ragPipeline.augmentMessages(messages, context)` prepends or appends a system prompt containing the retrieved text context block.
3. The augmented prompt is sent to `streamChatFromOllama()` or `sendChatToOllama()` as usual.
4. Your existing model loading, RAM management, and streaming pipeline remain completely untouched and fully functional.

---

## Example Query & Output

**User Question:**
> *"What model does the chatbot use?"*

**Retrieved Context (from `sample_knowledge.txt`):**
> `[Context Source 1: sample_knowledge.txt]`
> `Default Model: Qwen3 8B (qwen3:8b)`
> `Supported Models: Qwen3 8B, Qwen2.5 Coder 7B, Qwen2.5 VL 7B.`

**Augmented LLM Response:**
> *"Based on the project documentation, the chatbot defaults to using Qwen3 8B (`qwen3:8b`) and also supports Qwen2.5 Coder 7B and Qwen2.5 VL 7B."*
