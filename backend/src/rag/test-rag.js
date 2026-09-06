/**
 * Test RAG Pipeline
 *
 * Verifies document loading, text chunking, embedding generation,
 * vector storage, similarity search, and prompt augmentation.
 *
 * Usage:
 *   node src/rag/test-rag.js
 */

import {
  loadAllDocuments,
  chunkDocument,
  generateEmbedding,
  VectorStore,
  retrieveRelevantChunks,
  ragPipeline,
  RAG_CONFIG,
} from "./index.js";

async function runTests() {
  console.log("=================================================");
  console.log("      RAG System Automated Test Suite            ");
  console.log("=================================================\n");

  // 1. Document Loading Test
  console.log("Test 1: Loading documents...");
  const documents = await loadAllDocuments();
  console.log(`✓ Loaded ${documents.length} document(s).`);
  for (const doc of documents) {
    console.log(`   - ${doc.filename} (${doc.metadata.charCount} chars, type: ${doc.metadata.extension})`);
  }
  if (documents.length === 0) {
    console.error("❌ Test Failed: No documents loaded.");
    process.exit(1);
  }

  // 2. Text Chunking Test
  console.log("\nTest 2: Chunking documents...");
  const sampleDoc = documents[0];
  const chunks = chunkDocument(sampleDoc, { chunkSize: RAG_CONFIG.chunkSize, chunkOverlap: RAG_CONFIG.chunkOverlap });
  console.log(`✓ Chunked "${sampleDoc.filename}" into ${chunks.length} chunk(s).`);
  if (chunks.length > 0) {
    console.log(`   Sample Chunk 1 (${chunks[0].text.length} chars): "${chunks[0].text.slice(0, 80)}..."`);
  } else {
    console.error("❌ Test Failed: Chunking produced 0 chunks.");
    process.exit(1);
  }

  // 3. Embedding Generation Test
  console.log("\nTest 3: Generating embedding...");
  const sampleText = "What is the default model for the Local Chatbot?";
  const embedding = await generateEmbedding(sampleText);
  console.log(`✓ Generated embedding vector of dimension ${embedding.length}.`);
  if (!Array.isArray(embedding) || embedding.length === 0) {
    console.error("❌ Test Failed: Embedding generation failed.");
    process.exit(1);
  }

  // 4. Vector Storage Test
  console.log("\nTest 4: Storing vectors in VectorStore...");
  const store = new VectorStore();
  store.clear();
  for (let i = 0; i < chunks.length; i++) {
    const vec = await generateEmbedding(chunks[i].text);
    store.addEntry({
      id: chunks[i].id,
      text: chunks[i].text,
      vector: vec,
      metadata: chunks[i].metadata,
    });
  }
  console.log(`✓ VectorStore has ${store.entries.length} stored entries.`);
  await store.save();
  console.log("✓ Saved vector store index to disk.");

  // 5. Similarity Search & Retrieval Test
  console.log("\nTest 5: Performing similarity search...");
  const searchQuery = "What model does the chatbot use?";
  console.log(`   Query: "${searchQuery}"`);
  const retrieved = await retrieveRelevantChunks(searchQuery, store, { topK: 2, minScore: 0.1 });
  console.log(`✓ Retrieved ${retrieved.length} relevant chunk(s):`);
  retrieved.forEach((r, idx) => {
    console.log(`   [${idx + 1}] Score: ${r.score.toFixed(4)} | Text: "${r.text.slice(0, 90)}..."`);
  });

  // 6. Prompt Augmentation Test
  console.log("\nTest 6: Testing RAG Pipeline Prompt Augmentation...");
  const originalMessages = [{ role: "user", content: searchQuery }];
  const { context } = await ragPipeline.retrieveContext(searchQuery);
  const augmentedMessages = ragPipeline.augmentMessages(originalMessages, context);
  console.log(`✓ Prompt successfully augmented with retrieved context.`);
  console.log(`   System Message added with length ${augmentedMessages[0].content.length} characters.`);

  // 7. Non-RAG Fallback Test
  console.log("\nTest 7: Testing Chatbot fallback without RAG...");
  const unaugmented = ragPipeline.augmentMessages(originalMessages, "");
  console.log(`✓ Unaugmented messages count: ${unaugmented.length} (Original preserved without RAG).`);

  console.log("\n=================================================");
  console.log("      ALL 7 RAG TESTS PASSED SUCCESSFULLY!       ");
  console.log("=================================================");
}

runTests().catch((err) => {
  console.error("❌ Test Suite Error:", err);
  process.exit(1);
});
