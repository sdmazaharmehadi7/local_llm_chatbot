/**
 * Knowledge Base RAG Retrieval & Routing Unit & Acceptance Tests
 *
 * Runs deterministic, zero-inference test scenarios:
 * - No Ollama live calls
 * - No nomic embeddings
 * - No real Qdrant connection required
 *
 * Verifies all 8 user acceptance tests:
 * Test 1 — Normal Chat: "What is lockout/tagout?" -> General LLM, no KB retrieval
 * Test 2 — Normal Chat + Attachment: "Summarize this document" -> Attached doc only, no KB
 * Test 3 — Normal Chat Despite Relevant KB Document: "What is the rated flow of P-204A?" -> General LLM, no KB
 * Test 4 — /knowledgebase: "What is the rated flow of P-204A?" -> Retrieves ENG-PMP-014 with source
 * Test 5 — /knowledgebase fallback: "What is photosynthesis?" -> Natural fallback, no "Not found", no sources
 * Test 6 — /knowledgebase with relevant document: "What PPE is required for pump maintenance?" -> Retrieves SAF-PMP-001 with source
 * Test 7 — Agent: Multi-step Retrieval + Calculator tool selection preserved
 * Test 8 — Agent Vision: Image attachment handled by Agent Vision without forcing KB
 */

import assert from "assert";
import {
  routeMessage,
  normalizeDocName,
  detectKnowledgeBaseDocument,
} from "../src/services/ragRouter.service.js";
import { buildKnowledgeBaseContext, buildAugmentedKnowledgeBaseMessages } from "../src/services/contextBuilder.service.js";
import { extractSources } from "../../frontend2/src/components/chat/sourceUtils.js";
import { validateToolSelectionPolicy } from "../src/services/agent/qwenBrain.service.js";

console.log("=== STARTING CHAT / KNOWLEDGE BASE ROUTING & CONTEXT ISOLATION TESTS ===");

const MOCK_KB_DOCS = [
  { id: "doc-p204a", filename: "ENG-PMP-014.pdf" },
  { id: "doc-saf-001", filename: "SAF-PMP-001.pdf" },
  { id: "doc-safety-101", filename: "Safety_Manual.pdf" },
  { id: "doc-maint-202", filename: "Maintenance_Guide.pdf" },
];

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 1: Normal Chat — General Model Knowledge Only
// Question: "What is lockout/tagout?"
// Expected: General LLM answer. No Knowledge Base retrieval.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 1] Normal Chat: 'What is lockout/tagout?'");
{
  const result = routeMessage({
    message: "What is lockout/tagout?",
    mode: "normal",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_KB_DOCS,
  });

  assert.strictEqual(result.route, "GENERAL", "Must route to GENERAL");
  assert.strictEqual(result.useRag, false, "useRag must be false");
  assert.strictEqual(result.targetDocumentId, null);
  console.log("✔ TEST 1 PASSED: Normal chat answered by general LLM with zero KB retrieval.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 2: Normal Chat + Attachment
// Attach a document and ask: "Summarize this document."
// Expected: Attached document is analyzed. Knowledge Base retrieval must NOT occur.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 2] Normal Chat + Attachment: 'Summarize this document.'");
{
  const mockAttachedFiles = [
    {
      id: "att-1",
      filename: "user_uploaded_notes.pdf",
      category: "pdf",
      mimeType: "application/pdf",
      scope: "chat",
    },
  ];

  const result = routeMessage({
    message: "Summarize this document.",
    mode: "normal",
    attachedFiles: mockAttachedFiles,
    hasChatDocuments: true,
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_KB_DOCS,
  });

  assert.strictEqual(result.route, "CHAT_DOCUMENT", "Must route to CHAT_DOCUMENT");
  assert.strictEqual(result.useRag, true, "useRag must be true for chat attachment");
  assert.notStrictEqual(result.route, "KNOWLEDGE_BASE", "Must NOT access Knowledge Base");
  console.log("✔ TEST 2 PASSED: Attached document used for context; KB retrieval did NOT occur.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 3: Normal Chat Despite Relevant KB Document
// If KB contains P-204A, ask in normal chat: "What is the rated flow of P-204A?"
// Expected: Answer using general model knowledge. DO NOT retrieve P-204A from KB.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 3] Normal Chat with KB Document in Workspace: 'What is the rated flow of P-204A?'");
{
  const result = routeMessage({
    message: "What is the rated flow of P-204A?",
    mode: "normal",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_KB_DOCS,
  });

  assert.strictEqual(result.route, "GENERAL", "Must route to GENERAL in normal chat");
  assert.strictEqual(result.useRag, false, "useRag must be false");
  assert.strictEqual(result.targetDocumentId, null);
  console.log("✔ TEST 3 PASSED: Normal chat bypassed KB retrieval despite relevant P-204A document in workspace.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 4: /knowledgebase Mode
// Ask: "What is the rated flow of P-204A?"
// Expected: Retrieve ENG-PMP-014 and answer: 120 m³/h with appropriate source.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 4] /knowledgebase: 'What is the rated flow of P-204A?'");
{
  // 1. Slash command routing
  const resultSlash = routeMessage({
    message: "/knowledgebase What is the rated flow of P-204A?",
    mode: "normal",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_KB_DOCS,
  });

  assert.strictEqual(resultSlash.route, "KNOWLEDGE_BASE", "Must route to KNOWLEDGE_BASE");
  assert.strictEqual(resultSlash.useRag, true, "useRag must be true");
  assert.strictEqual(resultSlash.retrievalMode, "GLOBAL", "Global search when document name not explicitly typed");
  assert.strictEqual(resultSlash.cleanedQuery, "What is the rated flow of P-204A?");

  // 2. Explicit mode routing
  const resultMode = routeMessage({
    message: "What is the rated flow of P-204A?",
    mode: "knowledgebase",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_KB_DOCS,
  });
  assert.strictEqual(resultMode.route, "KNOWLEDGE_BASE");
  assert.strictEqual(resultMode.useRag, true);

  // 3. Document-specific mention routing
  const resultDocSpecific = routeMessage({
    message: "/knowledgebase What is the rated flow in ENG-PMP-014.pdf?",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_KB_DOCS,
  });
  assert.strictEqual(resultDocSpecific.route, "KNOWLEDGE_BASE");
  assert.strictEqual(resultDocSpecific.retrievalMode, "DOCUMENT_SPECIFIC");
  assert.strictEqual(resultDocSpecific.targetDocumentId, "doc-p204a");
  assert.strictEqual(resultDocSpecific.targetFilename, "ENG-PMP-014.pdf");

  // 4. Mock Qdrant retrieval result for P-204A query from ENG-PMP-014.pdf
  const mockP204Points = [
    {
      score: 0.94,
      payload: {
        documentId: "doc-p204a",
        filename: "ENG-PMP-014.pdf",
        page: 1,
        chunkIndex: 0,
        scope: "knowledge_base",
        text: "Pump P-204A specification: Rated flow rate is 120 m³/h at rated head of 45m.",
      },
    },
  ];

  const contextResult = buildKnowledgeBaseContext(mockP204Points, { scoreThreshold: 0.35 });
  assert.strictEqual(contextResult.hasContext, true);
  assert.strictEqual(contextResult.sources.length, 1);
  assert.strictEqual(contextResult.sources[0].filename, "ENG-PMP-014.pdf");
  assert.deepStrictEqual(contextResult.sources[0].pages, [1]);
  assert.strictEqual(contextResult.contextText.includes("120 m³/h"), true);

  console.log("✔ TEST 4 PASSED: /knowledgebase routed to KB, retrieved ENG-PMP-014 with 120 m³/h context & source.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 5: /knowledgebase Fallback
// Ask: "What is photosynthesis?"
// If the Knowledge Base contains nothing relevant:
// Expected: Fallback to general model internal knowledge.
// DO NOT say: "Not found in the Knowledge Base."
// DO NOT fabricate Knowledge Base sources.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 5] /knowledgebase Fallback: 'What is photosynthesis?'");
{
  // 1. Router routes to KB because of /knowledgebase mode
  const routeRes = routeMessage({
    message: "/knowledgebase What is photosynthesis?",
    mode: "knowledgebase",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_KB_DOCS,
  });
  assert.strictEqual(routeRes.route, "KNOWLEDGE_BASE");
  assert.strictEqual(routeRes.retrievalMode, "GLOBAL");
  assert.strictEqual(routeRes.cleanedQuery, "What is photosynthesis?");

  // 2. Mock Qdrant retrieval returning zero chunks
  const mockEmptyPoints = [];
  const contextResult = buildKnowledgeBaseContext(mockEmptyPoints, { scoreThreshold: 0.35 });
  assert.strictEqual(contextResult.hasContext, false, "Empty points produce no context");
  assert.strictEqual(contextResult.sources.length, 0, "Empty points produce zero sources");

  // 3. Verify that contextBuilder instructions do NOT contain the forbidden sentence
  const augmentedPrompt = buildAugmentedKnowledgeBaseMessages(
    [{ role: "user", content: "What is photosynthesis?" }],
    "Photosynthesis definition...",
    [{ filename: "Biology.pdf", page: 1 }]
  );
  const sysMsg = augmentedPrompt.find((m) => m.role === "system")?.content || "";
  assert.strictEqual(
    sysMsg.includes("I couldn't find relevant information in the Knowledge Base."),
    false,
    "Prompt must NOT contain the forbidden 'couldn't find' response instruction"
  );

  console.log("✔ TEST 5 PASSED: KB fallback to general model enabled with zero fake sources and no forbidden phrasing.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 6: /knowledgebase With Relevant Document
// Ask: "What PPE is required for pump maintenance?"
// Expected: Retrieve SAF-PMP-001 and answer using document with source attribution.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 6] /knowledgebase: 'What PPE is required for pump maintenance?'");
{
  const result = routeMessage({
    message: "/knowledgebase What PPE is required for pump maintenance?",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_KB_DOCS,
  });

  assert.strictEqual(result.route, "KNOWLEDGE_BASE");
  assert.strictEqual(result.useRag, true);
  assert.strictEqual(result.retrievalMode, "GLOBAL");
  assert.strictEqual(result.cleanedQuery, "What PPE is required for pump maintenance?");

  // Explicit document mention test
  const resultExplicit = routeMessage({
    message: "/knowledgebase What does SAF-PMP-001.pdf say about PPE?",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_KB_DOCS,
  });
  assert.strictEqual(resultExplicit.route, "KNOWLEDGE_BASE");
  assert.strictEqual(resultExplicit.targetDocumentId, "doc-saf-001");
  assert.strictEqual(resultExplicit.targetFilename, "SAF-PMP-001.pdf");

  // Verify context builder formats verified sources
  const mockPoints = [
    {
      score: 0.92,
      payload: {
        documentId: "doc-saf-001",
        filename: "SAF-PMP-001.pdf",
        page: 4,
        chunkIndex: 0,
        scope: "knowledge_base",
        text: "Maintenance technicians must wear safety glasses, cut-resistant gloves, and steel-toe boots.",
      },
    },
  ];

  const contextResult = buildKnowledgeBaseContext(mockPoints, { scoreThreshold: 0.35 });
  assert.strictEqual(contextResult.hasContext, true);
  assert.strictEqual(contextResult.sources.length, 1);
  assert.strictEqual(contextResult.sources[0].filename, "SAF-PMP-001.pdf");
  assert.deepStrictEqual(contextResult.sources[0].pages, [4]);

  console.log("✔ TEST 6 PASSED: SAF-PMP-001 retrieved and properly attributed.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 7: Agent Retrieval + Calculator Multi-step
// Ask: "What are the safety limits and calculate 25 * 4"
// Expected: Agent independently determines tool selection without hardcoded paths.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 7] Agent: Multi-tool autonomy");
{
  // 1. Router routes /agent to AGENT mode
  const routeRes = routeMessage({
    message: "/agent What are the safety limits and calculate 25 * 4",
    mode: "agent",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_KB_DOCS,
  });

  assert.strictEqual(routeRes.route, "AGENT", "Must route to AGENT");
  assert.strictEqual(routeRes.useRag, false, "RAG is handled autonomously by the agent graph");
  assert.strictEqual(routeRes.cleanedQuery, "What are the safety limits and calculate 25 * 4");

  // 2. Verify agent tool selection policy permits retrieval when document content is asked
  const retrievalDecision = validateToolSelectionPolicy(
    { action: "call_tool", tool: "retrieve_information", input: { query: "safety limits" } },
    { userRequest: "What are the safety limits and calculate 25 * 4", steps: [] }
  );
  assert.strictEqual(retrievalDecision.valid, true, "retrieve_information is valid for document queries");

  // 3. Verify agent tool selection policy permits calculator for math expression
  const calcDecision = validateToolSelectionPolicy(
    { action: "call_tool", tool: "calculator", input: { expression: "25 * 4" } },
    {
      userRequest: "What are the safety limits and calculate 25 * 4",
      steps: [{ tool: "retrieve_information", result: "Safety limit is 100 bar" }],
    }
  );
  assert.strictEqual(calcDecision.valid, true, "calculator is valid for arithmetic");

  console.log("✔ TEST 7 PASSED: Agent routing and autonomous tool selection preserved.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 8: Agent Vision
// Attach an image and ask the Agent to analyze it.
// Expected: Vision is decided by Agent without forcing KB retrieval.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 8] Agent Vision: Image analysis");
{
  const routeRes = routeMessage({
    message: "/agent Describe the contents of this uploaded image",
    mode: "agent",
    attachedFiles: [{ id: "img-1", category: "image", mimeType: "image/png" }],
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_KB_DOCS,
  });

  assert.strictEqual(routeRes.route, "AGENT");
  assert.strictEqual(routeRes.cleanedQuery, "Describe the contents of this uploaded image");

  // Vision tool policy validation
  const visionDecision = validateToolSelectionPolicy(
    { action: "call_tool", tool: "vision_analyze", input: { prompt: "Describe image" } },
    { userRequest: "Describe the contents of this uploaded image", steps: [] }
  );
  assert.strictEqual(visionDecision.valid, true, "Vision tool is valid for image query");

  console.log("✔ TEST 8 PASSED: Agent Vision operates without forcing KB retrieval.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 9: Strict Context Isolation Across Turns
// Normal chat following a KB turn must not inherit KB retrieval results.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 9] Strict Context Isolation Across Turns");
{
  const previousHistoryWithKbSources = [
    { role: "user", content: "/knowledgebase What is pump P-204A?" },
    {
      role: "assistant",
      content: "Pump P-204A is rated for 120 m³/h.\n\nSources:\n- ENG-PMP-014.pdf — Page 1",
      metadata: {
        ragSources: [{ documentId: "doc-p204a", filename: "ENG-PMP-014.pdf", page: 1 }],
      },
    },
  ];

  // User now sends a normal chat message without /knowledgebase
  const turnResult = routeMessage({
    message: "Tell me a joke about engineers",
    mode: "normal",
    conversationHistory: previousHistoryWithKbSources,
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_KB_DOCS,
  });

  assert.strictEqual(turnResult.route, "GENERAL", "Normal chat turn must remain GENERAL");
  assert.strictEqual(turnResult.useRag, false, "Must NOT perform KB retrieval");
  assert.strictEqual(turnResult.targetDocumentId, null);

  console.log("✔ TEST 9 PASSED: Normal chat turn strictly isolated from prior KB turn sources.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 10: Empty /knowledgebase Slash Command
// Expected: isEmptyCommand = true, cleanedQuery = ""
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 10] Empty /knowledgebase command");
{
  const emptyRes = routeMessage({
    message: "/knowledgebase",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: MOCK_KB_DOCS,
  });

  assert.strictEqual(emptyRes.route, "KNOWLEDGE_BASE");
  assert.strictEqual(emptyRes.isEmptyCommand, true);
  assert.strictEqual(emptyRes.cleanedQuery, "");
  console.log("✔ TEST 10 PASSED: Empty /knowledgebase slash command detected.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 11: Single Resource Guarantee & Chunk Deduplication
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 11] Single Resource Guarantee in Context Builder & Frontend");
{
  const mockPoints = [
    {
      score: 0.85,
      payload: {
        documentId: "doc-saf-001",
        filename: "SAF-PMP-001.pdf",
        page: 10,
        chunkIndex: 1,
        scope: "knowledge_base",
        text: "Section on protective gloves.",
      },
    },
    {
      score: 0.83,
      payload: {
        documentId: "doc-saf-001",
        filename: "SAF-PMP-001.pdf",
        page: 10,
        chunkIndex: 2,
        scope: "knowledge_base",
        text: "Specifications on high-visibility vests.",
      },
    },
    {
      score: 0.81,
      payload: {
        documentId: "doc-saf-001",
        filename: "SAF-PMP-001.pdf",
        page: 11,
        chunkIndex: 1,
        scope: "knowledge_base",
        text: "Eye and face protection guidelines.",
      },
    },
  ];

  const contextResult = buildKnowledgeBaseContext(mockPoints, {
    targetDocumentId: "doc-saf-001",
    scoreThreshold: 0.35,
  });

  assert.strictEqual(contextResult.hasContext, true);
  assert.strictEqual(contextResult.sources.length, 1, "Exactly 1 source entry for single document");
  assert.deepStrictEqual(contextResult.sources[0].pages, [10, 11]);

  const frontendSources = extractSources(null, { ragSources: contextResult.sources });
  assert.strictEqual(frontendSources.length, 1);
  assert.strictEqual(frontendSources[0].filename, "SAF-PMP-001.pdf");
  assert.strictEqual(frontendSources[0].pageBadge, "pp. 10, 11");
  console.log("✔ TEST 11 PASSED: Multi-chunk single resource rendered as 1 aggregated source pill.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 12: Single-Document PPE Query With 5-Document KB Pool
// Query: "What are the required PPE items for maintenance on an electrically driven process pump?"
// Expected: Only SAF-PMP-001 is included; all 4 other documents strictly filtered out.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 12] Single-Document PPE Query: Discard 4 Unrelated Documents");
{
  const rawQdrantMatches = [
    {
      score: 0.795,
      payload: {
        documentId: "doc-saf-001",
        filename: "SAF-PMP-001 — Pump Safety Procedure.pdf",
        page: 3,
        chunkIndex: 1,
        scope: "knowledge_base",
        text: "Section 3.2 Required Personal Protective Equipment (PPE) for electrically driven process pump maintenance: Safety goggles, chemical-resistant nitrile gloves, steel-toe boots, and arc-flash face shield.",
      },
    },
    {
      score: 0.762,
      payload: {
        documentId: "doc-saf-001",
        filename: "SAF-PMP-001 — Pump Safety Procedure.pdf",
        page: 4,
        chunkIndex: 2,
        scope: "knowledge_base",
        text: "Additional PPE requirements during pump disassembly: Hearing protection (NRR 25dB or higher) and high-visibility vest.",
      },
    },
    {
      score: 0.647,
      payload: {
        documentId: "doc-eng-014",
        filename: "ENG-PMP-014 — Pump Engineering Reference.pdf",
        page: 1,
        chunkIndex: 0,
        scope: "knowledge_base",
        text: "Pump P-204A is a horizontal centrifugal pump driven by a 45 kW electric induction motor at 2950 RPM.",
      },
    },
    {
      score: 0.618,
      payload: {
        documentId: "doc-konkan",
        filename: "KonkanValve_SOP_PRV.pdf",
        page: 2,
        chunkIndex: 0,
        scope: "knowledge_base",
        text: "Standard Operating Procedure for Pressure Relief Valve PRV-101 calibration and seat leakage test.",
      },
    },
    {
      score: 0.603,
      payload: {
        documentId: "doc-deccan",
        filename: "DeccanPetrochemicals_InspectionReport.pdf",
        page: 5,
        chunkIndex: 1,
        scope: "knowledge_base",
        text: "NDT ultrasonic thickness gauging results for hydrocarbon transfer piping circuit C-104.",
      },
    },
    {
      score: 0.589,
      payload: {
        documentId: "doc-malabar",
        filename: "MalabarFabricators_VendorNote.pdf",
        page: 1,
        chunkIndex: 0,
        scope: "knowledge_base",
        text: "Material test certificate and mill inspection release note for structural steel beams Grade ASTM A36.",
      },
    },
  ];

  const query = "What are the required PPE items for maintenance on an electrically driven process pump?";
  const result = buildKnowledgeBaseContext(rawQdrantMatches, { query, scoreThreshold: 0.35 });

  assert.strictEqual(result.hasContext, true);
  assert.strictEqual(result.sources.length, 1, "Must retain exactly 1 source document");
  assert.strictEqual(
    result.sources[0].filename,
    "SAF-PMP-001 — Pump Safety Procedure.pdf",
    "Source must be SAF-PMP-001"
  );
  assert.deepStrictEqual(result.sources[0].pages, [3, 4], "Aggregated pages must be [3, 4]");
  assert.strictEqual(
    result.contextText.includes("KonkanValve"),
    false,
    "KonkanValve must NOT be in context"
  );
  assert.strictEqual(
    result.contextText.includes("DeccanPetrochemicals"),
    false,
    "Deccan must NOT be in context"
  );
  assert.strictEqual(
    result.contextText.includes("MalabarFabricators"),
    false,
    "Malabar must NOT be in context"
  );

  console.log("✔ TEST 12 PASSED: Only SAF-PMP-001 retained for PPE query; 4 unrelated docs filtered out.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 13: Multi-Document Query
// Query: "What is the rated flow of P-204A and what PPE is required during its maintenance?"
// Expected: Exactly 2 sources: SAF-PMP-001 and ENG-PMP-014. Other 3 excluded.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 13] Multi-Document Query: Retain exactly 2 relevant documents");
{
  const rawQdrantMatches = [
    {
      score: 0.810,
      payload: {
        documentId: "doc-eng-014",
        filename: "ENG-PMP-014 — Pump Engineering Reference.pdf",
        page: 2,
        chunkIndex: 1,
        scope: "knowledge_base",
        text: "P-204A Performance Curve: Rated flow capacity is 120 m³/h at head 45m with efficiency 78%.",
      },
    },
    {
      score: 0.778,
      payload: {
        documentId: "doc-saf-001",
        filename: "SAF-PMP-001 — Pump Safety Procedure.pdf",
        page: 3,
        chunkIndex: 1,
        scope: "knowledge_base",
        text: "PPE requirements during maintenance: Safety glasses, nitrile gloves, and steel-toe shoes.",
      },
    },
    {
      score: 0.612,
      payload: {
        documentId: "doc-konkan",
        filename: "KonkanValve_SOP_PRV.pdf",
        page: 1,
        chunkIndex: 0,
        scope: "knowledge_base",
        text: "PRV testing pressure bench setup.",
      },
    },
    {
      score: 0.598,
      payload: {
        documentId: "doc-deccan",
        filename: "DeccanPetrochemicals_InspectionReport.pdf",
        page: 2,
        chunkIndex: 0,
        scope: "knowledge_base",
        text: "Visual inspection notes for storage tanks.",
      },
    },
  ];

  const query = "What is the rated flow of P-204A and what PPE is required during its maintenance?";
  const result = buildKnowledgeBaseContext(rawQdrantMatches, { query, scoreThreshold: 0.35 });

  assert.strictEqual(result.hasContext, true);
  assert.strictEqual(result.sources.length, 2, "Must retain exactly 2 relevant documents");
  const filenames = result.sources.map((s) => s.filename).sort();
  assert.deepStrictEqual(
    filenames,
    [
      "ENG-PMP-014 — Pump Engineering Reference.pdf",
      "SAF-PMP-001 — Pump Safety Procedure.pdf",
    ].sort()
  );

  console.log("✔ TEST 13 PASSED: Multi-document query returned exactly the 2 relevant documents.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 14: Inspection Procedure Query
// Query: "/knowledgebase What is the inspection procedure?"
// Expected: Only inspection document returned; safety/valve/pump manuals excluded.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 14] Inspection Procedure Query");
{
  const rawQdrantMatches = [
    {
      score: 0.785,
      payload: {
        documentId: "doc-deccan",
        filename: "DeccanPetrochemicals_InspectionReport.pdf",
        page: 2,
        chunkIndex: 0,
        scope: "knowledge_base",
        text: "Detailed inspection procedure: 1. Visual surface examination. 2. Dye penetrant testing of weld seams. 3. Hydrostatic pressure testing at 1.5x design pressure.",
      },
    },
    {
      score: 0.620,
      payload: {
        documentId: "doc-saf-001",
        filename: "SAF-PMP-001 — Pump Safety Procedure.pdf",
        page: 1,
        chunkIndex: 0,
        scope: "knowledge_base",
        text: "General plant safety rules and emergency evacuation plan.",
      },
    },
    {
      score: 0.595,
      payload: {
        documentId: "doc-malabar",
        filename: "MalabarFabricators_VendorNote.pdf",
        page: 1,
        chunkIndex: 0,
        scope: "knowledge_base",
        text: "Commercial terms and dispatch schedule for fabricated spool pieces.",
      },
    },
  ];

  const query = "What is the inspection procedure?";
  const result = buildKnowledgeBaseContext(rawQdrantMatches, { query, scoreThreshold: 0.35 });

  assert.strictEqual(result.hasContext, true);
  assert.strictEqual(result.sources.length, 1, "Only 1 inspection document must be returned");
  assert.strictEqual(result.sources[0].filename, "DeccanPetrochemicals_InspectionReport.pdf");
  assert.strictEqual(result.contextText.includes("Visual surface examination"), true);

  console.log("✔ TEST 14 PASSED: Inspection procedure query selected only DeccanPetrochemicals_InspectionReport.pdf.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 15: Formula Retrieval + Calculator Agent Policy
// Query: "/knowledgebase Calculate the value using the formula in the document"
// Expected: Retrieve only the document containing the required formula/data.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 15] Formula Retrieval + Calculator Policy");
{
  const rawQdrantMatches = [
    {
      score: 0.772,
      payload: {
        documentId: "doc-eng-014",
        filename: "ENG-PMP-014 — Pump Engineering Reference.pdf",
        page: 6,
        chunkIndex: 3,
        scope: "knowledge_base",
        text: "Pump hydraulic power calculation formula: P_hyd (kW) = (Q * H * rho * g) / (3600 * 1000). For P-204A: Q = 120 m³/h, H = 45 m, rho = 1000 kg/m³, g = 9.81 m/s².",
      },
    },
    {
      score: 0.584,
      payload: {
        documentId: "doc-malabar",
        filename: "MalabarFabricators_VendorNote.pdf",
        page: 1,
        chunkIndex: 0,
        scope: "knowledge_base",
        text: "Payment milestone invoice calculation table.",
      },
    },
  ];

  const query = "Calculate the value using the formula in the document";
  const result = buildKnowledgeBaseContext(rawQdrantMatches, { query, scoreThreshold: 0.35 });

  assert.strictEqual(result.hasContext, true);
  assert.strictEqual(result.sources.length, 1);
  assert.strictEqual(result.sources[0].filename, "ENG-PMP-014 — Pump Engineering Reference.pdf");
  assert.strictEqual(result.contextText.includes("P_hyd (kW)"), true);

  // Validate agent policy permits calculator once data is retrieved
  const calcDecision = validateToolSelectionPolicy(
    { action: "call_tool", tool: "calculator", input: { expression: "(120 * 45 * 1000 * 9.81) / (3600 * 1000)" } },
    {
      userRequest: "Calculate the value using the formula in the document",
      steps: [{ tool: "retrieve_information", result: result.contextText }],
    }
  );
  assert.strictEqual(calcDecision.valid, true, "Calculator tool valid after retrieving formula");

  console.log("✔ TEST 15 PASSED: Formula retrieved exclusively from ENG-PMP-014; calculator allowed.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 16: Normal Chat with "What are the required PPE items?"
// Expected: DO NOT trigger Knowledge Base retrieval.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 16] Normal Chat: 'What are the required PPE items?'");
{
  const result = routeMessage({
    message: "What are the required PPE items?",
    mode: "normal",
    hasKnowledgeBaseDocuments: true,
    knowledgeBaseDocuments: [
      { id: "doc-saf-001", filename: "SAF-PMP-001.pdf" },
      { id: "doc-eng-014", filename: "ENG-PMP-014.pdf" },
    ],
  });

  assert.strictEqual(result.route, "GENERAL", "Must route to GENERAL in normal chat");
  assert.strictEqual(result.useRag, false, "useRag must be false");
  assert.strictEqual(result.targetDocumentId, null);

  console.log("✔ TEST 16 PASSED: Normal chat does NOT trigger Knowledge Base retrieval.");
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPTANCE TEST 17: Knowledge Base with No Relevant Document
// Query: "What is quantum entanglement and bell inequalities?"
// Expected: Zero sources, hasContext: false. Unrelated docs strictly excluded.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[ACCEPTANCE TEST 17] Knowledge Base With No Relevant Document");
{
  // When vector search finds nothing exceeding scoreThreshold or matches are completely empty
  const resultEmpty = buildKnowledgeBaseContext([], {
    query: "What is quantum entanglement and bell inequalities?",
    scoreThreshold: 0.35,
  });

  assert.strictEqual(resultEmpty.hasContext, false);
  assert.strictEqual(resultEmpty.sources.length, 0);

  // When vector search returns only weak noise chunks (e.g. scores below 0.35)
  const weakPoints = [
    {
      score: 0.28,
      payload: {
        documentId: "doc-saf-001",
        filename: "SAF-PMP-001.pdf",
        page: 1,
        chunkIndex: 0,
        scope: "knowledge_base",
        text: "Pump safety manual.",
      },
    },
  ];
  const resultWeak = buildKnowledgeBaseContext(weakPoints, {
    query: "What is quantum entanglement?",
    scoreThreshold: 0.35,
  });

  assert.strictEqual(resultWeak.hasContext, false);
  assert.strictEqual(resultWeak.sources.length, 0);

  console.log("✔ TEST 17 PASSED: Query with no relevant KB document produces 0 sources and hasContext=false.");
}

console.log("\n==================================================");
console.log("ALL ACCEPTANCE & UNIT TEST SUITES PASSED (17/17)!");
console.log("==================================================");

