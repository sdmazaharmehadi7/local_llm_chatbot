/**
 * Deterministic Threshold / Limit Checker Tool
 *
 * Compares a measured engineering value against an allowed limit or operating envelope.
 *
 * GUARANTEES:
 * - Deterministic threshold comparison (zero hallucination of limits)
 * - Computes exact difference and percentage difference
 * - Supports greater_than, less_than, equal_to, within_range, outside_range
 * - Does not invent limits: limits must be supplied (e.g., from Knowledge Base via Qwen3)
 */

/**
 * Clean numeric value or extract number from string (e.g. "7.2 mm/s" -> 7.2)
 */
function parseNumeric(val) {
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const match = val.match(/[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/);
    if (match) return parseFloat(match[0]);
  }
  return NaN;
}

/**
 * Check threshold deterministically
 */
export function checkThreshold(input = {}) {
  const { value, limit, comparison = "greater_than", unit = "" } = input;

  if (value === undefined || value === null) {
    throw new Error("Missing required parameter 'value'.");
  }
  if (limit === undefined || limit === null) {
    throw new Error("Missing required parameter 'limit'.");
  }

  const numVal = parseNumeric(value);
  if (Number.isNaN(numVal) || !Number.isFinite(numVal)) {
    throw new Error(`Invalid measurement value: "${value}". Must be a valid number.`);
  }

  const compNorm = String(comparison || "greater_than").trim().toLowerCase().replace(/[\s\-]+/g, "_");

  // Handle range comparisons
  const isRangeCheck =
    compNorm === "within_range" ||
    compNorm === "inside_range" ||
    compNorm === "outside_range" ||
    compNorm === "range";

  if (isRangeCheck) {
    let min, max;
    if (Array.isArray(limit) && limit.length >= 2) {
      min = parseNumeric(limit[0]);
      max = parseNumeric(limit[1]);
    } else if (typeof limit === "object" && limit !== null) {
      min = parseNumeric(limit.min ?? limit.lower ?? limit.lowerLimit);
      max = parseNumeric(limit.max ?? limit.upper ?? limit.upperLimit);
    } else if (typeof limit === "string" && limit.includes("-")) {
      const parts = limit.split("-");
      min = parseNumeric(parts[0]);
      max = parseNumeric(parts[1]);
    }

    if (Number.isNaN(min) || Number.isNaN(max) || min > max) {
      throw new Error(`Invalid range limit: "${JSON.stringify(limit)}". Expected { min, max } or [min, max].`);
    }

    const isInside = numVal >= min && numVal <= max;
    const isWithinDesired = compNorm === "within_range" || compNorm === "inside_range" || compNorm === "range";

    let status;
    let difference = 0;
    let percentageDifference = 0;

    if (isInside) {
      status = "WITHIN_RANGE";
      difference = 0;
      percentageDifference = 0;
    } else if (numVal < min) {
      status = "BELOW_LOWER_LIMIT";
      difference = Math.round((numVal - min) * 1e4) / 1e4;
      percentageDifference = min !== 0 ? Math.round(((numVal - min) / Math.abs(min)) * 10000) / 100 : 0;
    } else {
      status = "ABOVE_UPPER_LIMIT";
      difference = Math.round((numVal - max) * 1e4) / 1e4;
      percentageDifference = max !== 0 ? Math.round(((numVal - max) / Math.abs(max)) * 10000) / 100 : 0;
    }

    if (compNorm === "outside_range" && !isInside) {
      status = "OUTSIDE_RANGE";
    }

    const unitStr = unit ? ` ${unit}` : "";
    const pctStr = `${percentageDifference > 0 ? "+" : ""}${percentageDifference}%`;
    const formatted = `Value ${numVal}${unitStr} is ${status} (envelope: [${min}, ${max}]${unitStr}, diff: ${difference > 0 ? "+" : ""}${difference}${unitStr}, ${pctStr})`;

    return {
      value: numVal,
      limit: { min, max },
      comparison: compNorm,
      status,
      difference,
      percentageDifference,
      unit: unit || "",
      formatted,
    };
  }

  // Single scalar limit comparisons
  const numLimit = parseNumeric(limit);
  if (Number.isNaN(numLimit) || !Number.isFinite(numLimit)) {
    throw new Error(`Invalid limit value: "${limit}". Must be a valid number.`);
  }

  const rawDiff = numVal - numLimit;
  const difference = Math.round(rawDiff * 1e4) / 1e4;

  let percentageDifference = 0;
  if (numLimit !== 0) {
    percentageDifference = Math.round((rawDiff / Math.abs(numLimit)) * 10000) / 100;
  }

  let status;

  switch (compNorm) {
    case "greater_than":
    case ">":
    case "gt":
    case "above":
    case "above_limit": {
      if (numVal > numLimit) {
        status = "ABOVE_LIMIT";
      } else if (numVal < numLimit) {
        status = "BELOW_LIMIT";
      } else {
        status = "AT_LIMIT";
      }
      break;
    }
    case "less_than":
    case "<":
    case "lt":
    case "below":
    case "below_limit": {
      if (numVal < numLimit) {
        status = "BELOW_LIMIT";
      } else if (numVal > numLimit) {
        status = "ABOVE_LIMIT";
      } else {
        status = "AT_LIMIT";
      }
      break;
    }
    case "equal_to":
    case "==":
    case "=":
    case "eq": {
      status = Math.abs(difference) < 1e-6 ? "EQUAL" : "NOT_EQUAL";
      break;
    }
    default: {
      // Default to general threshold evaluation
      if (numVal > numLimit) {
        status = "ABOVE_LIMIT";
      } else if (numVal < numLimit) {
        status = "BELOW_LIMIT";
      } else {
        status = "AT_LIMIT";
      }
      break;
    }
  }

  const unitStr = unit ? ` ${unit}` : "";
  const sign = difference > 0 ? "+" : "";
  const formatted = `Value ${numVal}${unitStr} is ${status} (limit: ${numLimit}${unitStr}, diff: ${sign}${difference}${unitStr}, ${sign}${percentageDifference}%)`;

  return {
    value: numVal,
    limit: numLimit,
    comparison: compNorm,
    status,
    difference,
    percentageDifference,
    unit: unit || "",
    formatted,
  };
}

export const thresholdCheckerTool = {
  name: "threshold_checker",
  purpose: "Compares a measured engineering value against an allowed limit or operating envelope. Computes status (ABOVE_LIMIT, BELOW_LIMIT, WITHIN_RANGE, OUTSIDE_RANGE), difference, and percentage exceedance.",
  description: "Compares a measured value against an allowed limit or range. Computes status ('ABOVE_LIMIT', 'BELOW_LIMIT', 'WITHIN_RANGE', 'OUTSIDE_RANGE'), difference, and percentage difference. Limits must be supplied explicitly or retrieved from documents.",
  inputSchema: {
    type: "object",
    required: ["value", "limit"],
    properties: {
      value: {
        type: "number",
        description: "The measured engineering value.",
      },
      limit: {
        description: "The allowed limit number, or an operating range object/array (e.g. 5, or [2, 5], or { min: 2, max: 5 }).",
      },
      comparison: {
        type: "string",
        description: "Comparison type: 'greater_than', 'less_than', 'equal_to', 'within_range', or 'outside_range' (default: 'greater_than').",
      },
      unit: {
        type: "string",
        description: "Optional engineering unit (e.g. 'mm/s', 'bar', '°C').",
      },
    },
  },
  execute: async (input) => {
    try {
      const res = checkThreshold(input);
      return {
        success: true,
        ...res,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  },
};

export default thresholdCheckerTool;
