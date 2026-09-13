/**
 * Vision Agent Specialist
 *
 * Dedicated visual reasoning, OCR, diagram inspection, and parameter extraction
 * agent powered by Qwen2.5-VL (qwen2.5vl:7b).
 *
 * HARDWARE GUARANTEE:
 * - Executes strictly under the Single-Model Resource Lock ("Vision Agent", "qwen2.5vl:7b").
 * - No other model can run simultaneously.
 * - Narrowly scoped to visual tasks; never performs calculations or acts as global orchestrator.
 */

import { modelLock } from "../modelLock.service.js";
import { isolateVisionPrompt, VISION_SYSTEM_PROMPT, VISION_MODEL } from "../tools/vision.tool.js";
import { sendChatToOllama } from "../../ollama.service.js";

export class VisionAgentService {
  /**
   * Execute visual task delegated by Supervisor.
   *
   * @param {object} params
   * @param {string} params.prompt - Visual instruction (e.g. "Extract discharge pressure from gauge")
   * @param {Array<string>} [params.images] - Base64 encoded images or data URLs
   * @param {Function} [params.visionClient] - Optional test mock client
   * @returns {Promise<{
   *   success: boolean,
   *   agent: string,
   *   model: string,
   *   analysis: string,
   *   extractedMeasurements: Array<string>,
   *   error?: string
   * }>}
   */
  async executeVisionTask(params = {}) {
    const { prompt, images = [], visionClient } = params;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return {
        success: false,
        agent: "Vision Agent",
        model: VISION_MODEL,
        error: "Missing required parameter 'prompt'.",
        analysis: "",
        extractedMeasurements: [],
      };
    }

    const cleanedPrompt = isolateVisionPrompt(prompt);
    const startIso = new Date().toISOString();
    console.log(`\n[${startIso}] [Vision Agent] Executing task: "${cleanedPrompt}"`);

    const effectiveImages = Array.isArray(images) && images.length > 0
      ? images
      : (params.image ? [params.image] : []);

    // Enforce SINGLE-MODEL RESOURCE LOCK for the Vision Agent
    return await modelLock.withLock("Vision Agent", VISION_MODEL, async () => {
      const startTime = Date.now();
      try {
        let rawAnalysis = "";

        if (typeof visionClient === "function") {
          rawAnalysis = await visionClient({
            prompt: cleanedPrompt,
            images: effectiveImages,
          });
        } else {
          // Prepare Ollama multimodal chat payload
          const formattedImages = effectiveImages
            .map((img) => {
              if (typeof img !== "string") return null;
              if (img.startsWith("data:") && img.includes(";base64,")) {
                return img.split(";base64,")[1];
              }
              return img;
            })
            .filter(Boolean);

          const messages = [
            { role: "system", content: VISION_SYSTEM_PROMPT },
            {
              role: "user",
              content: cleanedPrompt,
              images: formattedImages,
            },
          ];

          rawAnalysis = await sendChatToOllama(messages, VISION_MODEL, {
            think: false,
            timeoutMs: 180_000,
          });
        }

        const analysisText = String(rawAnalysis || "").trim();

        // Extract any detected numerical units/measurements from analysis
        const measurementRegex = /[-+]?\d*\.?\d+\s*(?:mm\/s|bar|psi|rpm|kw|deg|°c|°f|v|a|hz|kpa|mpa|gpm|m3\/h)\b/gi;
        const extracted = analysisText.match(measurementRegex) || [];
        const uniqueMeasurements = [...new Set(extracted)];

        const endIso = new Date().toISOString();
        console.log(`[${endIso}] [Vision Agent] Completed visual analysis (${Date.now() - startTime}ms)`);

        return {
          success: true,
          agent: "Vision Agent",
          model: VISION_MODEL,
          prompt: cleanedPrompt,
          analysis: analysisText,
          description: analysisText,
          extractedMeasurements: uniqueMeasurements,
          executionTimeMs: Date.now() - startTime,
        };
      } catch (err) {
        const errIso = new Date().toISOString();
        console.warn(`[${errIso}] [Vision Agent] Error during execution:`, err.message);
        return {
          success: false,
          agent: "Vision Agent",
          model: VISION_MODEL,
          prompt: cleanedPrompt,
          error: err.message,
          analysis: "",
          extractedMeasurements: [],
          executionTimeMs: Date.now() - startTime,
        };
      }
    });
  }
}

export const visionAgentService = new VisionAgentService();
export default visionAgentService;
