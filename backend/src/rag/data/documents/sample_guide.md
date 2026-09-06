# RAG System Operating Instructions

## Overview
Retrieval-Augmented Generation (RAG) empowers local LLMs with context retrieved directly from internal documents.

## Step-by-Step Document Ingestion
1. Place `.txt`, `.md`, or `.pdf` files inside `backend/src/rag/data/documents/`.
2. Run `npm run rag:build` inside the `backend` folder to build or refresh vector index.
3. Start the backend server using `npm run dev`.

## Safety & Local Execution
All vector embeddings and vector similarity calculations are processed locally. No user text or uploaded document leaves your hardware.
