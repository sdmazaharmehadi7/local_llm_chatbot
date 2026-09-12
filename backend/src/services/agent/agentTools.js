/**
 * Sovereign Agent Tools (LangChain Structured Tools)
 *
 * Defines and registers tools for the LangGraph agent using LangChain
 * DynamicStructuredTool with strict Zod schemas.
 *
 * TOOLS:
 * 1. calculator: Evaluates arithmetic and math expressions safely.
 * 2. text_transform: Performs deterministic text formatting/string transforms.
 * 3. retrieve_information: Searches documents/manuals via existing unified retrieval.
 *
 * GUARANTEES:
 * - Enforces strict Zod schema validation
 * - Injects and prioritizes caller context (userId, chatId, workspaceId) for retrieval
 * - Zero external dependencies, cloud calls, or duplicate RAG pipelines
 */

import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import calculatorTool from "./tools/calculator.tool.js";
import textTransformTool from "./tools/textTransform.tool.js";
import retrievalTool from "./tools/retrieval.tool.js";
import codingTool from "./tools/coding.tool.js";
import executeCodeTool from "./tools/executeCode.tool.js";
import visionTool from "./tools/vision.tool.js";

/**
 * Zod schema for calculator tool
 */
export const CalculatorSchema = z.object({
  expression: z
    .string()
    .min(1, "Expression must not be empty")
    .describe("The mathematical expression to evaluate (e.g. '25 * 40', '10 * 0.07', 'sqrt(144) + 10')"),
});

/**
 * Zod schema for text transform tool
 */
export const TextTransformSchema = z.object({
  text: z.string().describe("The text content to transform or inspect."),
  operation: z
    .enum([
      "uppercase",
      "lowercase",
      "word_count",
      "char_count",
      "summarize",
      "trim",
      "reverse",
    ])
    .describe("Operation to perform: uppercase, lowercase, word_count, char_count, summarize, trim, reverse"),
  options: z
    .record(z.any())
    .optional()
    .describe("Optional parameters (e.g. { maxSentences: 2 } for summarize)."),
});

/**
 * Zod schema for retrieval tool
 */
export const RetrievalSchema = z.object({
  query: z
    .string()
    .min(1, "Search query must not be empty")
    .describe("The targeted semantic or keyword query to search for in documents or Knowledge Base."),
  sourceScope: z
    .enum(["chat", "knowledge_base", "all"])
    .optional()
    .default("all")
    .describe("Optional scope filter: 'chat', 'knowledge_base', or 'all'."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(8)
    .describe("Maximum number of excerpts to retrieve (default 8, max 20)."),
  documentId: z
    .string()
    .optional()
    .describe("Optional document ID to restrict search to."),
});

/**
 * Zod schema for coding tool (Qwen2.5-Coder)
 */
export const CodingSchema = z.object({
  task: z
    .string()
    .min(1, "Task description must not be empty")
    .describe("The programming, function implementation, algorithm, or code debugging task to perform."),
  language: z
    .string()
    .optional()
    .describe("Optional target programming language (e.g. 'java', 'javascript', 'python', 'cpp', 'typescript', 'go', 'rust', 'csharp')."),
  codeContext: z
    .string()
    .optional()
    .describe("Optional existing code snippet or context to analyze, refactor, or debug."),
});

/**
 * Zod schema for sandbox execute_code tool
 */
export const ExecuteCodeSchema = z.object({
  code: z
    .string()
    .min(1, "Code must not be empty")
    .describe("The source code to execute inside the isolated container sandbox."),
  language: z
    .string()
    .optional()
    .default("python")
    .describe("Programming language runtime: 'python', 'javascript', or 'sh' (default: 'python')."),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(30000)
    .optional()
    .default(10000)
    .describe("Execution timeout in milliseconds (1000 to 30000, default: 10000)."),
});

/**
 * Zod schema for vision tool (Qwen2.5-VL)
 */
export const VisionSchema = z.object({
  prompt: z
    .string()
    .min(1, "Inspection prompt must not be empty")
    .describe("The visual inspection question, detail to extract, or OCR analysis to perform on the image."),
  image: z
    .string()
    .optional()
    .describe("Optional base64 encoded image string or data URL if providing directly in the tool call."),
});

/**
 * Factory creating LangChain StructuredTool instances bound to caller context.
 *
 * @param {object} [context={}]
 * @param {string} [context.userId]
 * @param {string} [context.chatId]
 * @param {string} [context.workspaceId]
 * @param {Function} [context.retriever]
 * @param {Function} [context.coderClient]
 * @param {Function} [context.sandboxRunner]
 * @param {Function} [context.visionClient]
 * @param {Array<string>} [context.images]
 * @returns {Array<DynamicStructuredTool>}
 */
export function createAgentTools(context = {}) {
  const calcTool = new DynamicStructuredTool({
    name: "calculator",
    description:
      "Evaluates mathematical expressions and performs exact numerical computations. Use ONLY when arithmetic or numerical calculation is explicitly required. Do NOT use for general questions, text processing, or document lookups.",
    schema: CalculatorSchema,
    func: async (input) => {
      const res = await calculatorTool.execute(input);
      return JSON.stringify(res);
    },
  });

  const textTool = new DynamicStructuredTool({
    name: "text_transform",
    description:
      "Performs deterministic string formatting transformations (uppercase, lowercase, word_count, char_count, summarize, trim, reverse). Use ONLY when the user explicitly requests text formatting or manipulation. Do NOT use for answering questions or document queries.",
    schema: TextTransformSchema,
    func: async (input) => {
      const res = await textTransformTool.execute(input);
      return JSON.stringify(res);
    },
  });

  const retrieveTool = new DynamicStructuredTool({
    name: "retrieve_information",
    description:
      "Searches and retrieves verified facts, policies, SOPs, manuals, safety requirements, and document excerpts from authorized chat attachments and Knowledge Base documentation. Use when external or document knowledge is needed. Do NOT use for pure math or text transformations.",
    schema: RetrievalSchema,
    func: async (input) => {
      const res = await retrievalTool.execute(input, context);
      return JSON.stringify(res);
    },
  });

  const codeTool = new DynamicStructuredTool({
    name: "coding",
    description:
      "Generates, implements, refactors, or debugs code using specialized Qwen2.5-Coder. Use ONLY when the user explicitly requests writing code, implementing a software function/class/algorithm, generating a script, or technical code debugging. Do NOT use for general questions, conceptual explanations (e.g. 'Explain what an API is'), math, or document retrieval.",
    schema: CodingSchema,
    func: async (input) => {
      const res = await codingTool.execute(input, context);
      return JSON.stringify(res);
    },
  });

  const execTool = new DynamicStructuredTool({
    name: "execute_code",
    description:
      "Executes code within a secure, container-isolated sandbox with no network access, read-only root filesystem, strict memory/CPU limits, and timeout protection. Use ONLY when the user explicitly requests executing, running, or testing code. Never executes on host.",
    schema: ExecuteCodeSchema,
    func: async (input) => {
      const res = await executeCodeTool.execute(input, context);
      return JSON.stringify(res);
    },
  });

  const visTool = new DynamicStructuredTool({
    name: "vision",
    description:
      "Performs visual analysis, OCR, diagram inspection, chart reading, or equipment photo inspection using the specialized Qwen2.5-VL model. Extracts visible text, numbers, formulas, measurements, and labels without performing calculations or invoking other tools. Use ONLY when visual inspection of an image, schematic, photo, or diagram is required.",
    schema: VisionSchema,
    func: async (input) => {
      const res = await visionTool.execute(input, context);
      return JSON.stringify(res);
    },
  });

  return [calcTool, textTool, retrieveTool, codeTool, execTool, visTool];
}

/**
 * Helper to safely extract clean JSON Schema from Zod for tool description / inspection
 */
function zodToJsonSchema(zodSchema) {
  try {
    const shape =
      zodSchema?.shape ||
      (typeof zodSchema?._def?.shape === "function" ? zodSchema._def.shape() : zodSchema?._def?.shape) ||
      {};
    const properties = {};
    const required = [];
    for (const [key, prop] of Object.entries(shape)) {
      const isOptional = typeof prop?.isOptional === "function" ? prop.isOptional() : false;
      if (!isOptional) required.push(key);
      properties[key] = {
        description: prop?.description || "",
      };
    }
    return { type: "object", properties, required };
  } catch {
    return { type: "object" };
  }
}

/**
 * Returns static metadata for registered tools.
 */
export function getAgentToolsMetadata() {
  const dummyTools = createAgentTools();
  return dummyTools.map((t) => ({
    name: t.name,
    description: t.description,
    schema: t.schema ? zodToJsonSchema(t.schema) : {},
  }));
}

export default {
  CalculatorSchema,
  TextTransformSchema,
  RetrievalSchema,
  CodingSchema,
  ExecuteCodeSchema,
  VisionSchema,
  createAgentTools,
  getAgentToolsMetadata,
};
