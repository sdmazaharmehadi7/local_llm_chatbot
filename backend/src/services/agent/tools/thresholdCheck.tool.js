/**
 * Deterministic Threshold / Limit Check Tool
 *
 * Performs deterministic numerical comparison against engineering limits.
 *
 * GUARANTEES:
 * - Deterministic comparison (operator: >, <, >=, <=, ==, !=)
 * - Computes difference and percentage of allowable limit
 * - Safety rule: The tool only performs the mathematical comparison;
 *   it NEVER decides or invents whether an engineering limit is valid.
 */

export async function execute(input = {}) {
  const value = Number(input.value !== undefined ? input.value : input.val);
  const limit = Number(input.limit !== undefined ? input.limit : input.threshold);
  const rawOp = String(input.operator || input.op || ">").trim().toLowerCase();
  const unit = input.unit || "";

  if (Number.isNaN(value) || value === undefined) {
    return {
      tool: "threshold_check",
      status: "error",
      code: "INVALID_ARGUMENT_TYPE",
      field: "value",
      retryable: true,
      error: "Missing or invalid numeric 'value' to check.",
      message: "Please provide a valid numeric 'value' to check.",
    };
  }

  if (Number.isNaN(limit) || limit === undefined || input.limit === null || String(input.limit).trim() === "") {
    return {
      tool: "threshold_check",
      status: "error",
      code: "MISSING_LIMIT",
      retryable: false,
      error: "Missing or invalid numeric 'limit' threshold to compare against.",
      message: "Threshold limit is undefined or missing. Cannot evaluate compliance without a verified numeric limit from documentation. State that the limit is unavailable; never invent safety limits.",
    };
  }

  let op = ">";
  if (rawOp === ">" || rawOp === "gt" || rawOp === "greater_than" || rawOp === "above" || rawOp === "exceeds") op = ">";
  else if (rawOp === "<" || rawOp === "lt" || rawOp === "less_than" || rawOp === "below") op = "<";
  else if (rawOp === ">=" || rawOp === "gte" || rawOp === "greater_than_or_equal") op = ">=";
  else if (rawOp === "<=" || rawOp === "lte" || rawOp === "less_than_or_equal") op = "<=";
  else if (rawOp === "==" || rawOp === "=" || rawOp === "eq" || rawOp === "equal") op = "==";
  else if (rawOp === "!=" || rawOp === "ne" || rawOp === "not_equal") op = "!=";
  else {
    return {
      tool: "threshold_check",
      status: "error",
      error: `Unsupported comparison operator: '${rawOp}'. Expected one of: >, <, >=, <=, ==, !=`,
    };
  }

  let isBreached = false;
  let statusCode = "WITHIN_LIMIT";

  switch (op) {
    case ">":
      isBreached = value > limit;
      statusCode = isBreached ? "ABOVE_LIMIT" : (value === limit ? "AT_LIMIT" : "WITHIN_LIMIT");
      break;
    case ">=":
      isBreached = value >= limit;
      statusCode = isBreached ? (value === limit ? "AT_LIMIT" : "ABOVE_LIMIT") : "WITHIN_LIMIT";
      break;
    case "<":
      isBreached = value < limit;
      statusCode = isBreached ? "BELOW_LIMIT" : (value === limit ? "AT_LIMIT" : "WITHIN_LIMIT");
      break;
    case "<=":
      isBreached = value > limit;
      statusCode = isBreached ? "ABOVE_LIMIT" : (value === limit ? "AT_LIMIT" : "WITHIN_LIMIT");
      break;
    case "==":
      isBreached = value !== limit;
      statusCode = value === limit ? "AT_LIMIT" : "NOT_EQUAL";
      break;
    case "!=":
      isBreached = value === limit;
      statusCode = value === limit ? "AT_LIMIT" : "WITHIN_LIMIT";
      break;
  }

  const diff = Number((value - limit).toFixed(6));
  const pctOfLimit = limit !== 0 ? Number(((value / limit) * 100).toFixed(4)) : null;

  return {
    tool: "threshold_check",
    value,
    limit,
    operator: op,
    unit: unit || "",
    is_breached: isBreached,
    status_code: statusCode,
    difference: diff,
    percentage_of_limit: pctOfLimit,
    summary: `${value}${unit ? " " + unit : ""} is ${statusCode} (limit: ${limit}${unit ? " " + unit : ""}, operator: ${op})`,
    status: "success",
  };
}

export default {
  execute,
};
