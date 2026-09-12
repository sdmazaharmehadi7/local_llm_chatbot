/**
 * Sovereign Container Sandbox Service
 *
 * Provides a secure, container-isolated execution layer for agent-generated code.
 *
 * SECURITY BOUNDARIES & HARDENING:
 * 1. Zero Host Execution: Code is NEVER executed directly on the host machine.
 * 2. Container Isolation: Every run creates an ephemeral, isolated Docker container (--rm).
 * 3. Network Isolation: Network is completely disabled (--network none).
 * 4. Filesystem Restrictions: Container root filesystem is read-only (--read-only).
 *    A bounded tmpfs is mounted at /tmp for required scratch operations (--tmpfs /tmp:rw,nosuid,size=64m).
 * 5. Resource Limits: Memory capped at 256MB (--memory 256m), CPU capped at 1.0 (--cpus 1.0),
 *    and process limits enforce anti-fork-bomb protection (--pids-limit 64).
 * 6. Privilege Restrictions: All Linux capabilities dropped (--cap-drop ALL) and
 *    privilege escalation disabled (--security-opt no-new-privileges).
 * 7. Host Secrets Protection: Host environment variables are NOT forwarded to the container.
 * 8. Execution Timeout: Bounded runtime with process/container termination if exceeded.
 * 9. Stream Caps: Stdout and stderr buffers are bounded (max 128KB) to prevent OOM.
 */

import { spawn } from "child_process";

export const SANDBOX_DEFAULTS = {
  TIMEOUT_MS: 10_000,
  MAX_TIMEOUT_MS: 30_000,
  MIN_TIMEOUT_MS: 1_000,
  MAX_OUTPUT_BYTES: 128 * 1024, // 128 KB
  MEMORY_LIMIT: "256m",
  CPUS: "1.0",
  PIDS_LIMIT: 64,
  TMPFS_CONFIG: "/tmp:rw,nosuid,size=64m",
};

export const SUPPORTED_LANGUAGES = {
  python: {
    image: "python:3.11-alpine",
    command: ["python3", "-"],
    aliases: ["python", "python3", "py"],
  },
  javascript: {
    image: "node:20-alpine",
    command: ["node", "-"],
    aliases: ["javascript", "js", "node"],
  },
  shell: {
    image: "alpine:latest",
    command: ["sh", "-s"],
    aliases: ["sh", "bash", "shell"],
  },
};

/**
 * Resolve language identifier to supported container runtime configuration
 */
export function resolveLanguageConfig(langInput = "python") {
  const norm = String(langInput || "python").trim().toLowerCase();
  for (const [key, cfg] of Object.entries(SUPPORTED_LANGUAGES)) {
    if (cfg.aliases.includes(norm)) {
      return { key, ...cfg };
    }
  }
  // Default to python
  return { key: "python", ...SUPPORTED_LANGUAGES.python };
}

class SandboxService {
  constructor() {
    this.customRunner = null; // Test hook for offline / deterministic testing
  }

  /**
   * Set custom sandbox runner (used strictly for offline automated tests)
   */
  setSandboxRunner(runnerFn) {
    this.customRunner = runnerFn;
  }

  /**
   * Reset custom sandbox runner to real Docker container execution
   */
  resetSandboxRunner() {
    this.customRunner = null;
  }

  /**
   * Execute code string within a secured, containerized sandbox.
   *
   * @param {object} params
   * @param {string} params.code - Source code to execute
   * @param {string} [params.language="python"] - Programming language
   * @param {number} [params.timeoutMs=10000] - Execution timeout in ms
   * @param {string} [params.stdin=""] - Optional standard input to pipe to code
   * @returns {Promise<{
   *   success: boolean,
   *   exitCode: number,
   *   stdout: string,
   *   stderr: string,
   *   executionTimeMs: number,
   *   timedOut: boolean,
   *   language: string,
   *   sandbox: object,
   *   error?: string
   * }>}
   */
  async executeCode({
    code,
    language = "python",
    timeoutMs = SANDBOX_DEFAULTS.TIMEOUT_MS,
    stdin = "",
  }) {
    if (typeof code !== "string" || !code.trim()) {
      return {
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "Error: No code provided to execute.",
        executionTimeMs: 0,
        timedOut: false,
        language: language || "unknown",
        sandbox: { isolated: true },
        error: "No code provided.",
      };
    }

    const langConfig = resolveLanguageConfig(language);
    const effectiveTimeout = Math.max(
      SANDBOX_DEFAULTS.MIN_TIMEOUT_MS,
      Math.min(Number(timeoutMs) || SANDBOX_DEFAULTS.TIMEOUT_MS, SANDBOX_DEFAULTS.MAX_TIMEOUT_MS)
    );

    // If a custom test runner is registered (e.g. for offline unit testing), invoke it
    if (typeof this.customRunner === "function") {
      return this.customRunner({
        code: code.trim(),
        language: langConfig.key,
        timeoutMs: effectiveTimeout,
        stdin,
      });
    }

    return this._runInDockerContainer({
      code: code.trim(),
      langConfig,
      timeoutMs: effectiveTimeout,
      stdin,
    });
  }

  /**
   * Spawns a hardened Docker container and pipes code through stdin.
   * @private
   */
  _runInDockerContainer({ code, langConfig, timeoutMs, stdin }) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdoutAccumulator = "";
      let stderrAccumulator = "";
      let isFinished = false;
      let timedOut = false;

      // Build hardened container run arguments
      const dockerArgs = [
        "run",
        "-i", // Keep stdin open to stream code directly
        "--rm", // Clean up container filesystem on exit
        "--network", "none", // NO network access permitted
        "--read-only", // Entire root filesystem is read-only
        "--tmpfs", SANDBOX_DEFAULTS.TMPFS_CONFIG, // Volatile isolated tmpfs for /tmp only
        "--memory", SANDBOX_DEFAULTS.MEMORY_LIMIT, // RAM limit
        "--cpus", SANDBOX_DEFAULTS.CPUS, // CPU limit
        "--pids-limit", String(SANDBOX_DEFAULTS.PIDS_LIMIT), // Fork-bomb mitigation
        "--cap-drop", "ALL", // Drop all Linux capabilities
        "--security-opt", "no-new-privileges", // Block privilege elevation
        langConfig.image,
        ...langConfig.command,
      ];

      // Spawn docker with empty environment to prevent passing host secrets/env
      const child = spawn("docker", dockerArgs, {
        env: {
          PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
        },
      });

      // Timeout watchdog
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore kill error
        }
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        isFinished = true;
      };

      child.stdout.on("data", (data) => {
        if (stdoutAccumulator.length < SANDBOX_DEFAULTS.MAX_OUTPUT_BYTES) {
          stdoutAccumulator += data.toString();
        }
      });

      child.stderr.on("data", (data) => {
        if (stderrAccumulator.length < SANDBOX_DEFAULTS.MAX_OUTPUT_BYTES) {
          stderrAccumulator += data.toString();
        }
      });

      child.on("error", (err) => {
        if (isFinished) return;
        cleanup();
        const executionTimeMs = Date.now() - startTime;

        let errMsg = err.message;
        if (err.code === "ENOENT") {
          errMsg = "Container engine (Docker) is not installed or not in system PATH. Code execution on host is prohibited.";
        }

        resolve({
          success: false,
          exitCode: 127,
          stdout: stdoutAccumulator.trim(),
          stderr: `Sandbox error: ${errMsg}`,
          executionTimeMs,
          timedOut: false,
          language: langConfig.key,
          sandbox: {
            isolated: true,
            containerEngine: "docker",
          },
          error: errMsg,
        });
      });

      child.on("close", (code, signal) => {
        if (isFinished) return;
        cleanup();
        const executionTimeMs = Date.now() - startTime;

        let finalExitCode = code !== null ? code : 1;
        if (timedOut) {
          finalExitCode = 124; // Standard timeout exit code
          stderrAccumulator += `\nExecution timed out after ${timeoutMs}ms. Process terminated.`;
        } else if (signal === "SIGKILL" || signal === "SIGTERM") {
          finalExitCode = 137;
        }

        const isSuccess = finalExitCode === 0 && !timedOut;

        resolve({
          success: isSuccess,
          exitCode: finalExitCode,
          stdout: stdoutAccumulator.trim(),
          stderr: stderrAccumulator.trim(),
          executionTimeMs,
          timedOut,
          language: langConfig.key,
          sandbox: {
            isolated: true,
            network: "none",
            filesystem: "read-only",
            memoryLimit: SANDBOX_DEFAULTS.MEMORY_LIMIT,
            cpuLimit: SANDBOX_DEFAULTS.CPUS,
            pidsLimit: SANDBOX_DEFAULTS.PIDS_LIMIT,
            containerEngine: "docker",
            image: langConfig.image,
          },
          ...(isSuccess ? {} : { error: stderrAccumulator.trim() || `Process exited with code ${finalExitCode}` }),
        });
      });

      // Stream the code to the container's stdin and close it
      try {
        if (stdin) {
          child.stdin.write(stdin);
          if (!stdin.endsWith("\n")) child.stdin.write("\n");
        }
        child.stdin.write(code);
        child.stdin.end();
      } catch (writeErr) {
        if (!isFinished) {
          cleanup();
          resolve({
            success: false,
            exitCode: 1,
            stdout: "",
            stderr: `Sandbox stdin error: ${writeErr.message}`,
            executionTimeMs: Date.now() - startTime,
            timedOut: false,
            language: langConfig.key,
            sandbox: { isolated: true },
            error: writeErr.message,
          });
        }
      }
    });
  }
}

export const sandboxService = new SandboxService();
export default sandboxService;
