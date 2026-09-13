/**
 * Single-Model Execution Resource Lock & Smart Lifecycle Manager
 *
 * Enforces the strict hardware constraint that ONLY ONE LLM model may actively
 * execute inference at any given time (MAX ACTIVE LLM INFERENCE = 1).
 *
 * Decouples the execution lock from model residency:
 * - A model is unloaded/released ONLY when actually necessary.
 * - Same-model requests reuse resident models without redundant unload/reload cycles.
 * - When switching models (e.g. Qwen3 -> Qwen2.5-VL), verifies memory policy and
 *   safely releases the resident model before loading the new model.
 *
 * Lifecycle Logging:
 * 1. Model Reuse:
 *    [MODEL] <modelName> already resident
 *    [MODEL] Reusing <modelName>
 *    [MODEL] Executing
 *    [MODEL] Completed
 *
 * 2. Model Switch:
 *    [MODEL] <modelName> completed
 *    [MODEL] Model switch required
 *    [MODEL] Releasing <modelName>
 *    [MODEL] <modelName> released
 *    [MODEL] Loading <nextModelName>
 *    [MODEL] Executing
 *
 * 3. Model Retained (No Unload Required):
 *    [MODEL] <modelName> completed
 *    [MODEL] No unload required
 *    [MODEL] <modelName> retained
 */

import { isOllamaReachable, switchModel, unloadModel } from "../ollama.service.js";

class ModelLockService {
  constructor() {
    this._locked = false;
    this._currentHolder = null;
    this._currentModel = null;
    this._residentModel = null;
    this._maxResidentModels = 1;
    this._enforceZeroResidencyPolicy = false;
    this._waitQueue = [];
    this._activeInferences = 0;
    this._peakConcurrency = 0;
    this._history = [];
    this._intervals = [];
    this._currentAcquiredAt = null;
    this._currentEnqueueTime = null;
    this._metrics = {
      totalWaitTimeMs: 0,
      totalLoadTimeMs: 0,
      totalInferenceTimeMs: 0,
      totalReleaseTimeMs: 0,
      totalInvocations: 0,
      totalReuses: 0,
      totalSwitches: 0,
      perCall: [],
    };
  }

  /**
   * 5-Point Decision Policy to determine if a model should be unloaded:
   * 1. Is another model required next?
   * 2. Is the current model going to be reused soon?
   * 3. Would keeping it resident violate the configured memory/resource policy?
   * 4. Does the existing model-management/Ollama lifecycle require unloading it?
   * 5. Is unloading actually beneficial or necessary?
   *
   * @param {string} currentModel
   * @param {string|null} nextModel
   * @returns {{ shouldUnload: boolean, reason: string }}
   */
  shouldUnloadModel(currentModel, nextModel = null) {
    if (!currentModel) {
      return { shouldUnload: false, reason: "No resident model" };
    }

    // 1. If another model is explicitly queued next, switch is required
    if (nextModel && nextModel !== currentModel) {
      return {
        shouldUnload: true,
        reason: `Model switch required: ${currentModel} -> ${nextModel}`,
      };
    }

    // 2. If the same model is queued next, reuse immediately
    if (nextModel && nextModel === currentModel) {
      return {
        shouldUnload: false,
        reason: `Same model required next: reusing ${currentModel}`,
      };
    }

    // 3. Check memory policy: if strict zero-residency policy is explicitly requested
    if (this._enforceZeroResidencyPolicy) {
      return {
        shouldUnload: true,
        reason: "Zero residency policy enforced",
      };
    }

    // 4 & 5. By default, keeping the model resident eliminates unload/reload cycles
    return {
      shouldUnload: false,
      reason: `No unload required: retaining ${currentModel}`,
    };
  }

  /**
   * Acquire the single-model execution lock.
   * If another model is executing, the caller waits in a FIFO queue.
   *
   * @param {string} agentName - Name of the acquiring agent (e.g. "Supervisor", "Vision Agent", "Coding Agent")
   * @param {string} modelName - ID of the model to execute (e.g. "qwen3:8b", "qwen2.5vl:7b", "qwen2.5-coder:7b")
   * @param {Function} [onLifecycle] - Optional progress notification callback
   * @param {number} [customEnqueueTime] - Timestamp when request entered queue
   * @returns {Promise<{ waitTimeMs: number, loadTimeMs: number, reused: boolean }>}
   */
  async acquire(agentName = "Supervisor", modelName = "qwen3:8b", onLifecycle = null, customEnqueueTime = null) {
    const enqueueTime = customEnqueueTime || Date.now();
    console.log(`\n[MODEL-QUEUE]\nWaiting: ${modelName}`);

    if (this._locked) {
      await new Promise((resolve) => {
        this._waitQueue.push({ agentName, modelName, resolve, onLifecycle, enqueueTime });
      });
    }

    const acquiredAt = Date.now();
    const waitTimeMs = acquiredAt - enqueueTime;

    this._locked = true;
    this._currentHolder = agentName;
    this._currentModel = modelName;
    this._currentAcquiredAt = acquiredAt;
    this._currentEnqueueTime = enqueueTime;
    this._activeInferences++;
    if (this._activeInferences > this._peakConcurrency) {
      this._peakConcurrency = this._activeInferences;
    }

    if (this._activeInferences > 1) {
      this._activeInferences--;
      this._locked = false;
      throw new Error(
        `CRITICAL HARDWARE VIOLATION: Parallel LLM execution detected! Active inferences: ${this._activeInferences + 1}. Only one LLM model may execute at a time.`
      );
    }

    const iso = new Date().toISOString();
    this._history.push({
      event: "acquire",
      agent: agentName,
      model: modelName,
      timestamp: acquiredAt,
      iso,
      waitTimeMs,
    });

    console.log(`\n[MODEL-LOCK]\nAcquired`);

    const loadStart = Date.now();
    let reused = false;

    // Check if model is already resident
    if (this._residentModel === modelName) {
      reused = true;
      this._metrics.totalReuses++;
      console.log(`\n[MODEL] ${modelName} already resident`);
      console.log(`[MODEL] Reusing ${modelName}`);

      if (typeof onLifecycle === "function") {
        try {
          onLifecycle({
            type: "model_lifecycle",
            status: "model_reused",
            agent: agentName,
            model: modelName,
            timestamp: iso,
            message: `Model already resident: reusing ${modelName}...`,
          });
        } catch {
          // ignore callback error
        }
      }
    } else {
      // If a different model is currently resident, release it first
      if (this._residentModel && this._residentModel !== modelName) {
        console.log(`\n[MODEL] Model switch required`);
        console.log(`[MODEL] Releasing ${this._residentModel}`);
        try {
          const live = await isOllamaReachable();
          if (live && typeof unloadModel === "function") {
            await unloadModel(this._residentModel);
          }
        } catch {
          // offline mock mode
        }
        console.log(`[MODEL] ${this._residentModel} released`);
        this._metrics.totalSwitches++;
      }

      console.log(`\n[MODEL] Loading ${modelName}`);

      if (typeof onLifecycle === "function") {
        try {
          onLifecycle({
            type: "model_lifecycle",
            status: "model_loading",
            agent: agentName,
            model: modelName,
            timestamp: iso,
            message: `Model loading (${modelName})...`,
          });
        } catch {
          // ignore callback error
        }
      }

      // In live Ollama mode, load target model
      try {
        const live = await isOllamaReachable();
        if (live && typeof switchModel === "function") {
          await switchModel(modelName);
        }
      } catch {
        // Offline / test mock mode
      }

      this._residentModel = modelName;
    }

    const loadTimeMs = Date.now() - loadStart;
    console.log(`\n[MODEL] Executing`);

    return { waitTimeMs, loadTimeMs, reused };
  }

  /**
   * Release the single-model execution lock.
   * Keeps the model resident unless a switch is required by the next queued task
   * or memory policy requires unloading.
   *
   * @param {string} agentName
   * @param {string} modelName
   * @param {Function} [onLifecycle]
   * @param {object} [timings={}]
   * @returns {Promise<void>}
   */
  async release(agentName = "Supervisor", modelName = "qwen3:8b", onLifecycle = null, timings = {}) {
    const releaseStart = Date.now();
    const effectiveModel = modelName || this._currentModel || "qwen3:8b";
    const effectiveHolder = agentName || this._currentHolder || "Supervisor";
    const iso = new Date().toISOString();
    const now = Date.now();

    console.log(`\n[MODEL] ${effectiveModel} completed`);
    console.log(`[MODEL] Completed`);

    // Evaluate 5-point decision policy for model unloading
    const nextInQueue = this._waitQueue.length > 0 ? this._waitQueue[0].modelName : null;
    const decision = this.shouldUnloadModel(effectiveModel, nextInQueue);

    if (decision.shouldUnload) {
      console.log(`\n[MODEL] Model switch required`);
      console.log(`[MODEL] Releasing ${effectiveModel}`);
      try {
        const live = await isOllamaReachable();
        if (live && typeof unloadModel === "function") {
          await unloadModel(effectiveModel);
        }
      } catch {
        // offline mock mode
      }
      console.log(`[MODEL] ${effectiveModel} released`);
      this._residentModel = null;
    } else {
      console.log(`\n[MODEL] No unload required`);
      console.log(`[MODEL] ${effectiveModel} retained`);
      this._residentModel = effectiveModel;
    }

    console.log(`\n[MODEL-LOCK]\nReleased`);

    const inferenceTimeMs = timings.inferenceTimeMs || (this._currentAcquiredAt ? (now - this._currentAcquiredAt) : 0);
    const waitTimeMs = timings.waitTimeMs || (this._currentEnqueueTime && this._currentAcquiredAt ? (this._currentAcquiredAt - this._currentEnqueueTime) : 0);
    const loadTimeMs = timings.loadTimeMs || 0;
    const releaseTimeMs = Date.now() - releaseStart;

    if (this._currentAcquiredAt) {
      this._intervals.push({
        agent: effectiveHolder,
        model: effectiveModel,
        start: this._currentAcquiredAt,
        end: now,
        durationMs: now - this._currentAcquiredAt,
      });
    }

    this._metrics.totalInvocations++;
    this._metrics.totalWaitTimeMs += waitTimeMs;
    this._metrics.totalLoadTimeMs += loadTimeMs;
    this._metrics.totalInferenceTimeMs += inferenceTimeMs;
    this._metrics.totalReleaseTimeMs += releaseTimeMs;
    this._metrics.perCall.push({
      agent: effectiveHolder,
      model: effectiveModel,
      reused: timings.reused || false,
      waitTimeMs,
      loadTimeMs,
      inferenceTimeMs,
      releaseTimeMs,
      timestamp: now,
    });

    this._history.push({
      event: "release",
      agent: effectiveHolder,
      model: effectiveModel,
      timestamp: now,
      iso,
      reused: timings.reused || false,
      inferenceTimeMs,
      releaseTimeMs,
    });

    if (typeof onLifecycle === "function") {
      try {
        onLifecycle({
          type: "model_lifecycle",
          status: "model_released",
          agent: effectiveHolder,
          model: effectiveModel,
          resident: this._residentModel === effectiveModel,
          timestamp: iso,
          message: `Inference lock released (${effectiveModel}). Resident: ${this._residentModel || "none"}.`,
        });
      } catch {
        // ignore callback error
      }
    }

    this._activeInferences = Math.max(0, this._activeInferences - 1);
    this._locked = false;
    this._currentHolder = null;
    this._currentModel = null;
    this._currentAcquiredAt = null;
    this._currentEnqueueTime = null;

    // Wake up next waiting agent in the FIFO queue and log next model
    if (this._waitQueue.length > 0) {
      const next = this._waitQueue.shift();
      console.log(`\n[MODEL-QUEUE]\nNext: ${next.modelName}`);
      next.resolve();
    } else {
      console.log(`\n[MODEL-QUEUE]\nNext: none`);
    }
  }

  /**
   * Run an asynchronous LLM task safely wrapped within the model execution lock.
   *
   * @param {string} agentName
   * @param {string} modelName
   * @param {Function} asyncFn
   * @param {Function} [onLifecycle]
   * @returns {Promise<any>}
   */
  async withLock(agentName, modelName, asyncFn, onLifecycle = null) {
    const enqueueTime = Date.now();
    const timings = await this.acquire(agentName, modelName, onLifecycle, enqueueTime);
    const inferenceStart = Date.now();
    try {
      return await asyncFn();
    } finally {
      const inferenceTimeMs = Date.now() - inferenceStart;
      await this.release(agentName, modelName, onLifecycle, {
        waitTimeMs: timings.waitTimeMs,
        loadTimeMs: timings.loadTimeMs,
        reused: timings.reused,
        inferenceTimeMs,
      });
    }
  }

  getActiveInferences() {
    return this._activeInferences;
  }

  getPeakConcurrency() {
    return this._peakConcurrency;
  }

  getResidentModel() {
    return this._residentModel;
  }

  setResidentModel(modelName) {
    this._residentModel = modelName;
  }

  setZeroResidencyPolicy(enforce = false) {
    this._enforceZeroResidencyPolicy = enforce;
  }

  isLocked() {
    return this._locked;
  }

  getCurrentHolder() {
    return this._currentHolder;
  }

  getCurrentModel() {
    return this._currentModel;
  }

  getHistory() {
    return [...this._history];
  }

  getIntervals() {
    return [...this._intervals];
  }

  getPerformanceMetrics() {
    return {
      ...this._metrics,
      residentModel: this._residentModel,
      peakModelConcurrency: this._peakConcurrency,
    };
  }

  resetHistory() {
    this._history = [];
    this._intervals = [];
    this._peakConcurrency = 0;
    this._residentModel = null;
    this._metrics = {
      totalWaitTimeMs: 0,
      totalLoadTimeMs: 0,
      totalInferenceTimeMs: 0,
      totalReleaseTimeMs: 0,
      totalInvocations: 0,
      totalReuses: 0,
      totalSwitches: 0,
      perCall: [],
    };
  }
}

export const modelLock = new ModelLockService();
export default modelLock;
