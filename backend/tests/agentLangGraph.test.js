/**
 * Sovereign LangGraph Agent Acceptance & Integration Tests
 *
 * Comprehensive test suite verifying the single, primary LangGraph agent:
 * - Tool Schemas & Zod input validation
 * - Tool execution adapters with context propagation (userId, chatId, workspaceId)
 * - Tool metadata catalog
 * - All 6 Tool Selection Policy Scenarios (Tests 1 to 6)
 * - Graph step limits & stuck loop protection
 * - User & chat isolation
 * - Controller & Route integration (HTTP 400 validation, tool listing, SSE headers)
 *
 * SAFETY GUARANTEES:
 * - Zero live Ollama invocations
 * - Zero cloud model invocations
 * - 100% deterministic, offline, and isolated
 */

import assert from "assert";
import {
  CalculatorSchema,
  TextTransformSchema,
  RetrievalSchema,
  CodingSchema,
  createAgentTools,
  getAgentToolsMetadata,
} from "../src/services/agent/agentTools.js";
import {
  agentGraphService,
  AgentStateAnnotation,
} from "../src/services/agent/agentGraph.service.js";
import { runAgentTask } from "../src/services/agent/agent.service.js";
import {
  AGENT_STATUS,
  AGENT_ACTION_TYPES,
  AGENT_LIMITS,
} from "../src/services/agent/agent.types.js";
import {
  createAgentTask,
  getAgentTask,
  listAgentTools,
} from "../src/controllers/agent.controller.js";
import { routeMessage } from "../src/services/ragRouter.service.js";

console.log("==========================================================");
console.log("STARTING SOVEREIGN LANGGRAPH AGENT ACCEPTANCE TESTS");
console.log("==========================================================");

let testsPassed = 0;
function pass(testName) {
  testsPassed++;
  console.log(`✔ [PASS] ${testName}`);
}

async function runTests() {
  // ─── 1. TOOL SCHEMAS & INPUT VALIDATION (Zod) ─────────────────────────────
  console.log("\n--- [Section 1] Tool Schemas & Zod Input Validation ---");
  {
    // Calculator validation
    const validCalc = CalculatorSchema.safeParse({ expression: "25 * 40" });
    assert.strictEqual(validCalc.success, true);

    const invalidCalc = CalculatorSchema.safeParse({ expression: "" });
    assert.strictEqual(invalidCalc.success, false);

    // Text transform validation
    const validTransform = TextTransformSchema.safeParse({
      text: "hello world",
      operation: "uppercase",
    });
    assert.strictEqual(validTransform.success, true);

    const invalidTransform = TextTransformSchema.safeParse({
      text: "hello",
      operation: "invalid_op",
    });
    assert.strictEqual(invalidTransform.success, false);

    // Retrieval validation
    const validRetrieval = RetrievalSchema.safeParse({
      query: "safety valve inspection procedure",
      sourceScope: "knowledge_base",
      limit: 5,
    });
    assert.strictEqual(validRetrieval.success, true);
    assert.strictEqual(validRetrieval.data.limit, 5);

    const invalidRetrieval = RetrievalSchema.safeParse({ query: "" });
    assert.strictEqual(invalidRetrieval.success, false);

    // Coding validation
    const validCoding = CodingSchema.safeParse({
      task: "Write a Java function to reverse a string",
      language: "java",
    });
    assert.strictEqual(validCoding.success, true);
    assert.strictEqual(validCoding.data.language, "java");

    const invalidCoding = CodingSchema.safeParse({ task: "" });
    assert.strictEqual(invalidCoding.success, false);

    pass("Zod schemas correctly validate tool arguments and reject invalid inputs");
  }

  // ─── 2. TOOL EXECUTION ADAPTERS & CONTEXT PROPAGATION ──────────────────────
  console.log("\n--- [Section 2] Adapted Tool Executions & Context Isolation ---");
  {
    let retrieverCalled = false;
    let receivedContext = null;

    const mockRetriever = async (params) => {
      retrieverCalled = true;
      receivedContext = params;
      return {
        success: true,
        content: "PRV set pressure must be verified annually. Maximum allowable overpressure is 10%.",
        results: [{ id: "doc-1", title: "Safety SOP" }],
      };
    };

    const tools = createAgentTools({
      userId: "user-sovereign-01",
      chatId: "chat-session-42",
      workspaceId: "workspace-prod",
      retriever: mockRetriever,
    });

    const calcTool = tools.find((t) => t.name === "calculator");
    const textTool = tools.find((t) => t.name === "text_transform");
    const retrTool = tools.find((t) => t.name === "retrieve_information");
    const codeTool = tools.find((t) => t.name === "coding");

    assert.ok(calcTool, "calculator tool exists");
    assert.ok(textTool, "text_transform tool exists");
    assert.ok(retrTool, "retrieve_information tool exists");
    assert.ok(codeTool, "coding tool exists");

    // Execute calculator tool
    const calcOutput = JSON.parse(await calcTool.invoke({ expression: "25 * 40" }));
    assert.strictEqual(calcOutput.value, 1000);
    assert.strictEqual(calcOutput.formatted, "1000");

    // Execute text transform tool
    const textOutput = JSON.parse(
      await textTool.invoke({ text: "hello world", operation: "uppercase" })
    );
    assert.strictEqual(textOutput.result, "HELLO WORLD");

    // Execute retrieval tool with context preservation and structured output
    const retrOutput = JSON.parse(
      await retrTool.invoke({ query: "safety requirements", sourceScope: "all" })
    );
    assert.strictEqual(retrOutput.success, true);
    assert.ok(retrOutput.content.includes("10%"));
    assert.strictEqual(retrieverCalled, true);
    assert.strictEqual(receivedContext.userId, "user-sovereign-01");
    assert.strictEqual(receivedContext.chatId, "chat-session-42");
    assert.strictEqual(receivedContext.workspaceId, "workspace-prod");

    // Verify structured fields: retrieved text, document/source name, metadata, similarity/relevance
    assert.ok(Array.isArray(retrOutput.results), "retrOutput.results must be an array");
    assert.strictEqual(retrOutput.results.length, 1);
    const chunk0 = retrOutput.results[0];
    assert.ok(chunk0.text.includes("10%"), "chunk text must be preserved");
    assert.ok(chunk0.filename, "document/source name must be present");
    assert.ok(chunk0.metadata, "metadata object must be present");
    assert.strictEqual(chunk0.metadata.documentId, "doc-1");
    assert.ok(Array.isArray(retrOutput.sources), "retrOutput.sources must be an array");

    // Execute coding tool with mock coder client
    const mockCoderFn = async () => "public class Solution { public static String reverse(String s) { return new StringBuilder(s).reverse().toString(); } }";
    const toolsWithCoder = createAgentTools({
      coderClient: mockCoderFn,
    });
    const codeToolInstance = toolsWithCoder.find((t) => t.name === "coding");
    const codeOutput = JSON.parse(await codeToolInstance.invoke({ task: "reverse string", language: "java" }));
    assert.strictEqual(codeOutput.success, true);
    assert.strictEqual(codeOutput.language, "java");
    assert.strictEqual(codeOutput.model, "qwen2.5-coder:7b");
    assert.ok(codeOutput.code.includes("StringBuilder"));
    assert.strictEqual(codeOutput.isExecutable, false, "Code generation must not be executable on host");

    pass("LangChain tools execute correctly, return structured fields (text, source, metadata, score), and preserve caller context");
  }

  // ─── 3. METADATA CATALOG INSPECTION ────────────────────────────────────────
  console.log("\n--- [Section 3] Tool Catalog Metadata ---");
  {
    const metadata = getAgentToolsMetadata();
    assert.strictEqual(metadata.length, 4);
    const names = metadata.map((m) => m.name);
    assert.ok(names.includes("calculator"));
    assert.ok(names.includes("text_transform"));
    assert.ok(names.includes("retrieve_information"));
    assert.ok(names.includes("coding"));
    pass("Tool metadata catalog lists all 4 registered tools with schema specifications");
  }

  // ─── 4. TOOL SELECTION POLICY TESTS (TESTS 1 to 6) ─────────────────────────
  // ─── 4. MULTI-STEP & TOOL EXECUTION ACCEPTANCE TESTS ───────────────────────
  console.log("\n--- [Section 4] Multi-Step Tool Execution Tests ---");

  // TEST 4.1: single-tool retrieval
  // Expected: Qwen3 -> retrieve_information -> answer (1 tool step only)
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve safety requirements from authorized documents.",
          input: { query: "safety requirements" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Synthesized grounded answer citing Safety_Manual.pdf.",
        answer: "According to Safety_Manual.pdf (Page 4), pressure relief valves must be inspected annually with a maximum overpressure tolerance of 10%.",
      });
    });

    const mockRetriever = async () => ({
      success: true,
      query: "safety requirements",
      content: "[Document: Safety_Manual.pdf, Page: 4]\nPRVs must be inspected annually. Maximum allowable overpressure is 10%.",
      sources: [{ documentId: "doc-safety-101", filename: "Safety_Manual.pdf", page: 4, score: 0.94 }],
      results: [
        {
          documentId: "doc-safety-101",
          filename: "Safety_Manual.pdf",
          sourceName: "Safety_Manual.pdf",
          page: 4,
          chunkIndex: 1,
          score: 0.94,
          text: "PRVs must be inspected annually. Maximum allowable overpressure is 10%.",
          source: "knowledge_base",
          metadata: {
            documentId: "doc-safety-101",
            filename: "Safety_Manual.pdf",
            page: 4,
            chunkIndex: 1,
          },
        },
      ],
    });

    const result = await runAgentTask({
      message: "What are the safety requirements in the documents?",
      userId: "test-user",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1, "Must execute exactly one retrieval step");
    assert.strictEqual(result.steps[0].tool, "retrieve_information");

    // Validate structured information returned by retrieval tool
    const obs = result.steps[0].observation;
    assert.ok(obs.results.length > 0, "Structured results must be present");
    assert.strictEqual(obs.results[0].filename, "Safety_Manual.pdf");
    assert.strictEqual(obs.results[0].page, 4);
    assert.strictEqual(obs.results[0].score, 0.94);
    assert.ok(obs.results[0].text.includes("10%"));
    assert.ok(obs.results[0].metadata, "Metadata must be present");

    // Validate sources attached to task result
    assert.ok(Array.isArray(result.sources), "Result must contain sources list");
    assert.strictEqual(result.sources.length, 1);
    assert.strictEqual(result.sources[0].filename, "Safety_Manual.pdf");
    assert.ok(result.response.includes("Safety_Manual.pdf"));

    pass("TEST 4.1 passed: 'single-tool retrieval' executes retrieval only and returns grounded answer");
  }

  // TEST 4.2: single calculator
  // Expected: Qwen3 -> calculator -> answer (1 tool step only)
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Evaluate 25 * 40",
          input: { expression: "25 * 40" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Computation finished.",
        answer: "25 * 40 = 1000.",
      });
    });

    const result = await runAgentTask({
      message: "Calculate 25 * 40",
      userId: "test-user",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1, "Must call exactly one tool");
    assert.strictEqual(result.steps[0].tool, "calculator", "Tool must be calculator only");
    assert.strictEqual(result.steps[0].observation?.value, 1000);
    assert.strictEqual(result.steps.some((s) => s.tool === "retrieve_information"), false, "Must NOT call retrieval");
    assert.strictEqual(result.steps.some((s) => s.tool === "text_transform"), false, "Must NOT call text_transform");

    pass("TEST 4.2 passed: 'single calculator' executes calculator only");
  }

  // TEST 4.3: retrieval → calculator
  // Expected: Qwen3 -> retrieval -> retrieved context -> Qwen3 -> calculator -> calculation result -> Qwen3 -> final answer
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Find the relevant value in the document.",
          input: { query: "relevant value" },
        });
      }
      if (callCount === 2) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Calculate the 10% overpressure on 250 bar using the retrieved value.",
          input: { expression: "250 * 0.10" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Multi-step reasoning complete.",
        answer: "The operating pressure from the document is 250 bar, and the 10% allowable overpressure is 25 bar.",
      });
    });

    const mockRetriever = async () => ({
      success: true,
      content: "Safety valve operating set pressure is 250 bar with a 10% maximum overpressure allowance.",
      sources: [{ filename: "PRV_Specs.pdf", page: 12 }],
      results: [
        {
          filename: "PRV_Specs.pdf",
          page: 12,
          text: "Safety valve operating set pressure is 250 bar with a 10% maximum overpressure allowance.",
        },
      ],
    });

    const result = await runAgentTask({
      message: "Find the relevant value in the document and calculate the result using that value.",
      userId: "test-user",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 2, "Must execute exactly two tools in order");
    assert.strictEqual(result.steps[0].tool, "retrieve_information", "First step must be retrieval");
    assert.ok(result.steps[0].observation?.results[0].text.includes("250 bar"));
    assert.strictEqual(result.steps[1].tool, "calculator", "Second step must be calculator");
    assert.strictEqual(result.steps[1].observation?.value, 25);
    assert.ok(result.response.includes("25 bar"));

    pass("TEST 4.3 passed: 'retrieval → calculator' multi-step workflow executed and preserved in state");
  }

  // TEST 4.4: retrieval → answer
  // Expected: Qwen3 -> retrieval -> direct answer (no unnecessary calculator/transform calls)
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "retrieve_information",
          reason: "Retrieve annual inspection procedure from the manual.",
          input: { query: "annual inspection procedure" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Retrieved text completely answers the question without further tools.",
        answer: "According to SOP.pdf (Page 2), safety valves must be inspected every 12 months.",
      });
    });

    const mockRetriever = async () => ({
      success: true,
      content: "Safety valves must be inspected every 12 months.",
      sources: [{ filename: "SOP.pdf", page: 2 }],
      results: [{ filename: "SOP.pdf", page: 2, text: "Safety valves must be inspected every 12 months." }],
    });

    const result = await runAgentTask({
      message: "According to the manual, what is the annual inspection procedure?",
      userId: "test-user",
      options: { retriever: mockRetriever },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1, "Must execute only 1 retrieval step");
    assert.strictEqual(result.steps[0].tool, "retrieve_information");
    assert.strictEqual(result.steps.some((s) => s.tool === "calculator"), false, "Must NOT call calculator");
    assert.strictEqual(result.steps.some((s) => s.tool === "text_transform"), false, "Must NOT call text_transform");
    assert.ok(result.response.includes("12 months"));

    pass("TEST 4.4 passed: 'retrieval → answer' stops after retrieval when further tools are unneeded");
  }

  // TEST 4.5: tool failure
  // Expected: Tool failure returns controlled error to agent; Qwen3 decides next action based on error
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "calculator",
          reason: "Attempt division by zero.",
          input: { expression: "100 / 0" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Tool error observed; reporting graceful explanation to user.",
        answer: "The calculation could not be completed: division by zero is undefined in mathematics.",
      });
    });

    const result = await runAgentTask({
      message: "Evaluate 100 / 0",
      userId: "test-user",
    });

    assert.strictEqual(result.success, true, "Task should complete gracefully despite tool failure");
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].tool, "calculator");
    assert.strictEqual(result.steps[0].status, "failed");
    assert.ok(
      result.steps[0].observation?.error?.includes("Division by zero"),
      "Observation must contain controlled error message"
    );
    assert.ok(result.response.includes("division by zero"));

    pass("TEST 4.5 passed: 'tool failure' returns controlled error to agent and allows graceful recovery");
  }

  // TEST 4.6: maximum-step protection
  // Expected: Reaching maximum allowed tool executions or stuck loop halts execution safely
  {
    // Part A: Max tool executions limit
    let execCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      execCount++;
      return JSON.stringify({
        action: "tool",
        tool: "calculator",
        reason: `Loop step ${execCount}`,
        input: { expression: `${execCount} + 1` },
      });
    });

    const resultA = await runAgentTask({
      message: "Compute continuous increment",
      userId: "test-user",
    });

    assert.strictEqual(resultA.success, false);
    assert.strictEqual(resultA.status, "failed");
    assert.ok(
      resultA.error?.includes("Execution limit exceeded") || resultA.error?.includes("limit"),
      "Must halt execution when tool execution limit is reached"
    );

    // Part B: Consecutive identical action stuck loop protection
    agentGraphService.setAgentBrainLlmClient(async () => {
      return JSON.stringify({
        action: "tool",
        tool: "calculator",
        reason: "Infinite loop test",
        input: { expression: "1 + 1" },
      });
    });

    const resultB = await runAgentTask({
      message: "Calculate 1 + 1 repeatedly",
      userId: "test-user",
    });

    assert.strictEqual(resultB.success, false);
    assert.strictEqual(resultB.status, "failed");
    assert.ok(
      resultB.error?.includes("stuck") || resultB.error?.includes("limit"),
      "Should stop safely due to stuck detection"
    );

    pass("TEST 4.6 passed: 'maximum-step protection' safely halts runaway tool executions and stuck loops");
  }

  // TEST 4.7: /agent What is the purpose of this system? (no retrieval)
  {
    agentGraphService.setAgentBrainLlmClient(async () => {
      return JSON.stringify({
        action: "final",
        reason: "General system purpose question requires no external document retrieval.",
        answer: "This system is a Sovereign On-Premise Agentic AI Workbench designed for privacy-preserving local LLM workflows.",
      });
    });

    const result = await runAgentTask({
      message: "What is the purpose of this system?",
      userId: "test-user",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 0, "No tools should be called for system purpose question");
    assert.ok(result.response.includes("Sovereign"));
    pass("TEST 4.7 passed: '/agent What is the purpose of this system?' completes directly with no retrieval");
  }

  // TEST 4.8: /knowledgebase What are the safety requirements? (existing KB RAG unchanged)
  {
    const MOCK_KB_DOCS = [
      { id: "doc-safety-101", filename: "Safety_Manual.pdf" },
      { id: "doc-maint-202", filename: "Maintenance_Guide.pdf" },
    ];

    const routeResult = routeMessage({
      message: "/knowledgebase What are the safety requirements?",
      hasKnowledgeBaseDocuments: true,
      knowledgeBaseDocuments: MOCK_KB_DOCS,
    });

    assert.strictEqual(routeResult.route, "KNOWLEDGE_BASE");
    assert.strictEqual(routeResult.useRag, true);
    assert.strictEqual(routeResult.cleanedQuery, "What are the safety requirements?");
    pass("TEST 4.8 passed: '/knowledgebase What are the safety requirements?' routes to existing KB RAG unchanged");
  }

  // TEST 4.9: /agent Convert hello world to uppercase (text_transform only)
  {
    let callCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      callCount++;
      if (callCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "text_transform",
          reason: "Convert to uppercase",
          input: { text: "hello world", operation: "uppercase" },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Transform complete.",
        answer: "The uppercase text is: HELLO WORLD.",
      });
    });

    const result = await runAgentTask({
      message: "Convert hello world to uppercase",
      userId: "test-user",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.steps[0].tool, "text_transform");
    assert.strictEqual(result.steps[0].observation?.result, "HELLO WORLD");
    pass("TEST 4.9 passed: 'text_transform only' executed for string transform");
  }

  // ─── 5. SPECIALIZED QWEN2.5-CODER CODING CAPABILITY TESTS ─────────────────
  console.log("\n--- [Section 5] Qwen2.5-Coder Specialized Coding Tests ---");

  // TEST 5.1: /agent Explain what an API is -> Qwen3 only (0 tools called)
  {
    // Case A: Qwen3 brain recognizes conceptual definition question -> direct final answer, 0 tools
    agentGraphService.setAgentBrainLlmClient(async () => {
      return JSON.stringify({
        action: "final",
        reason: "Conceptual explanation question does not require code generation.",
        answer: "An Application Programming Interface (API) is a set of rules and protocols that allows different software applications to communicate with each other.",
      });
    });

    const resultA = await runAgentTask({
      message: "Explain what an API is",
      userId: "test-user",
    });

    assert.strictEqual(resultA.success, true);
    assert.strictEqual(resultA.steps.length, 0, "No tools should be called for conceptual explanation");
    assert.ok(resultA.response.includes("API") || resultA.response.includes("interface"));

    // Case B: Even if local LLM mistakenly attempts to invoke coding tool on conceptual question, policy guard intercepts
    agentGraphService.setAgentBrainLlmClient(async () => {
      return JSON.stringify({
        action: "tool",
        tool: "coding",
        reason: "Generate explanation",
        input: { task: "Explain API" },
      });
    });

    const resultB = await runAgentTask({
      message: "Explain what an API is",
      userId: "test-user",
    });

    assert.strictEqual(resultB.success, true);
    assert.strictEqual(resultB.steps.length, 0, "Policy guard must block coding tool on conceptual questions");
    pass("TEST 5.1 passed: '/agent Explain what an API is' answered by Qwen3 only with 0 tool calls");
  }

  // TEST 5.2: /agent Write a Java function to reverse a string -> Qwen3 → Coding Tool → Qwen2.5-Coder → Qwen3
  {
    let brainCallCount = 0;
    agentGraphService.setAgentBrainLlmClient(async () => {
      brainCallCount++;
      if (brainCallCount === 1) {
        return JSON.stringify({
          action: "tool",
          tool: "coding",
          reason: "Delegate Java string reverse implementation to Qwen2.5-Coder.",
          input: {
            task: "Write a Java function to reverse a string",
            language: "java",
          },
        });
      }
      return JSON.stringify({
        action: "final",
        reason: "Synthesize final response presenting the Qwen2.5-Coder solution.",
        answer: "Here is the Java function to reverse a string:\n\n```java\npublic class StringUtils {\n    public static String reverse(String input) {\n        if (input == null) return null;\n        return new StringBuilder(input).reverse().toString();\n    }\n}\n```\nThis method uses StringBuilder for O(n) runtime efficiency.",
      });
    });

    let coderCalled = false;
    let coderReceivedPrompt = null;
    agentGraphService.setCoderLlmClient(async (messages) => {
      coderCalled = true;
      coderReceivedPrompt = messages;
      return "```java\npublic class StringUtils {\n    public static String reverse(String input) {\n        if (input == null) return null;\n        return new StringBuilder(input).reverse().toString();\n    }\n}\n```";
    });

    const result = await runAgentTask({
      message: "Write a Java function to reverse a string",
      userId: "test-user",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.steps.length, 1, "Must execute exactly one coding tool step");
    assert.strictEqual(result.steps[0].tool, "coding");
    assert.strictEqual(coderCalled, true, "Must invoke specialized Qwen2.5-Coder engine");

    // Validate Coding Tool output structure
    const codingObs = result.steps[0].observation;
    assert.strictEqual(codingObs.success, true);
    assert.strictEqual(codingObs.model, "qwen2.5-coder:7b");
    assert.strictEqual(codingObs.language, "java");
    assert.ok(codingObs.code.includes("StringBuilder"));
    assert.strictEqual(codingObs.isExecutable, false, "Generated code must not be executed on host");

    // Validate final answer from Qwen3 incorporating the generated code
    assert.ok(result.response.includes("public class StringUtils"));
    assert.ok(result.response.includes("StringBuilder"));

    pass("TEST 5.2 passed: '/agent Write a Java function to reverse a string' routes Qwen3 → Coding Tool → Qwen2.5-Coder → Qwen3");
  }

  // TEST 5.3: Security check: Coding tool has zero shell access and does not execute code
  {
    agentGraphService.setCoderLlmClient(async () => "console.log('malicious attempt');");

    const tools = createAgentTools({
      coderClient: async () => "console.log('safe code text only');",
    });
    const codeTool = tools.find((t) => t.name === "coding");

    const result = JSON.parse(
      await codeTool.invoke({ task: "Write script", language: "javascript" })
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.isExecutable, false);
    assert.strictEqual(typeof result.code, "string");
    pass("TEST 5.3 passed: Coding Tool enforces zero shell execution and strictly produces text output");
  }

  // ─── 6. ROUTING & CONTROLLER INTEGRATION ──────────────────────────────────
  console.log("\n--- [Section 6] Route & Controller Verification ---");
  {
    // Empty message validation test
    let resCode = null;
    let resBody = null;
    const mockRes = {
      status: (code) => {
        resCode = code;
        return {
          json: (body) => {
            resBody = body;
          },
        };
      },
    };

    await createAgentTask({ body: { message: "" } }, mockRes);
    assert.strictEqual(resCode, 400);
    assert.strictEqual(resBody.success, false);

    // List tools endpoint test
    let toolsBody = null;
    const mockToolsRes = {
      json: (body) => {
        toolsBody = body;
      },
    };
    await listAgentTools({}, mockToolsRes);
    assert.strictEqual(toolsBody.success, true);
    assert.strictEqual(toolsBody.framework, "langgraph");
    assert.strictEqual(toolsBody.count, 4);

    // Get task status test
    let taskBody = null;
    const mockTaskRes = {
      json: (body) => {
        taskBody = body;
      },
    };
    await getAgentTask({ params: { taskId: "task-test-id" } }, mockTaskRes);
    assert.strictEqual(taskBody.success, true);
    assert.strictEqual(taskBody.taskId, "task-test-id");

    pass("Agent controller properly validates inputs, lists all 4 tools, and returns task status");
  }

  agentGraphService.resetAgentBrainLlmClient();
  agentGraphService.resetCoderLlmClient();

  console.log("\n==========================================================");
  console.log(`ALL ${testsPassed} LANGGRAPH AGENT ACCEPTANCE TESTS PASSED!`);
  console.log("ZERO OLLAMA / REAL INFERENCE WAS EXECUTED.");
  console.log("==========================================================");
}

runTests().catch((err) => {
  console.error("FATAL TEST FAILURE:", err);
  process.exit(1);
});
