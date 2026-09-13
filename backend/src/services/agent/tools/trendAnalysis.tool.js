/**
 * Deterministic Trend Analysis Tool
 *
 * Implements deterministic calculation for:
 * - trend direction (increasing, decreasing, stable)
 * - overall change (last - first)
 * - percentage change ((last - first) / first * 100)
 * - rate of change per interval
 * - monotonicity check
 *
 * Does NOT generate speculative or unsupported engineering conclusions.
 */

export async function execute(input = {}) {
  const rawValues = input.values || input.data || input.series || input.readings;
  const tolerancePct = Number(input.tolerance_percentage ?? input.tolerancePct ?? 1.0); // 1% default stability band
  const unit = input.unit || "";

  if (!Array.isArray(rawValues) || rawValues.length < 2) {
    return {
      tool: "trend_analysis",
      status: "error",
      error: "Trend analysis requires an array of at least 2 sequential numerical values.",
    };
  }

  const values = [];
  for (const v of rawValues) {
    const num = Number(v);
    if (!Number.isNaN(num)) {
      values.push(num);
    }
  }

  if (values.length < 2) {
    return {
      tool: "trend_analysis",
      status: "error",
      error: "At least 2 valid numbers are required for trend evaluation.",
    };
  }

  const n = values.length;
  const first = values[0];
  const last = values[n - 1];
  const change = Number((last - first).toFixed(6));

  let pctChange = 0;
  if (first !== 0) {
    pctChange = Number((((last - first) / Math.abs(first)) * 100).toFixed(4));
  }

  const rateOfChange = Number(((last - first) / (n - 1)).toFixed(6));

  // Determine trend direction
  let trend = "stable";
  if (Math.abs(pctChange) <= tolerancePct) {
    trend = "stable";
  } else if (pctChange > tolerancePct || (first === 0 && change > 0)) {
    trend = "increasing";
  } else if (pctChange < -tolerancePct || (first === 0 && change < 0)) {
    trend = "decreasing";
  } else {
    trend = "stable";
  }

  // Check monotonicity
  let strictlyIncreasing = true;
  let strictlyDecreasing = true;
  for (let i = 1; i < n; i++) {
    if (values[i] <= values[i - 1]) strictlyIncreasing = false;
    if (values[i] >= values[i - 1]) strictlyDecreasing = false;
  }
  const isMonotonic = strictlyIncreasing || strictlyDecreasing;

  return {
    tool: "trend_analysis",
    trend,
    first_value: first,
    last_value: last,
    change,
    percentage_change: pctChange,
    rate_of_change: rateOfChange,
    sample_count: n,
    is_monotonic: isMonotonic,
    tolerance_percentage: tolerancePct,
    unit: unit || "",
    summary: `Series of ${n} points exhibits an ${trend.toUpperCase()} trend (${pctChange >= 0 ? "+" : ""}${pctChange}%, rate: ${rateOfChange}/step).`,
    status: "success",
  };
}

export default {
  execute,
};
