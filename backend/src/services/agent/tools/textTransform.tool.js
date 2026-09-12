/**
 * Text Transform Tool
 *
 * Deterministic text processing and extraction tool.
 *
 * GUARANTEES:
 * - Deterministic operations only
 * - Zero LLM invocations
 * - Safe string manipulations
 */

const SUPPORTED_OPERATIONS = new Set([
  "uppercase",
  "lowercase",
  "word_count",
  "char_count",
  "summarize",
  "trim",
  "reverse",
]);

/**
 * Deterministic extractive summarization without LLMs.
 * Extracts the primary sentences based on length and position.
 *
 * @param {string} text
 * @param {number} [maxSentences=3]
 * @returns {string}
 */
function deterministicSummarize(text, maxSentences = 3) {
  if (!text) return "";

  // Split into sentences using punctuation boundaries
  const rawSentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  if (rawSentences.length === 0) {
    return text.slice(0, 300);
  }

  // Pick lead sentences up to maxSentences
  const selected = rawSentences.slice(0, Math.max(1, maxSentences));
  return selected.join(" ");
}

export const textTransformTool = {
  name: "text_transform",
  purpose:
    "Performs deterministic string formatting transformations on text (uppercase, lowercase, word count, character count, extractive summarization, trimming, reversing).",
  whenToUse:
    "Use ONLY when the user explicitly requests text formatting or manipulation (e.g. 'convert to uppercase', 'make lowercase', 'reverse this string', 'count the words in this text').",
  whenNotToUse:
    "Do NOT use for answering general questions, searching documents, factual lookups, reasoning, or math. Do NOT use unless the user explicitly requested a specific string transformation operation.",
  description:
    "Performs deterministic string formatting transformations (uppercase, lowercase, word_count, char_count, summarize, trim, reverse). Use ONLY when the user explicitly requests text formatting or manipulation. Do NOT use for answering questions or document queries.",
  inputSchema: {
    type: "object",
    required: ["text", "operation"],
    properties: {
      text: {
        type: "string",
        description: "The text content to transform or inspect.",
      },
      operation: {
        type: "string",
        description:
          "Operation to perform: 'uppercase', 'lowercase', 'word_count', 'char_count', 'summarize', 'trim', 'reverse'.",
      },
      options: {
        type: "object",
        description: "Optional parameters (e.g. { maxSentences: 2 } for summarize).",
      },
    },
    validate: (input) => {
      if (!input || typeof input !== "object") {
        return { valid: false, error: "Input must be an object." };
      }
      if (typeof input.text !== "string") {
        return { valid: false, error: "Field 'text' must be a string." };
      }
      if (!SUPPORTED_OPERATIONS.has(input.operation)) {
        return {
          valid: false,
          error: `Unsupported operation "${input.operation}". Allowed: ${Array.from(
            SUPPORTED_OPERATIONS
          ).join(", ")}.`,
        };
      }
      return { valid: true };
    },
  },
  permissions: [],
  execute: async (input) => {
    try {
      const { text = "", operation, options = {} } = input || {};

      switch (operation) {
        case "uppercase": {
          const transformed = text.toUpperCase();
          return {
            success: true,
            operation,
            result: transformed,
            length: transformed.length,
          };
        }
        case "lowercase": {
          const transformed = text.toLowerCase();
          return {
            success: true,
            operation,
            result: transformed,
            length: transformed.length,
          };
        }
        case "word_count": {
          const words = text.trim().split(/\s+/).filter(Boolean);
          const count = text.trim().length === 0 ? 0 : words.length;
          return {
            success: true,
            operation,
            wordCount: count,
            result: String(count),
          };
        }
        case "char_count": {
          return {
            success: true,
            operation,
            charCount: text.length,
            charCountNoSpaces: text.replace(/\s+/g, "").length,
            result: String(text.length),
          };
        }
        case "summarize": {
          const maxSentences = Number(options.maxSentences) || 3;
          const summary = deterministicSummarize(text, maxSentences);
          return {
            success: true,
            operation,
            summary,
            result: summary,
            originalLength: text.length,
            summaryLength: summary.length,
          };
        }
        case "trim": {
          const trimmed = text.trim();
          return {
            success: true,
            operation,
            result: trimmed,
            length: trimmed.length,
          };
        }
        case "reverse": {
          const reversed = Array.from(text).reverse().join("");
          return {
            success: true,
            operation,
            result: reversed,
            length: reversed.length,
          };
        }
        default:
          return {
            success: false,
            error: `Unhandled or unsupported operation: "${operation}"`,
          };
      }
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  },
};

export default textTransformTool;
