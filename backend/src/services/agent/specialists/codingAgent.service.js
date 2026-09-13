/**
 * Coding Agent Specialist
 *
 * Dedicated programming, implementation, debugging, and sandbox execution
 * agent powered by Qwen2.5-Coder (qwen2.5-coder:7b).
 *
 * HARDWARE GUARANTEE:
 * - Code generation & revision executes strictly under the Single-Model Resource Lock
 *   ("Coding Agent", "qwen2.5-coder:7b").
 * - Sandbox execution is container-isolated without shell or network access.
 * - Manages bounded code repairs (up to 2 repair attempts).
 * - Restricted to coding domain; reports directly to Supervisor.
 */

import { modelLock } from "../modelLock.service.js";
import { CODING_SYSTEM_PROMPT, CODING_MODEL } from "../tools/coding.tool.js";
import { sandboxService } from "../sandbox.service.js";
import { sendChatToOllama } from "../../ollama.service.js";

export class CodingAgentService {
  /**
   * Generate or revise code delegated by Supervisor.
   *
   * @param {object} params
   * @param {string} params.task - Programming goal or bug fix instruction
   * @param {string} [params.language="python"] - Programming language
   * @param {string} [params.codeContext] - Existing code snippet / error details
   * @param {Function} [params.coderClient] - Optional test mock client
   * @returns {Promise<{
   *   success: boolean,
   *   agent: string,
   *   model: string,
   *   code: string,
   *   language: string,
   *   error?: string
   * }>}
   */
  async generateCode(params = {}) {
    const { task, language = "python", codeContext, coderClient } = params;

    if (!task || typeof task !== "string" || !task.trim()) {
      return {
        success: false,
        agent: "Coding Agent",
        model: CODING_MODEL,
        error: "Missing required parameter 'task'.",
        code: "",
        language,
      };
    }

    const startIso = new Date().toISOString();
    console.log(`\n[${startIso}] [Coding Agent] Executing code generation for: "${task.trim()}"`);

    // Enforce SINGLE-MODEL RESOURCE LOCK for the Coding Agent
    return await modelLock.withLock("Coding Agent", CODING_MODEL, async () => {
      const startTime = Date.now();
      try {
        let generatedText = "";

        if (typeof coderClient === "function") {
          generatedText = await coderClient({
            task: task.trim(),
            language,
            codeContext,
          });
        } else {
          let userPrompt = `Task: ${task.trim()}\nTarget Language: ${language}`;
          if (codeContext) {
            userPrompt += `\nExisting Code / Error Context:\n${codeContext.trim()}`;
          }

          const messages = [
            { role: "system", content: CODING_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ];

          generatedText = await sendChatToOllama(messages, CODING_MODEL, {
            think: false,
            timeoutMs: 180_000,
          });
        }

        // Extract pure code block if markdown fences are present
        let pureCode = String(generatedText || "").trim();
        const codeBlockMatch = pureCode.match(/```(?:[a-zA-Z0-9_\-]+)?\n([\s\S]*?)```/);
        if (codeBlockMatch) {
          pureCode = codeBlockMatch[1].trim();
        }

        const endIso = new Date().toISOString();
        console.log(`[${endIso}] [Coding Agent] Completed code generation (${Date.now() - startTime}ms)`);

        return {
          success: true,
          agent: "Coding Agent",
          model: CODING_MODEL,
          code: pureCode,
          language,
          rawOutput: generatedText,
          executionTimeMs: Date.now() - startTime,
        };
      } catch (err) {
        const errIso = new Date().toISOString();
        console.warn(`[${errIso}] [Coding Agent] Error during generation:`, err.message);
        return {
          success: false,
          agent: "Coding Agent",
          model: CODING_MODEL,
          error: err.message,
          code: "",
          language,
          executionTimeMs: Date.now() - startTime,
        };
      }
    });
  }

  /**
   * Execute code in the isolated container sandbox.
   *
   * @param {object} params
   * @param {string} params.code - Source code
   * @param {string} [params.language="python"]
   * @param {number} [params.timeoutMs=10000]
   * @param {Function} [params.sandboxRunner]
   * @returns {Promise<object>}
   */
  async executeSandbox(params = {}) {
    const { code, language = "python", timeoutMs = 10000, sandboxRunner } = params;
    const sbIso = new Date().toISOString();

    console.log(`\n[${sbIso}] [Coding Agent] Executing in container sandbox (${language})...`);

    if (typeof sandboxRunner === "function") {
      return await sandboxRunner({ code, language, timeoutMs });
    }

    return await sandboxService.executeCode({
      code,
      language,
      timeoutMs,
    });
  }
}

export const codingAgentService = new CodingAgentService();
export default codingAgentService;
