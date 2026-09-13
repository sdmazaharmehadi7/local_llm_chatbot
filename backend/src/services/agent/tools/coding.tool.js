/**
 * Specialized Coding Tool (Qwen2.5-Coder)
 *
 * Dedicated code generation, implementation, refactoring, and debugging capability
 * for the sovereign LangGraph agent, powered by local qwen2.5-coder:7b.
 *
 * SECURITY & GOVERNANCE:
 * - Pure code generation and technical analysis only.
 * - Zero shell access / child_process execution.
 * - Does NOT execute generated code on the host machine.
 * - Reuses existing Ollama service without duplicate model managers.
 * - Supports test client injection (context.coderClient) for offline testing.
 */

import { sendChatToOllama } from "../../ollama.service.js";
import { modelLock } from "../modelLock.service.js";

export const CODING_MODEL = "qwen2.5-coder:7b";

export const CODING_SYSTEM_PROMPT = `You are a specialized code generation engine powered by Qwen2.5-Coder.
Your task is to write clean, secure, robust, production-grade, and well-commented code matching the user's specification.
Guidelines:
1. Focus directly on correct programming implementation, syntax, and algorithmic logic.
2. Provide the code clearly formatted in markdown code blocks with language annotations (e.g. \`\`\`java ... \`\`\`).
3. Include brief inline comments explaining critical implementation decisions.
4. Do not attempt shell, system, or destructive execution commands.
5. If fixing or debugging code, point out the root cause and provide the corrected version.`;

export const codingTool = {
  name: "coding",
  purpose:
    "Generates, implements, refactors, or debugs code using the specialized Qwen2.5-Coder model.",
  whenToUse:
    "Use ONLY when the user explicitly requests writing code, implementing a software function/class/algorithm, generating a script, debugging code, or technical code refactoring (e.g. 'Write a Java function to reverse a string', 'Implement binary search in Python', 'Debug this JavaScript error').",
  whenNotToUse:
    "Do NOT use for general questions, conceptual explanations (e.g. 'Explain what an API is', 'What is OOP?'), arithmetic calculations (use calculator instead), deterministic string formatting (use text_transform instead), or searching uploaded documents (use retrieve_information instead).",
  description:
    "Generates, implements, refactors, or debugs code using specialized Qwen2.5-Coder. Use ONLY for programming, code implementation, algorithms, software development, syntax fixes, or debugging. Do NOT use for general questions, conceptual explanations (e.g. 'Explain what an API is'), math, or document retrieval.",
  inputSchema: {
    type: "object",
    required: ["task"],
    properties: {
      task: {
        type: "string",
        description:
          "The programming task, function requirement, implementation detail, or debugging goal.",
      },
      language: {
        type: "string",
        description:
          "Target programming language (e.g. 'java', 'javascript', 'python', 'cpp', 'typescript', 'go', 'rust', 'csharp').",
      },
      codeContext: {
        type: "string",
        description:
          "Optional existing code snippet or context to analyze, refactor, or debug.",
      },
    },
    validate: (input) => {
      if (!input || typeof input !== "object") {
        return { valid: false, error: "Input must be an object." };
      }
      if (!input.task || typeof input.task !== "string" || !input.task.trim()) {
        return { valid: false, error: "Missing or empty required field 'task'." };
      }
      return { valid: true };
    },
  },
  permissions: ["model:qwen2.5-coder"],
  execute: async (input, context = {}) => {
    try {
      const { task, language, codeContext } = input || {};

      if (!task || typeof task !== "string" || !task.trim()) {
        return {
          success: false,
          error: "Missing or empty required parameter 'task'.",
        };
      }

      let userPrompt = `Task: ${task.trim()}`;
      if (language && typeof language === "string" && language.trim()) {
        userPrompt += `\nTarget Language: ${language.trim()}`;
      }
      if (codeContext && typeof codeContext === "string" && codeContext.trim()) {
        userPrompt += `\nExisting Code / Context:\n${codeContext.trim()}`;
      }

      const messages = [
        { role: "system", content: CODING_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ];

      let generatedCodeText = "";

      // Allow offline testing mock injection via context or graph service
      const coderClientFn =
        typeof context.coderClient === "function" ? context.coderClient : null;

      const lifecycleHandler = typeof context.onProgress === "function" ? context.onProgress : null;

      await modelLock.withLock("Coding Agent", CODING_MODEL, async () => {
        if (coderClientFn) {
          generatedCodeText = await coderClientFn(messages);
        } else {
          generatedCodeText = await sendChatToOllama(
            messages,
            CODING_MODEL,
            {
              options: {
                temperature: 0.2,
                num_predict: 4096,
              },
              timeoutMs: 120_000,
            }
          );
        }
      }, lifecycleHandler);

      const cleanCode = typeof generatedCodeText === "string" ? generatedCodeText.trim() : "";

      // Detect programming language from markdown block or input
      let detectedLang = language ? language.toLowerCase().trim() : "text";
      const codeBlockMatch = cleanCode.match(/```([a-zA-Z0-9_+#.-]+)/);
      if (codeBlockMatch && codeBlockMatch[1]) {
        detectedLang = codeBlockMatch[1].toLowerCase();
      }

      return {
        success: true,
        code: cleanCode,
        language: detectedLang,
        task: task.trim(),
        model: CODING_MODEL,
        isExecutable: false, // Explicit guarantee: code is generated text, not executed on host
      };
    } catch (err) {
      return {
        success: false,
        error: `Coding tool error: ${err.message}`,
        model: CODING_MODEL,
      };
    }
  },
};

export default codingTool;
