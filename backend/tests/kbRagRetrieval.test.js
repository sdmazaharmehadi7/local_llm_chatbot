/**
 * Knowledge Base RAG Retrieval & Routing Unit Tests (Part 23)
 *
 * Runs deterministic, zero-inference test scenarios:
 * - No Ollama calls
 * - No nomic embeddings
 * - No real Qdrant connection required
 */

import assert from "assert";
import {
  routeMessage,
  normalizeDocName,
  detectKnowledgeBaseDocument,
} from "../src/services/ragRouter.service.js";
import { buildKnowledgeBaseContext } from "../src/services/contextBuilder.service.js";
import { extractSources } from "../../frontend2/src/components/chat/sourceUtils.js";

console.log("=== STARTING KNOWLEDGE BASE RAG UNIT TESTS ===");

const MOCK_DOCS = [
  { id: "doc-safety-101", filename: "Safety_Manual.pdf" },
  { id: "doc-maint-202", filename: "Maintenance_Guide.pdf" },
  { id: "doc-hr-303", filename: "HR_Policy.pdf" },
];

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1: Math question ("3 + 3") -> GENERAL (No KB retrieval)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST 1] Input: '3 + 3'");
{
  const result = routeMessage({
    message: "3 + 3",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_DOCS,
  });
  assert.strictEqual(result.route, "GENERAL", "Should route to GENERAL");
  assert.strictEqual(result.useRag, false, "useRag should be false");
  console.log("✔ TEST 1 PASSED: Correctly routed math expression to GENERAL.");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2: KB question without filename ("What are the PPE requirements?")
// Expected: KNOWLEDGE_BASE, GLOBAL mode, no documentId
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST 2] Input: 'What are the PPE requirements?'");
{
  const result = routeMessage({
    message: "What are the PPE requirements?",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_DOCS,
  });
  assert.strictEqual(result.route, "KNOWLEDGE_BASE", "Should route to KNOWLEDGE_BASE");
  assert.strictEqual(result.useRag, true, "useRag should be true");
  assert.strictEqual(result.retrievalMode, "GLOBAL", "Mode should be GLOBAL");
  assert.strictEqual(result.targetDocumentId, null, "Should not filter by specific documentId");
  console.log("✔ TEST 2 PASSED: Correctly identified KB procedural query in GLOBAL mode.");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3: KB question with explicit filename ("What does Safety_Manual.pdf say about PPE?")
// Expected: KNOWLEDGE_BASE, DOCUMENT_SPECIFIC mode, targetDocumentId = doc-safety-101
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST 3] Input: 'What does Safety_Manual.pdf say about PPE?'");
{
  const result = routeMessage({
    message: "What does Safety_Manual.pdf say about PPE?",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_DOCS,
  });
  assert.strictEqual(result.route, "KNOWLEDGE_BASE", "Should route to KNOWLEDGE_BASE");
  assert.strictEqual(result.useRag, true, "useRag should be true");
  assert.strictEqual(result.retrievalMode, "DOCUMENT_SPECIFIC", "Mode should be DOCUMENT_SPECIFIC");
  assert.strictEqual(result.targetDocumentId, "doc-safety-101", "Should resolve to Safety_Manual ID");
  assert.strictEqual(result.targetFilename, "Safety_Manual.pdf");
  console.log("✔ TEST 3 PASSED: Resolved document ID doc-safety-101 for DOCUMENT_SPECIFIC retrieval.");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4: Chunk deduplication & Single Resource Guarantee
// Mock Qdrant returns:
// Safety_Manual.pdf page 10 chunk 1
// Safety_Manual.pdf page 10 chunk 2
// Safety_Manual.pdf page 11 chunk 1
// Expected final sources: EXACTLY 1 unique document resource (aggregating Pages 10 and 11)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST 4] Context Builder & Single Resource Deduplication");
{
  const mockPoints = [
    {
      score: 0.85,
      payload: {
        documentId: "doc-safety-101",
        filename: "Safety_Manual.pdf",
        page: 10,
        chunkIndex: 1,
        scope: "knowledge_base",
        text: "Section on protective gloves and footwear for shop floor workers.",
      },
    },
    {
      score: 0.83,
      payload: {
        documentId: "doc-safety-101",
        filename: "Safety_Manual.pdf",
        page: 10,
        chunkIndex: 2,
        scope: "knowledge_base",
        text: "Further specifications on high-visibility vests on page 10.",
      },
    },
    {
      score: 0.81,
      payload: {
        documentId: "doc-safety-101",
        filename: "Safety_Manual.pdf",
        page: 11,
        chunkIndex: 1,
        scope: "knowledge_base",
        text: "Eye and face protection guidelines in Section 3 on page 11.",
      },
    },
  ];

  const contextResult = buildKnowledgeBaseContext(mockPoints, {
    targetDocumentId: "doc-safety-101",
    scoreThreshold: 0.35,
  });

  assert.strictEqual(contextResult.hasContext, true);
  assert.strictEqual(contextResult.sources.length, 1, "A single document resource must produce exactly 1 source entry");
  assert.deepStrictEqual(contextResult.sources[0].pages, [10, 11], "Must aggregate all cited pages [10, 11]");

  // Test frontend source extractor: guarantees single resource is never shown two times
  const frontendSources = extractSources(null, { ragSources: contextResult.sources });
  assert.strictEqual(frontendSources.length, 1, "Frontend must render exactly 1 unique resource pill");
  assert.strictEqual(frontendSources[0].filename, "Safety_Manual.pdf");
  assert.strictEqual(frontendSources[0].pageBadge, "pp. 10, 11");
  assert.strictEqual(frontendSources[0].title, "Safety_Manual.pdf — Pages 10, 11");
  console.log("✔ TEST 4 PASSED: Single resource with multiple pages rendered as exactly 1 source pill with aggregated pages badge (pp. 10, 11).");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 5: Global KB retrieval score filtering
// Safety_Manual score 0.88, Maintenance score 0.84, HR_Policy score 0.21
// Expected: HR_Policy removed by scoreThreshold (0.35)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST 5] Relevance Score Filtering");
{
  const mockPoints = [
    {
      score: 0.88,
      payload: {
        documentId: "doc-safety-101",
        filename: "Safety_Manual.pdf",
        page: 2,
        chunkIndex: 0,
        scope: "knowledge_base",
        text: "Safety procedures for high pressure systems.",
      },
    },
    {
      score: 0.84,
      payload: {
        documentId: "doc-maint-202",
        filename: "Maintenance_Guide.pdf",
        page: 5,
        chunkIndex: 0,
        scope: "knowledge_base",
        text: "Daily checklist for pump maintenance.",
      },
    },
    {
      score: 0.21,
      payload: {
        documentId: "doc-hr-303",
        filename: "HR_Policy.pdf",
        page: 1,
        chunkIndex: 0,
        scope: "knowledge_base",
        text: "Annual leave accrual rate and policy.",
      },
    },
  ];

  const contextResult = buildKnowledgeBaseContext(mockPoints, {
    scoreThreshold: 0.35,
  });

  const filenamesInContext = contextResult.sources.map((s) => s.filename);
  assert(filenamesInContext.includes("Safety_Manual.pdf"), "Should contain Safety_Manual.pdf");
  assert(filenamesInContext.includes("Maintenance_Guide.pdf"), "Should contain Maintenance_Guide.pdf");
  assert(!filenamesInContext.includes("HR_Policy.pdf"), "HR_Policy.pdf MUST be filtered out (score 0.21 < 0.35)");
  console.log("✔ TEST 5 PASSED: Irrelevant chunk (0.21) filtered out; 0.88 and 0.84 retained.");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6: Document-specific query strictness
// Target documentId = doc-safety-101
// Mock Qdrant returns Safety_Manual.pdf and Maintenance_Guide.pdf
// Expected: Maintenance_Guide.pdf discarded. Final context contains only Safety_Manual.pdf
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST 6] Document-Specific Strict Filtering");
{
  const mockPoints = [
    {
      score: 0.85,
      payload: {
        documentId: "doc-safety-101",
        filename: "Safety_Manual.pdf",
        page: 4,
        chunkIndex: 1,
        scope: "knowledge_base",
        text: "Correct safety procedure in doc-safety-101.",
      },
    },
    {
      score: 0.92, // Higher score, but wrong documentId
      payload: {
        documentId: "doc-maint-202",
        filename: "Maintenance_Guide.pdf",
        page: 8,
        chunkIndex: 1,
        scope: "knowledge_base",
        text: "Maintenance chunk from different document.",
      },
    },
  ];

  const contextResult = buildKnowledgeBaseContext(mockPoints, {
    targetDocumentId: "doc-safety-101",
    scoreThreshold: 0.35,
  });

  assert.strictEqual(contextResult.sources.length, 1, "Must contain chunks from target document only");
  assert.strictEqual(contextResult.sources[0].documentId, "doc-safety-101");
  assert(!contextResult.contextText.includes("Maintenance_Guide.pdf"));
  console.log("✔ TEST 6 PASSED: Cross-document leakage prevented; non-matching document discarded.");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 7: Chat RAG query
// Expected: route = CHAT_DOCUMENT, scope = chat
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST 7] Chat RAG Query");
{
  const result = routeMessage({
    message: "What were the findings in my uploaded resume?",
    hasChatDocuments: true,
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_DOCS,
  });
  assert.strictEqual(result.route, "CHAT_DOCUMENT");
  assert.strictEqual(result.useRag, true);
  console.log("✔ TEST 7 PASSED: Chat-specific query routed to CHAT_DOCUMENT.");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 8: KB query scope isolation
// Expected: scope = knowledge_base
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST 8] Knowledge Base Query Scope Isolation");
{
  const mockChatPoint = {
    score: 0.95,
    payload: {
      documentId: "chat-doc-999",
      scope: "chat", // WRONG SCOPE
      filename: "Chat_Resume.pdf",
      text: "Candidate has 5 years experience.",
    },
  };

  const contextResult = buildKnowledgeBaseContext([mockChatPoint], {
    scoreThreshold: 0.35,
  });

  assert.strictEqual(contextResult.hasContext, false, "Chat point must be rejected from KB context");
  assert.strictEqual(contextResult.sources.length, 0);
  console.log("✔ TEST 8 PASSED: Chunks with scope='chat' strictly rejected by KB context builder.");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 9: Conversational Follow-up Continuity
// Turn 1: "What does Safety Manual say about PPE?" -> Safety_Manual.pdf
// Turn 2: "What is the inspection frequency?"
// Expected: Router preserves document reference doc-safety-101
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST 9] Conversational Follow-up Continuity");
{
  const history = [
    {
      role: "user",
      content: "What does Safety Manual say about PPE?",
    },
    {
      role: "assistant",
      content: "Workers must wear gloves and safety glasses. Sources: - Safety_Manual.pdf — Page 10",
      metadata: {
        ragSources: [
          {
            documentId: "doc-safety-101",
            filename: "Safety_Manual.pdf",
            page: 10,
          },
        ],
      },
    },
  ];

  const followUpResult = routeMessage({
    message: "What is the inspection frequency?",
    conversationHistory: history,
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_DOCS,
  });

  assert.strictEqual(followUpResult.route, "KNOWLEDGE_BASE");
  assert.strictEqual(followUpResult.useRag, true);
  assert.strictEqual(followUpResult.targetDocumentId, "doc-safety-101", "Should preserve active doc ID");
  assert.strictEqual(followUpResult.targetFilename, "Safety_Manual.pdf");
  console.log("✔ TEST 9 PASSED: Conversational follow-up correctly preserved Safety_Manual document context.");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 10: Two KB documents have similar names -> No unsafe fuzzy selection
// Doc A: Safety_Manual_v1.pdf
// Doc B: Safety_Manual_v2.pdf
// User asks: "What does the safety manual say?"
// Expected: Ambiguity detected -> no guessing, falls back safely to GLOBAL search
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST 10] Ambiguous Similar Document Names");
{
  const ambiguousDocs = [
    { id: "doc-v1", filename: "Safety_Manual_v1.pdf" },
    { id: "doc-v2", filename: "Safety_Manual_v2.pdf" },
  ];

  const detection = detectKnowledgeBaseDocument("What does the safety manual say?", ambiguousDocs);
  assert.strictEqual(detection.documentId, null, "Should not arbitrarily pick v1 or v2");
  assert.strictEqual(detection.isAmbiguous, true, "Should flag isAmbiguous as true");

  const routeResult = routeMessage({
    message: "What does the safety manual say?",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: ambiguousDocs,
  });

  assert.strictEqual(routeResult.route, "KNOWLEDGE_BASE");
  assert.strictEqual(routeResult.retrievalMode, "GLOBAL", "Ambiguous documents must fall back to GLOBAL search");
  assert.strictEqual(routeResult.targetDocumentId, null);
  console.log("✔ TEST 10 PASSED: Ambiguous candidate documents correctly fell back to safe GLOBAL search.");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 11: Slash Command: "/knowledgebase What is the company's safety procedure?"
// Expected:
// - Route = KNOWLEDGE_BASE, useRag = true
// - Prefix "/knowledgebase" removed from cleanedQuery
// - isEmptyCommand = false
// - Mode = GLOBAL
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST 11] Input: '/knowledgebase What is the company\\'s safety procedure?'");
{
  const result = routeMessage({
    message: "/knowledgebase What is the company's safety procedure?",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_DOCS,
  });

  assert.strictEqual(result.route, "KNOWLEDGE_BASE");
  assert.strictEqual(result.useRag, true);
  assert.strictEqual(result.isEmptyCommand, false);
  assert.strictEqual(result.cleanedQuery, "What is the company's safety procedure?");
  assert.strictEqual(result.cleanedQuery.includes("/knowledgebase"), false, "Cleaned query must NOT include /knowledgebase");
  console.log("✔ TEST 11 PASSED: /knowledgebase command routed to KB with prefix removed.");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 12: Case-Insensitive Command: "/KNOWLEDGEBASE what are the safety rules?"
// Expected:
// - Case-insensitive detection (/KNOWLEDGEBASE, /KnowledgeBase)
// - Route = KNOWLEDGE_BASE
// - Cleaned query without prefix
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST 12] Input: '/KNOWLEDGEBASE what are the safety rules?'");
{
  const result = routeMessage({
    message: "/KNOWLEDGEBASE what are the safety rules?",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_DOCS,
  });

  assert.strictEqual(result.route, "KNOWLEDGE_BASE");
  assert.strictEqual(result.useRag, true);
  assert.strictEqual(result.cleanedQuery, "what are the safety rules?");
  assert.strictEqual(result.cleanedQuery.toLowerCase().includes("/knowledgebase"), false);
  console.log("✔ TEST 12 PASSED: Case-insensitive /KNOWLEDGEBASE command recognized.");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 13: Slash Command Alone: "/knowledgebase" and "/KnowledgeBase   "
// Expected:
// - isEmptyCommand = true
// - cleanedQuery = ""
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST 13] Input: '/knowledgebase' alone");
{
  const resultAlone = routeMessage({
    message: "/knowledgebase",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_DOCS,
  });

  assert.strictEqual(resultAlone.route, "KNOWLEDGE_BASE");
  assert.strictEqual(resultAlone.isEmptyCommand, true);
  assert.strictEqual(resultAlone.cleanedQuery, "");

  const resultSpaces = routeMessage({
    message: "/KnowledgeBase   ",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_DOCS,
  });

  assert.strictEqual(resultSpaces.route, "KNOWLEDGE_BASE");
  assert.strictEqual(resultSpaces.isEmptyCommand, true);
  assert.strictEqual(resultSpaces.cleanedQuery, "");
  console.log("✔ TEST 13 PASSED: /knowledgebase alone correctly identified as empty command.");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 14: Slash Command With Specific Document: "/knowledgebase What does Safety_Manual.pdf say about PPE?"
// Expected:
// - Route = KNOWLEDGE_BASE
// - Mode = DOCUMENT_SPECIFIC
// - targetDocumentId = doc-safety-101
// - cleanedQuery without /knowledgebase
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST 14] Input: '/knowledgebase What does Safety_Manual.pdf say about PPE?'");
{
  const result = routeMessage({
    message: "/knowledgebase What does Safety_Manual.pdf say about PPE?",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_DOCS,
  });

  assert.strictEqual(result.route, "KNOWLEDGE_BASE");
  assert.strictEqual(result.retrievalMode, "DOCUMENT_SPECIFIC");
  assert.strictEqual(result.targetDocumentId, "doc-safety-101");
  assert.strictEqual(result.cleanedQuery, "What does Safety_Manual.pdf say about PPE?");
  assert.strictEqual(result.cleanedQuery.includes("/knowledgebase"), false);
  console.log("✔ TEST 14 PASSED: /knowledgebase with specific document correctly resolves document ID.");
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST 15: General message without /knowledgebase remains unchanged
// Expected:
// - Normal general message routes to GENERAL
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[TEST 15] Input: 'In which direction does the sun rise?'");
{
  const result = routeMessage({
    message: "In which direction does the sun rise?",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_DOCS,
  });

  assert.strictEqual(result.route, "GENERAL");
  assert.strictEqual(result.useRag, false);
  console.log("✔ TEST 15 PASSED: General message without /knowledgebase routed to GENERAL unchanged.");
}

console.log("\n==================================================");
console.log("ALL 15 UNIT TEST SCENARIOS PASSED SUCCESSFULLY!");
console.log("==================================================");
