/**
 * Deterministic Date/Time Tool
 *
 * Performs local, deterministic date and time calculations.
 *
 * GUARANTEES:
 * - Zero external APIs / zero cloud dependencies (uses local system time)
 * - Safe date parsing (handles ISO, standard English date formats like "1 September 2026", "2026-09-15")
 * - Operations: current_date, current_time, date_difference, add_subtract_days, add_subtract_months, compare_dates, identify_overdue
 */

/**
 * Robust date parser supporting ISO strings and standard English date formats
 */
export function parseDate(dateInput) {
  if (!dateInput) return null;
  if (dateInput instanceof Date && !Number.isNaN(dateInput.getTime())) {
    return dateInput;
  }

  if (typeof dateInput === "number") {
    const d = new Date(dateInput);
    if (!Number.isNaN(d.getTime())) return d;
  }

  if (typeof dateInput === "string") {
    const trimmed = dateInput.trim();

    // 1. Try direct Date constructor
    const directDate = new Date(trimmed);
    if (!Number.isNaN(directDate.getTime())) {
      return directDate;
    }

    // 2. Handle "DD Month YYYY" or "DD-MM-YYYY" formats
    // e.g. "1 September 2026", "15 Sept 2026", "15-09-2026"
    const MONTHS = {
      january: 0, jan: 0,
      february: 1, feb: 1,
      march: 2, mar: 2,
      april: 3, apr: 3,
      may: 4,
      june: 5, jun: 5,
      july: 6, jul: 6,
      august: 7, aug: 7,
      september: 8, sept: 8, sep: 8,
      october: 9, oct: 9,
      november: 10, nov: 10,
      december: 11, dec: 11,
    };

    const dmyWord = trimmed.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})$/);
    if (dmyWord) {
      const day = parseInt(dmyWord[1], 10);
      const mStr = dmyWord[2].toLowerCase();
      const year = parseInt(dmyWord[3], 10);
      if (MONTHS[mStr] !== undefined) {
        return new Date(year, MONTHS[mStr], day);
      }
    }

    const dmyNum = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmyNum) {
      const day = parseInt(dmyNum[1], 10);
      const month = parseInt(dmyNum[2], 10) - 1;
      const year = parseInt(dmyNum[3], 10);
      return new Date(year, month, day);
    }
  }

  return null;
}

/**
 * Format date to standard YYYY-MM-DD
 */
function formatDateIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Perform date/time operation
 */
export function executeDateTimeOperation(input = {}) {
  const {
    operation = "date_difference",
    date,
    date1,
    date2,
    amount,
    unit = "days",
    referenceDate,
  } = input;

  const opNorm = String(operation || "date_difference").trim().toLowerCase().replace(/[\s\-]+/g, "_");

  // 1. Current Date / Time
  if (
    opNorm === "current_date" ||
    opNorm === "current_time" ||
    opNorm === "current_datetime" ||
    opNorm === "now" ||
    opNorm === "today"
  ) {
    const now = new Date();
    const dateStr = formatDateIso(now);
    const timeStr = now.toTimeString().split(" ")[0];
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    return {
      operation: opNorm,
      currentDate: dateStr,
      currentTime: timeStr,
      iso: now.toISOString(),
      timezone,
      formatted: `Current system date/time: ${dateStr} ${timeStr} (${timezone})`,
    };
  }

  // 2. Date Difference
  if (
    opNorm === "date_difference" ||
    opNorm === "difference" ||
    opNorm === "days_between" ||
    opNorm === "between"
  ) {
    const rawD1 = date1 ?? date ?? input.startDate;
    const rawD2 = date2 ?? input.endDate;

    if (!rawD1 || !rawD2) {
      throw new Error("Date difference requires 'date1' (or 'startDate') and 'date2' (or 'endDate').");
    }

    const d1 = parseDate(rawD1);
    const d2 = parseDate(rawD2);

    if (!d1) throw new Error(`Invalid date format for date1: "${rawD1}".`);
    if (!d2) throw new Error(`Invalid date format for date2: "${rawD2}".`);

    // Normalized to UTC midnight for exact day count
    const utc1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const utc2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
    const diffMs = utc2 - utc1;
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    const absDays = Math.abs(diffDays);

    return {
      operation: "date_difference",
      startDate: formatDateIso(d1),
      endDate: formatDateIso(d2),
      daysDifference: absDays,
      signedDaysDifference: diffDays,
      formatted: `There are ${absDays} days between ${formatDateIso(d1)} and ${formatDateIso(d2)}.`,
    };
  }

  // 3. Add / Subtract Days or Months
  if (
    opNorm === "add_days" ||
    opNorm === "subtract_days" ||
    opNorm === "add_months" ||
    opNorm === "subtract_months" ||
    opNorm === "add_subtract_days" ||
    opNorm === "add_subtract_months"
  ) {
    const rawBaseDate = date ?? date1 ?? input.baseDate ?? new Date();
    const base = parseDate(rawBaseDate);
    if (!base) throw new Error(`Invalid base date: "${rawBaseDate}".`);

    const numAmount = typeof amount === "number" ? amount : parseFloat(amount);
    if (Number.isNaN(numAmount) || !Number.isFinite(numAmount)) {
      throw new Error(`Invalid amount: "${amount}". Must be a number.`);
    }

    const resultDate = new Date(base.getTime());

    const isMonth =
      opNorm.includes("month") ||
      String(unit).toLowerCase().startsWith("month");

    const isSubtract =
      opNorm.startsWith("sub") ||
      numAmount < 0;

    const absAmount = Math.abs(numAmount);
    const multiplier = isSubtract ? -1 : 1;

    if (isMonth) {
      resultDate.setMonth(resultDate.getMonth() + (multiplier * absAmount));
    } else {
      resultDate.setDate(resultDate.getDate() + (multiplier * absAmount));
    }

    const unitLabel = isMonth ? "month(s)" : "day(s)";
    const actionLabel = isSubtract ? "subtracted from" : "added to";

    return {
      operation: opNorm,
      baseDate: formatDateIso(base),
      amount: numAmount,
      resultDate: formatDateIso(resultDate),
      iso: resultDate.toISOString(),
      formatted: `${absAmount} ${unitLabel} ${actionLabel} ${formatDateIso(base)} = ${formatDateIso(resultDate)}`,
    };
  }

  // 4. Compare Dates
  if (opNorm === "compare_dates" || opNorm === "compare") {
    const rawD1 = date1 ?? date;
    const rawD2 = date2 ?? referenceDate;

    if (!rawD1 || !rawD2) {
      throw new Error("Date comparison requires 'date1' and 'date2'.");
    }

    const d1 = parseDate(rawD1);
    const d2 = parseDate(rawD2);

    if (!d1) throw new Error(`Invalid date format for date1: "${rawD1}".`);
    if (!d2) throw new Error(`Invalid date format for date2: "${rawD2}".`);

    const t1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
    const t2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());

    let comparisonResult = "EQUAL";
    if (t1 < t2) comparisonResult = "BEFORE";
    else if (t1 > t2) comparisonResult = "AFTER";

    return {
      operation: "compare_dates",
      date1: formatDateIso(d1),
      date2: formatDateIso(d2),
      result: comparisonResult,
      formatted: `${formatDateIso(d1)} is ${comparisonResult} ${formatDateIso(d2)}`,
    };
  }

  // 5. Identify Overdue
  if (opNorm === "identify_overdue" || opNorm === "is_overdue" || opNorm === "overdue") {
    const rawTarget = date ?? date1 ?? input.dueDate;
    if (!rawTarget) throw new Error("Identify overdue requires a target 'date' (or 'dueDate').");

    const target = parseDate(rawTarget);
    if (!target) throw new Error(`Invalid target date format: "${rawTarget}".`);

    const ref = referenceDate ? parseDate(referenceDate) : new Date();
    if (!ref) throw new Error(`Invalid reference date format: "${referenceDate}".`);

    const utcTarget = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
    const utcRef = Date.UTC(ref.getFullYear(), ref.getMonth(), ref.getDate());

    const diffDays = Math.round((utcRef - utcTarget) / (1000 * 60 * 60 * 24));
    const isOverdue = diffDays > 0;

    return {
      operation: "identify_overdue",
      targetDate: formatDateIso(target),
      referenceDate: formatDateIso(ref),
      isOverdue,
      daysOverdue: isOverdue ? diffDays : 0,
      daysRemaining: !isOverdue ? Math.abs(diffDays) : 0,
      formatted: isOverdue
        ? `OVERDUE: Date ${formatDateIso(target)} is ${diffDays} day(s) overdue (reference: ${formatDateIso(ref)}).`
        : `ON SCHEDULE: Date ${formatDateIso(target)} is not overdue (${Math.abs(diffDays)} day(s) remaining).`,
    };
  }

  throw new Error(`Unsupported date/time operation: "${operation}". Supported operations: current_date, current_time, date_difference, add_days, subtract_days, add_months, subtract_months, compare_dates, identify_overdue.`);
}

export const dateTimeTool = {
  name: "date_time",
  purpose: "Performs deterministic date and time operations locally (current date/time, date difference, add/subtract days/months, compare dates, identify overdue maintenance).",
  description: "Deterministic date/time operations. Operations: 'current_date', 'current_time', 'date_difference', 'add_days', 'subtract_days', 'add_months', 'subtract_months', 'compare_dates', 'identify_overdue'. No external APIs.",
  inputSchema: {
    type: "object",
    required: ["operation"],
    properties: {
      operation: {
        type: "string",
        description: "The date/time operation: 'current_date', 'current_time', 'date_difference', 'add_days', 'subtract_days', 'add_months', 'subtract_months', 'compare_dates', or 'identify_overdue'.",
      },
      date: {
        type: "string",
        description: "Target or base date (e.g. '2026-09-01' or '1 September 2026').",
      },
      date1: {
        type: "string",
        description: "First date for difference/comparison.",
      },
      date2: {
        type: "string",
        description: "Second date for difference/comparison.",
      },
      amount: {
        type: "number",
        description: "Number of days or months to add or subtract.",
      },
      referenceDate: {
        type: "string",
        description: "Optional reference date for comparison or overdue check (defaults to current system date).",
      },
    },
  },
  execute: async (input) => {
    try {
      const res = executeDateTimeOperation(input);
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

export default dateTimeTool;
