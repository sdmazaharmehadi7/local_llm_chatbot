/**
 * Secure Sandbox Code Execution Tool
 *
 * Explicit tool for executing code within a hardened, containerized sandbox.
 *
 * SECURITY GUARANTEES:
 * - Code is NEVER executed directly on the host machine.
 * - Always runs inside an isolated container with --network none and --read-only.
 * - Bounded memory, CPU, PID count, and execution timeout.
 * - Zero access to host secrets or environment variables.
 * - Captures stdout, stderr, and exit code cleanly.
 */

import { sandboxService } from "../sandbox.service.js";

export const executeCodeTool = {
  name: "execute_code",
  purpose:
    "Executes code within a secure, container-isolated sandbox with no network access, read-only root filesystem, and strict resource limits.",
  whenToUse:
    "Use ONLY when the user explicitly requests executing, running, testing, or evaluating code or scripts (e.g. 'Run this Python script', 'Execute this function and show output', 'Test this code snippet').",
  whenNotToUse:
    "Do NOT use for generating code (use coding instead), general questions, conceptual explanations (e.g. 'Explain what an API is'), simple arithmetic (use calculator instead), or document lookups (use retrieve_information instead). Never attempt arbitrary host shell access.",
  description:
    "Executes code within a secure container sandbox with no network access, read-only filesystem, resource limits, and timeout protection. Captures stdout, stderr, and exit status. Never executes on host.",
  inputSchema: {
    type: "object",
    required: ["code"],
    properties: {
      code: {
        type: "string",
        description: "The complete source code to execute inside the sandbox.",
      },
      language: {
        type: "string",
        description: "Programming language runtime: 'python', 'javascript', or 'sh' (default: 'python').",
      },
      timeoutMs: {
        type: "number",
        description: "Optional execution timeout in milliseconds (1000 - 30000, default: 10000).",
      },
    },
    validate: (input) => {
      if (!input || typeof input !== "object") {
        return { valid: false, error: "Input must be an object." };
      }
      if (!input.code || typeof input.code !== "string" || !input.code.trim()) {
        return { valid: false, error: "Missing or empty required field 'code'." };
      }
      return { valid: true };
    },
  },
  permissions: ["sandbox:container-exec"],
  execute: async (input, context = {}) => {
    try {
      const { code, language = "python", timeoutMs } = input || {};

      if (!code || typeof code !== "string" || !code.trim()) {
        return {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: "Missing required parameter 'code'.",
          executionTimeMs: 0,
          timedOut: false,
          language: language || "python",
          sandbox: { isolated: true },
          error: "Missing required parameter 'code'.",
        };
      }

      // Execute via sandbox service (or custom runner in context/service)
      const runner = typeof context.sandboxRunner === "function"
        ? context.sandboxRunner
        : null;

      if (runner) {
        return await runner({ code: code.trim(), language, timeoutMs });
      }

      return await sandboxService.executeCode({
        code: code.trim(),
        language,
        timeoutMs,
      });
    } catch (err) {
      return {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: `Sandbox execution error: ${err.message}`,
        executionTimeMs: 0,
        timedOut: false,
        language: input?.language || "python",
        sandbox: { isolated: true },
        error: err.message,
      };
    }
  },
};

export default executeCodeTool;
