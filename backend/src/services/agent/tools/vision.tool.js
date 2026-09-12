/**
 * Specialized Vision Tool (Qwen2.5-VL)
 *
 * Dedicated image, diagram, schematic, and visual document inspection capability
 * for the sovereign LangGraph agent, powered by local qwen2.5vl:7b.
 *
 * SECURITY & GOVERNANCE:
 * - 100% on-premise visual analysis via local Ollama (http://localhost:11434).
 * - Zero transmission of image payloads to external/cloud services.
 * - Strict context isolation: Image payloads are NEVER forwarded to Qwen2.5-Coder.
 * - Stale image data is isolated to the vision action and stripped from subsequent text turns.
 * - Supports test client injection (context.visionClient) for offline testing.
 */

import { sendChatToOllama } from "../../ollama.service.js";

export const VISION_MODEL = "qwen2.5vl:7b";

export const VISION_SYSTEM_PROMPT = `You are a specialized visual document and image analysis engine powered by Qwen2.5-VL.
Your ONLY responsibility is to visually inspect the provided image and extract what is visible.

STRICT NON-AGENT & EXTRACTION-ONLY BOUNDARIES:
1. Provide an accurate visual description or extraction of what is depicted in the image.
2. Transcribe visible text, instrument tags (e.g. PI-102), labels, legends, equations, and numbers exactly as displayed.
3. Separate input parameters, formulas, and displayed answers:
   - Extract raw input values and units (e.g. P = 22 kW, N = 960 RPM).
   - Extract displayed formulas exactly as written (e.g. T = (P × 9550) / N).
   - If an equation or example already shows a printed answer, label it as the displayed answer (e.g. "displayed_answer": "218.9 Nm").
4. STRICT CALCULATION PROHIBITION:
   - Do NOT perform arithmetic or calculate values.
   - Do NOT evaluate formulas or verify whether calculations are correct.
   - Do NOT calculate intermediate steps or percentage error.
   - NEVER output computed arithmetic results (e.g. NEVER output "22 * 9550 / 960 = 218.85").
   - All calculation and verification is strictly handled by the Calculator tool, not Vision.
5. Do NOT invoke, mention, or recommend other tools (such as Calculator, RAG, or Coding).
6. Do not hallucinate or invent readings that are not visible. If an element is unreadable or blurry, state so clearly.`;

/**
 * Isolates and cleanses a vision instruction so the specialist vision model
 * NEVER receives instructions intended for Calculator, Coding, or RAG,
 * while preserving the specific visual objective (diagram, table, OCR, inspection).
 *
 * @param {string} rawPrompt
 * @returns {string}
 */
export function isolateVisionPrompt(rawPrompt) {
  if (!rawPrompt || typeof rawPrompt !== "string" || !rawPrompt.trim()) {
    return "Inspect the uploaded image. Extract all visible text, numbers, formulas, displayed results, and units. Do not perform any calculations or verification.";
  }

  let cleaned = rawPrompt.trim();

  // Match cross-tool commands that delegate to other tools
  const crossToolPattern = /\b(?:and\s+)?(?:use|call|using)\s+(?:the\s+)?calculator(?:\s+tool)?(?:\s+to\s+[^.!?]+)?\b/gi;
  const verifyPattern = /\b(?:and\s+)?(?:independently\s+)?verify\s+(?:them\s+|each\s+|the\s+)?(?:calculation[s]?|totals?|results?)(?:\s+shown\s+in\s+the\s+image)?(?:\s+using\s+(?:the\s+)?calculator(?:\s+tool)?)?\b/gi;
  const percentErrorPattern = /\b(?:and\s+)?(?:calculate|compute)\s+(?:the\s+)?percentage\s+error\b/gi;
  const codePattern = /\b(?:and\s+)?(?:use|using)\s+(?:the\s+)?(?:coding|sandbox|execute_code)\s+tool\b/gi;
  const runPythonPattern = /\b(?:and\s+)?(?:run|execute)\s+(?:in\s+)?(?:python|sandbox|code)\b/gi;
  const kbPattern = /\b(?:and\s+)?(?:search|retrieve\s+from)\s+(?:the\s+)?knowledge\s+base\b/gi;

  const hadCrossToolInstruction =
    crossToolPattern.test(cleaned) ||
    verifyPattern.test(cleaned) ||
    percentErrorPattern.test(cleaned) ||
    codePattern.test(cleaned) ||
    runPythonPattern.test(cleaned) ||
    kbPattern.test(cleaned);

  if (hadCrossToolInstruction) {
    cleaned = cleaned
      .replace(crossToolPattern, "")
      .replace(verifyPattern, "")
      .replace(percentErrorPattern, "")
      .replace(codePattern, "")
      .replace(runPythonPattern, "")
      .replace(kbPattern, "")
      .trim();

    // Clean up dangling commas, connectives, and punctuation
    cleaned = cleaned
      .replace(/,\s*,/g, ",")
      .replace(/\s{2,}/g, " ")
      .replace(/[.,;:\s]+$/, "")
      .trim();

    if (!cleaned || cleaned.length < 5) {
      return "Inspect the uploaded image. Extract all visible values, formulas, displayed results, and units. Do not perform any calculations or verification.";
    }

    // Ensure the cleaned visual objective retains an explicit extraction-only guard
    if (!/do not (?:calculate|perform)/i.test(cleaned)) {
      return `${cleaned}. Extract visible values, formulas, displayed answers, and units exactly as shown. Do not calculate or verify.`;
    }
  }

  return cleaned;
}

/**
 * Validates that an image string is valid base64 or a valid data URL.
 *
 * @param {string} img
 * @returns {{ valid: boolean, cleanBase64?: string, error?: string }}
 */
export function validateAndNormalizeImage(img) {
  if (!img || typeof img !== "string" || !img.trim()) {
    return { valid: false, error: "Image input is empty or not a string." };
  }

  const trimmed = img.trim();

  // Check for supported data URI pattern: data:image/(png|jpeg|jpg|webp|gif);base64,...
  const dataUriMatch = trimmed.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/s);
  if (dataUriMatch) {
    const rawB64 = dataUriMatch[2].replace(/\s+/g, "");
    if (!rawB64 || rawB64.length < 4) {
      return { valid: false, error: "Data URL contains empty or malformed base64 payload." };
    }
    return { valid: true, cleanBase64: rawB64 };
  }

  // Check if it's an unsupported data URI (e.g. data:application/pdf or data:text/plain)
  if (trimmed.startsWith("data:")) {
    return {
      valid: false,
      error: "Unsupported data URL type. Only image data URLs (e.g. data:image/png;base64,...) are supported.",
    };
  }

  // Test raw base64 string
  const cleanB64 = trimmed.replace(/\s+/g, "");
  // Basic base64 validation (alphanumeric + '+' + '/' with optional '=' padding)
  const isBase64Pattern = /^[A-Za-z0-9+/]+={0,2}$/.test(cleanB64);
  if (!isBase64Pattern || cleanB64.length < 4) {
    return {
      valid: false,
      error: "Invalid base64 image data. Input is neither a valid base64 string nor a data:image URL.",
    };
  }

  return { valid: true, cleanBase64: cleanB64 };
}

export const visionTool = {
  name: "vision",
  purpose:
    "Performs visual analysis, OCR, diagram inspection, chart reading, or equipment photo inspection using the specialized Qwen2.5-VL model.",
  whenToUse:
    "Use ONLY when the user's request requires inspecting an image, photo, diagram, schematic, chart, or visual document (e.g. 'What is shown in this image?', 'Read the gauge value in the photo', 'Describe the architecture in this diagram').",
  whenNotToUse:
    "Do NOT use for pure text questions, conceptual explanations (e.g. 'Explain what an API is'), programming tasks without an image (use coding), arithmetic calculations (use calculator), or searching text-only documents (use retrieve_information).",
  description:
    "Analyzes images, diagrams, schematics, charts, or visual documents using specialized Qwen2.5-VL. Use ONLY when visual inspection or OCR is explicitly requested or when an image is attached. Do NOT use for text-only questions, coding, or math.",
  inputSchema: {
    type: "object",
    required: ["prompt"],
    properties: {
      prompt: {
        type: "string",
        description:
          "The visual inspection question, OCR instruction, or details to analyze and extract from the image.",
      },
      image: {
        type: "string",
        description:
          "Optional base64 encoded image string or data URL. If omitted, uses the image attached to the active agent task.",
      },
    },
    validate: (input) => {
      if (!input || typeof input !== "object") {
        return { valid: false, error: "Input must be an object." };
      }
      if (!input.prompt || typeof input.prompt !== "string" || !input.prompt.trim()) {
        return { valid: false, error: "Missing or empty required field 'prompt'." };
      }
      return { valid: true };
    },
  },
  permissions: ["model:qwen2.5-vl"],
  execute: async (input, context = {}) => {
    try {
      const { prompt, image } = input || {};

      if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
        return {
          success: false,
          error: "Missing or empty required parameter 'prompt'.",
        };
      }

      // Resolve image: direct input > context.images[0] > context.image
      let rawImage = image;
      if (!rawImage && Array.isArray(context.images) && context.images.length > 0) {
        rawImage = context.images[0];
      } else if (!rawImage && typeof context.image === "string") {
        rawImage = context.image;
      }

      if (!rawImage) {
        return {
          success: false,
          error: "No image provided for visual analysis. Please provide an image input or attach an image to the request.",
        };
      }

      // Validate image format and normalize
      const validation = validateAndNormalizeImage(rawImage);
      if (!validation.valid) {
        return {
          success: false,
          error: `Unsupported image input: ${validation.error}`,
        };
      }

      const cleanImagePayload = validation.cleanBase64;
      const isolatedPrompt = isolateVisionPrompt(prompt);

      // Construct Ollama multimodal message with isolated vision instruction
      const messages = [
        { role: "system", content: VISION_SYSTEM_PROMPT },
        {
          role: "user",
          content: isolatedPrompt,
          images: [cleanImagePayload],
        },
      ];

      let analysisText = "";

      // Allow offline testing mock injection via context or graph service
      const visionClientFn =
        typeof context.visionClient === "function" ? context.visionClient : null;

      if (visionClientFn) {
        analysisText = await visionClientFn(messages, { image: cleanImagePayload });
      } else {
        analysisText = await sendChatToOllama(
          messages,
          VISION_MODEL,
          {
            options: {
              temperature: 0.2,
              num_predict: 2048,
            },
            timeoutMs: 120_000,
          }
        );
      }

      const cleanAnalysis = typeof analysisText === "string" ? analysisText.trim() : "";

      // Extract basic structured cues (numbers/readings/tags) from text if present
      const extractedNumbers = [];
      const numMatches = cleanAnalysis.matchAll(/(\d+(?:\.\d+)?)\s*(bar|psi|mm\/s|rpm|°c|%|v|hz|m3\/h|gpm|kpa)/gi);
      for (const m of numMatches) {
        extractedNumbers.push(`${m[1]} ${m[2]}`);
      }

      return {
        success: true,
        model: VISION_MODEL,
        prompt: prompt.trim(),
        analysis: cleanAnalysis,
        extractedMeasurements: extractedNumbers.length > 0 ? extractedNumbers : undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: `Vision tool error: ${err.message}`,
        model: VISION_MODEL,
      };
    }
  },
};

export default visionTool;
