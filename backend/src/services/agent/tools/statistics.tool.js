/**
 * Deterministic Statistics Tool
 *
 * Implements deterministic calculation for:
 * - mean
 * - median
 * - minimum
 * - maximum
 * - range
 * - variance (sample & population)
 * - standard deviation (sample & population)
 *
 * Returns structured results for numerical analysis.
 */

export async function execute(input = {}) {
  const rawValues = input.values || input.data || input.numbers;
  const unit = input.unit || "";

  if (!Array.isArray(rawValues) || rawValues.length === 0) {
    return {
      tool: "statistics",
      status: "error",
      error: "Missing or invalid 'values' array. At least one numeric value is required.",
    };
  }

  const values = [];
  for (const v of rawValues) {
    const num = Number(v);
    if (!Number.isNaN(num)) {
      values.push(num);
    }
  }

  if (values.length === 0) {
    return {
      tool: "statistics",
      status: "error",
      error: "No valid numbers found in the provided 'values' array.",
    };
  }

  const n = values.length;
  const sorted = [...values].sort((a, b) => a - b);

  const min = sorted[0];
  const max = sorted[n - 1];
  const range = Number((max - min).toFixed(6));

  const sum = values.reduce((acc, curr) => acc + curr, 0);
  const mean = Number((sum / n).toFixed(6));

  // Median
  let median;
  const mid = Math.floor(n / 2);
  if (n % 2 === 0) {
    median = Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(6));
  } else {
    median = sorted[mid];
  }

  // Variance & Standard Deviation
  let sampleVariance = 0;
  let populationVariance = 0;
  let sampleStdDev = 0;
  let populationStdDev = 0;

  if (n > 1) {
    const sumSquaredDiffs = values.reduce((acc, curr) => acc + Math.pow(curr - mean, 2), 0);
    sampleVariance = Number((sumSquaredDiffs / (n - 1)).toFixed(6));
    populationVariance = Number((sumSquaredDiffs / n).toFixed(6));
    sampleStdDev = Number(Math.sqrt(sampleVariance).toFixed(6));
    populationStdDev = Number(Math.sqrt(populationVariance).toFixed(6));
  }

  return {
    tool: "statistics",
    count: n,
    mean,
    median,
    minimum: min,
    maximum: max,
    range,
    variance: sampleVariance,
    population_variance: populationVariance,
    standard_deviation: sampleStdDev,
    population_standard_deviation: populationStdDev,
    unit: unit || "",
    status: "success",
  };
}

export default {
  execute,
};
