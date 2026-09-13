/**
 * Deterministic Statistics Tool
 *
 * Performs exact statistical computations on numerical engineering data.
 *
 * GUARANTEES:
 * - Deterministic calculations (count, sum, mean, median, min, max, range, standard deviation, percentage change)
 * - Safe numeric array parsing (handles strings like "4.2", trims whitespace)
 * - Strictly computational: does not interpret safety implications (Qwen3 interprets)
 */

/**
 * Calculate standard deviation (sample and population)
 */
function calculateStdDev(nums, meanVal) {
  if (nums.length <= 1) return 0;
  const squaredDiffs = nums.map((n) => Math.pow(n - meanVal, 2));
  const sumSquaredDiffs = squaredDiffs.reduce((acc, curr) => acc + curr, 0);
  // Sample standard deviation (N - 1)
  const sampleVariance = sumSquaredDiffs / (nums.length - 1);
  return Math.sqrt(sampleVariance);
}

/**
 * Calculate median
 */
function calculateMedian(sortedNums) {
  const len = sortedNums.length;
  if (len === 0) return 0;
  const mid = Math.floor(len / 2);
  if (len % 2 === 0) {
    return (sortedNums[mid - 1] + sortedNums[mid]) / 2;
  }
  return sortedNums[mid];
}

/**
 * Calculate statistics deterministically
 */
export function calculateStatistics(input = {}) {
  const { values, operations } = input;

  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Missing or empty 'values' parameter. Must provide an array of numbers.");
  }

  // Sanitize and validate numbers
  const nums = [];
  for (let i = 0; i < values.length; i++) {
    const raw = values[i];
    const n = typeof raw === "number" ? raw : parseFloat(raw);
    if (Number.isNaN(n) || !Number.isFinite(n)) {
      throw new Error(`Invalid numeric element at index ${i}: "${raw}".`);
    }
    nums.push(n);
  }

  const count = nums.length;
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = sum / count;

  const sorted = [...nums].sort((a, b) => a - b);
  const minimum = sorted[0];
  const maximum = sorted[sorted.length - 1];
  const range = maximum - minimum;
  const median = calculateMedian(sorted);
  const standardDeviation = calculateStdDev(nums, mean);

  // Percentage change from first element to last element
  const first = nums[0];
  const last = nums[nums.length - 1];
  let percentageChange = 0;
  if (first !== 0) {
    percentageChange = ((last - first) / Math.abs(first)) * 100;
  }

  const allStats = {
    count,
    sum: Math.round(sum * 1e6) / 1e6,
    mean: Math.round(mean * 1e4) / 1e4,
    median: Math.round(median * 1e4) / 1e4,
    minimum: Math.round(minimum * 1e6) / 1e6,
    maximum: Math.round(maximum * 1e6) / 1e6,
    range: Math.round(range * 1e6) / 1e6,
    standardDeviation: Math.round(standardDeviation * 1e4) / 1e4,
    percentageChange: Math.round(percentageChange * 100) / 100,
  };

  // Filter requested operations if specified
  const requestedOps = Array.isArray(operations) && operations.length > 0
    ? operations.map((op) => String(op).toLowerCase().trim().replace(/[\s\-]+/g, "_"))
    : ["all"];

  const results = {};
  if (requestedOps.includes("all")) {
    Object.assign(results, allStats);
  } else {
    for (const op of requestedOps) {
      if (op === "count") results.count = allStats.count;
      else if (op === "sum" || op === "total") results.sum = allStats.sum;
      else if (op === "mean" || op === "average" || op === "avg") results.mean = allStats.mean;
      else if (op === "median") results.median = allStats.median;
      else if (op === "minimum" || op === "min") results.minimum = allStats.minimum;
      else if (op === "maximum" || op === "max") results.maximum = allStats.maximum;
      else if (op === "range") results.range = allStats.range;
      else if (op === "standard_deviation" || op === "std_dev" || op === "stddev") results.standardDeviation = allStats.standardDeviation;
      else if (op === "percentage_change" || op === "percent_change") results.percentageChange = allStats.percentageChange;
    }
    // If no recognized op matched, include all
    if (Object.keys(results).length === 0) {
      Object.assign(results, allStats);
    }
  }

  const formattedParts = Object.entries(results).map(([k, v]) => `${k}: ${v}`);
  const formatted = `Statistics [${count} data points]: ${formattedParts.join(", ")}`;

  return {
    count,
    results,
    allStats,
    requestedOperations: requestedOps,
    formatted,
  };
}

export const statisticsTool = {
  name: "statistics",
  purpose: "Performs deterministic statistical calculations on numerical engineering data (count, sum, mean, median, minimum, maximum, range, standard deviation, percentage change).",
  description: "Calculates statistics for numerical lists. Operations: count, sum, mean, median, minimum, maximum, range, standard_deviation, percentage_change. Provide values array and optional operations array.",
  inputSchema: {
    type: "object",
    required: ["values"],
    properties: {
      values: {
        type: "array",
        items: { type: "number" },
        description: "List of numerical measurements or values to analyze (e.g. [4.2, 5.1, 4.8, 6.0, 5.4]).",
      },
      operations: {
        type: "array",
        items: { type: "string" },
        description: "Optional operations to perform: 'count', 'sum', 'mean', 'median', 'minimum', 'maximum', 'range', 'standard_deviation', 'percentage_change', or 'all' (default).",
      },
    },
  },
  execute: async (input) => {
    try {
      const res = calculateStatistics(input);
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

export default statisticsTool;
