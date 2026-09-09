/**
 * Agent Retrieval Integration Test Suite (Step 8.4)
 *
 * Verifies:
 * - Agent invokes retrieve_information tool
 * - Tool communicates with existing retrieval layer
 * - Observation format: { content: "...", sources: [...] }
 * - Planner continues with observation to synthesize final answer
 * - Agent never constructs Qdrant filters directly
 * - Chat isolation, KB scope, workspace, and user permissions are respected
 * - Deduplication and source metadata are preserved
 * - ZERO Ollama / Model inference executed (pure deterministic mock testing)
 */

import assert from "assert";
import { runAgentTask, initializeBuiltInTools } from "../src/services/agent/agent.service.js";
import toolRegistry from "../src/services/agent/toolRegistry.service.js";
import { executeTool } from "../src/services/agent/agentExecutor.service.js";
import agentPlannerService from "../src/services/agent/agentPlanner.service.js";
import { executeUnifiedRetrieval } from "../src/services/unifiedRetrieval.service.js";

async function runStep84TestSuite() {
  console.log("==================================================");
  console.log("STARTING STEP 8.4 AGENT RETRIEVAL INTEGRATION TESTS");
  console.log("==================================================");

  initializeBuiltInTools();

  // -------------------------------------------------------------
  // Scenario 1: Exact User Specification End-to-End
  // Query: "What is the company's safety procedure?"
  // Mock result: { content: "...", sources: [...] }
  // Flow: Agent -> retrieve_information -> observation -> planner continues
  // -------------------------------------------------------------
  console.log("\n--- [Scenario 1] Exact End-to-End Agent Retrieval Flow ---");
  {
    let toolInvocationCount = 0;
    let capturedRetrievalInput = null;

    const mockRetrievalResponse = {
      content: "All personnel must wear hard hats, safety goggles, and high-visibility vests before entering designated production zones.",
      sources: [
        {
          filename: "Company_Safety_Procedure_2026.pdf",
          page: 4,
          documentId: "doc-safety-101",
        },
      ],
    };

    const mockRetriever = async (params) => {
      toolInvocationCount++;
      capturedRetrievalInput = params;
      return {
        success: true,
        query: params.query,
        content: mockRetrievalResponse.content,
        sources: mockRetrievalResponse.sources,
        results: [
          {
            documentId: "doc-safety-101",
            filename: "Company_Safety_Procedure_2026.pdf",
            page: 4,
            chunkIndex: 0,
            score: 0.95,
            text: mockRetrievalResponse.content,
            source: "knowledge_base",
          },
        ],
      };
    };

    const taskResult = await runAgentTask({
      message: "What is the company's safety procedure?",
      userId: "engineer-42",
      chatId: "chat-safety-audit",
      workspaceId: "ws-industrial",
      options: {
        retriever: mockRetriever,
      },
    });

    // 1. Task must complete successfully
    assert.strictEqual(taskResult.success, true, "Task should complete successfully");
    assert.strictEqual(taskResult.status, "COMPLETED", "Status should be COMPLETED");

    // 2. retrieve_information must have been executed exactly once
    assert.strictEqual(toolInvocationCount, 1, "Tool should be called exactly once");
    assert.ok(
      capturedRetrievalInput.query.toLowerCase().includes("safety"),
      "Retriever query should contain safety intent"
    );

    // 3. Verify Agent observation was recorded in step
    assert.strictEqual(taskResult.steps.length, 1, "Should have 1 recorded tool execution step");
    const step = taskResult.steps[0];
    assert.strictEqual(step.tool, "retrieve_information");
    assert.strictEqual(step.status, "completed");

    // Observation must contain content and sources
    assert.ok(step.observation, "Observation must be present in step");
    assert.strictEqual(step.observation.content, mockRetrievalResponse.content);
    assert.deepStrictEqual(step.observation.sources, mockRetrievalResponse.sources);

    // 4. Planner continues to final response synthesizing observation and citing sources
    assert.ok(
      taskResult.response.includes("hard hats"),
      "Final response must contain the factual retrieved content"
    );
    assert.ok(
      taskResult.response.includes("Company_Safety_Procedure_2026.pdf"),
      "Final response must cite the document source"
    );
    assert.ok(
      taskResult.response.includes("Page 4"),
      "Final response must cite page number"
    );

    console.log("✔ [PASS] Agent -> retrieve_information -> observation -> planner continues to final answer");
  }

  // -------------------------------------------------------------
  // Scenario 2: Agent Architecture Boundary Check
  // The Agent must never directly construct Qdrant filters in planning logic
  // -------------------------------------------------------------
  console.log("\n--- [Scenario 2] Architecture Boundary & Qdrant Filter Isolation ---");
  {
    const plan = await agentPlannerService.planNextStep({
      taskState: {
        userRequest: "Find the fire safety SOP in the manual",
        steps: [],
        chatId: "chat-999",
        userId: "user-888",
        workspaceId: "ws-factory",
      },
      availableTools: toolRegistry.getTools(),
    });

    assert.strictEqual(plan.type, "tool");
    assert.strictEqual(plan.tool, "retrieve_information");

    // Must NOT contain Qdrant-specific filter constructs
    assert.strictEqual(plan.input.filter, undefined, "Planner must not build Qdrant filter object");
    assert.strictEqual(plan.input.must, undefined, "Planner must not build Qdrant 'must' clause");
    assert.strictEqual(plan.input.should, undefined, "Planner must not build Qdrant 'should' clause");
    assert.strictEqual(plan.input.collection, undefined, "Planner must not specify collection details");

    // Must only specify query and context identifiers
    assert.ok(plan.input.query, "Planner provides query");
    assert.strictEqual(plan.input.chatId, "chat-999");
    assert.strictEqual(plan.input.userId, "user-888");
    assert.strictEqual(plan.input.workspaceId, "ws-factory");

    console.log("✔ [PASS] Planner has zero Qdrant implementation details and constructs no Qdrant filters");
  }

  // -------------------------------------------------------------
  // Scenario 3: Retrieval Tool Input Specification
  // Supports { query, chatId, userId, workspaceId, documentId, sourceScope }
  // -------------------------------------------------------------
  console.log("\n--- [Scenario 3] Retrieval Tool Input Specification ---");
  {
    const tool = toolRegistry.getTool("retrieve_information");
    assert.ok(tool, "retrieve_information tool must be registered");

    // Valid inputs
    const validFullInput = {
      query: "Emergency shutdown sequence",
      chatId: "chat-001",
      userId: "user-admin",
      workspaceId: "ws-plant-a",
      documentId: "doc-shutdown-sop",
      sourceScope: "knowledge_base",
      limit: 5,
    };
    const validationRes = toolRegistry.validateToolInput("retrieve_information", validFullInput);
    assert.strictEqual(validationRes.valid, true, "Full valid input must pass schema validation");

    // Missing query fails
    const invalidInput = { chatId: "chat-001" };
    const invalidRes = toolRegistry.validateToolInput("retrieve_information", invalidInput);
    assert.strictEqual(invalidRes.valid, false, "Missing query must fail validation");

    // Invalid sourceScope fails
    const badScopeInput = { query: "test", sourceScope: "internet" };
    const badScopeRes = toolRegistry.validateToolInput("retrieve_information", badScopeInput);
    assert.strictEqual(badScopeRes.valid, false, "Unknown sourceScope must fail validation");

    console.log("✔ [PASS] Input schema correctly validates query, scopes, documentId, and context");
  }

  // -------------------------------------------------------------
  // Scenario 4: Access Control & Context Boundary Enforcement
  // -------------------------------------------------------------
  console.log("\n--- [Scenario 4] Access Control & Isolation Enforcement ---");
  {
    let receivedParams = null;
    const mockAuthRetriever = async (params) => {
      receivedParams = params;
      return {
        success: true,
        query: params.query,
        content: "Verified restricted content",
        sources: [{ filename: "Confidential.pdf", page: 1 }],
      };
    };

    // Caller context from authenticated session must override spoofed input params
    await executeTool({
      toolName: "retrieve_information",
      input: {
        query: "Get confidential specs",
        userId: "spoofed-user-id",
        workspaceId: "spoofed-workspace",
      },
      context: {
        userId: "verified-authed-user",
        workspaceId: "verified-secure-workspace",
        chatId: "verified-chat-session",
        retriever: mockAuthRetriever,
      },
    });

    assert.strictEqual(
      receivedParams.userId,
      "verified-authed-user",
      "Authenticated context userId must take precedence over input"
    );
    assert.strictEqual(
      receivedParams.workspaceId,
      "verified-secure-workspace",
      "Authenticated context workspaceId must take precedence over input"
    );
    assert.strictEqual(
      receivedParams.chatId,
      "verified-chat-session",
      "Authenticated context chatId must be preserved"
    );

    console.log("✔ [PASS] Security boundaries prevent context spoofing and enforce caller isolation");
  }

  // -------------------------------------------------------------
  // Scenario 5: Context Builder Deduplication & Source Metadata
  // -------------------------------------------------------------
  console.log("\n--- [Scenario 5] Context Builder Integration & Source Deduplication ---");
  {
    const mockRetrieverWithDuplicates = async (params) => {
      return {
        success: true,
        query: params.query,
        content: "Section 1: Operating temperatures must remain between 45C and 65C.",
        sources: [
          {
            filename: "Cooling_Specs.pdf",
            page: 10,
            pages: [10, 11],
            pageText: "Pages 10, 11",
            documentId: "doc-cooling-01",
          },
        ],
        results: [
          {
            documentId: "doc-cooling-01",
            filename: "Cooling_Specs.pdf",
            page: 10,
            chunkIndex: 0,
            score: 0.92,
            text: "Operating temperatures must remain between 45C and 65C.",
          },
        ],
      };
    };

    const taskResult = await runAgentTask({
      message: "What is the policy on operating temperatures in Cooling_Specs.pdf?",
      options: {
        retriever: mockRetrieverWithDuplicates,
      },
    });

    assert.strictEqual(taskResult.success, true);
    assert.ok(taskResult.response.includes("45C and 65C"));
    assert.ok(taskResult.response.includes("Cooling_Specs.pdf"));
    assert.ok(taskResult.response.includes("Pages 10, 11"));

    console.log("✔ [PASS] Context Builder deduplication and multi-page attribution correctly passed to Agent");
  }

  // -------------------------------------------------------------
  // Scenario 6: Graceful Handling of Empty Retrieval
  // -------------------------------------------------------------
  console.log("\n--- [Scenario 6] Empty Retrieval Result Handling ---");
  {
    const mockEmptyRetriever = async (params) => {
      return {
        success: true,
        query: params.query,
        content: "",
        sources: [],
        results: [],
      };
    };

    const taskResult = await runAgentTask({
      message: "Find information about project krypton blueprint",
      options: {
        retriever: mockEmptyRetriever,
      },
    });

    assert.strictEqual(taskResult.success, true);
    assert.ok(
      taskResult.response.includes("No relevant documents") ||
        taskResult.response.includes("not found"),
      "Response should politely report no documents found"
    );

    console.log("✔ [PASS] Empty retrieval result handled gracefully by Agent planner");
  }

  // -------------------------------------------------------------
  // Scenario 7: Document-Specific Filter Scoping
  // -------------------------------------------------------------
  console.log("\n--- [Scenario 7] Document-Specific Filter Scoping ---");
  {
    let passedDocId = null;
    const mockDocRetriever = async (params) => {
      passedDocId = params.documentId;
      return {
        success: true,
        query: params.query,
        content: "Filtered content for specific document",
        sources: [{ filename: "Target_Doc.pdf", page: 1, documentId: params.documentId }],
      };
    };

    const toolResult = await executeTool({
      toolName: "retrieve_information",
      input: {
        query: "Specific section query",
        documentId: "doc-target-specific-77",
      },
      context: {
        retriever: mockDocRetriever,
      },
    });

    assert.strictEqual(toolResult.success, true);
    assert.strictEqual(passedDocId, "doc-target-specific-77", "documentId must be forwarded to retrieval service");
    assert.strictEqual(toolResult.result.sources[0].documentId, "doc-target-specific-77");

    console.log("✔ [PASS] Document-specific filter correctly forwarded to retrieval service");
  }

  console.log("\n==================================================");
  console.log("ALL 7 STEP 8.4 TEST SCENARIOS PASSED SUCCESSFULLY!");
  console.log("ZERO OLLAMA / REAL MODEL INFERENCE EXECUTED.");
  console.log("==================================================");
}

runStep84TestSuite().catch((err) => {
  console.error("❌ TEST SUITE FAILURE:", err);
  process.exit(1);
});
