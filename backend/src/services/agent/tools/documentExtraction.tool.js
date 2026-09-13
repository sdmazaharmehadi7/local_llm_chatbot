/**
 * Deterministic Document Extraction Tool
 *
 * Extracts structured industrial engineering fields, measurements, metadata,
 * and tabular data from supplied document text, OCR output, or inspection reports.
 *
 * GUARANTEES:
 * - Deterministic parsing and regular expression extraction
 * - Does NOT replace RAG: extracts structured fields from provided text only
 * - Extracts: equipment IDs, inspection dates, pressure readings, temperature readings,
 *   vibration values, serial numbers, metadata, and markdown/delimited tables.
 * - Associates extracted fields with line numbers and source context.
 */

/**
 * Extract equipment IDs (e.g., P-101, PI-102B, PMP-401, TK-502, HX-201, V-102)
 */
function extractEquipmentIds(lines) {
  const results = [];
  const regex = /\b(?:Equipment(?:\s*ID)?|Tag(?:\s*No\.?)?|Unit|Pump|Transmitter)?\s*[:#\-]?\s*([A-Z]{1,4}-[0-9]{2,5}[A-Z]?)\b/gi;
  const standaloneRegex = /\b([A-Z]{1,4}-[0-9]{2,5}[A-Z]?)\b/g;

  lines.forEach((line, idx) => {
    const cleanLine = line.trim();
    // Skip lines explicitly identifying serial numbers
    if (/\b(?:Serial(?:\s*(?:No\.?|Number))?|S\/N)\b/i.test(cleanLine)) {
      return;
    }

    let match;
    while ((match = regex.exec(cleanLine)) !== null) {
      const val = match[1]?.toUpperCase();
      if (val && !val.startsWith("ISO-") && !val.startsWith("SN-") && !results.some((r) => r.value === val)) {
        results.push({
          field: "equipment_id",
          value: val,
          raw: cleanLine,
          line: idx + 1,
        });
      }
    }

    // Also check standalone IDs if none caught
    while ((match = standaloneRegex.exec(cleanLine)) !== null) {
      const val = match[1]?.toUpperCase();
      if (val && !val.startsWith("ISO-") && !val.startsWith("SN-") && !results.some((r) => r.value === val)) {
        results.push({
          field: "equipment_id",
          value: val,
          raw: cleanLine,
          line: idx + 1,
        });
      }
    }
  });

  return results;
}

/**
 * Extract serial numbers (e.g. SN-883921, Serial Number: 109283-B)
 */
function extractSerialNumbers(lines) {
  const results = [];
  const regex = /\b(?:Serial(?:\s*(?:No\.?|Number))?|S\/N|SN)\s*[:#\-]?\s*([A-Z0-9\-]{5,20})\b/gi;

  lines.forEach((line, idx) => {
    let match;
    const cleanLine = line.trim();
    while ((match = regex.exec(cleanLine)) !== null) {
      if (match[1] && !results.some((r) => r.value === match[1])) {
        results.push({
          field: "serial_number",
          value: match[1],
          raw: cleanLine,
          line: idx + 1,
        });
      }
    }
  });

  return results;
}

/**
 * Extract inspection and report dates (e.g., 2026-09-01, 15 September 2026, 12/05/2026)
 */
function extractDates(lines) {
  const results = [];
  const isoRegex = /\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\b/g;
  const dmyRegex = /\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\b/g;
  const wordDateRegex = /\b(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/gi;
  const prefixRegex = /\b(?:Date|Inspection Date|Timestamp|Report Date)\s*[:#\-]?\s*([^\n\r,;]+)/gi;

  lines.forEach((line, idx) => {
    const cleanLine = line.trim();
    let match;

    // Dates with explicit label prefix
    while ((match = prefixRegex.exec(cleanLine)) !== null) {
      const dateStr = match[1].trim();
      if (dateStr && !results.some((r) => r.value === dateStr)) {
        results.push({
          field: "inspection_date",
          value: dateStr,
          raw: cleanLine,
          line: idx + 1,
        });
      }
    }

    // ISO dates
    while ((match = isoRegex.exec(cleanLine)) !== null) {
      if (!results.some((r) => r.value === match[1])) {
        results.push({
          field: "inspection_date",
          value: match[1],
          raw: cleanLine,
          line: idx + 1,
        });
      }
    }

    // Word month dates
    while ((match = wordDateRegex.exec(cleanLine)) !== null) {
      if (!results.some((r) => r.value === match[1])) {
        results.push({
          field: "inspection_date",
          value: match[1],
          raw: cleanLine,
          line: idx + 1,
        });
      }
    }

    // DMY numbers
    while ((match = dmyRegex.exec(cleanLine)) !== null) {
      if (!results.some((r) => r.value === match[1])) {
        results.push({
          field: "inspection_date",
          value: match[1],
          raw: cleanLine,
          line: idx + 1,
        });
      }
    }
  });

  return results;
}

/**
 * Extract pressure readings (e.g. 5.4 bar, 78.3 psi, 150 kPa, 2.5 MPa)
 */
function extractPressureReadings(lines) {
  const results = [];
  const regex = /\b(?:(suction|discharge|operating|design|measured)?\s*pressure)?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(bar|psi|kPa|MPa|Pa)\b/gi;

  lines.forEach((line, idx) => {
    const cleanLine = line.trim();
    let match;
    while ((match = regex.exec(cleanLine)) !== null) {
      const role = match[1] ? `${match[1].toLowerCase()}_pressure` : "pressure_reading";
      const valStr = `${match[2]} ${match[3]}`;
      results.push({
        field: role,
        value: valStr,
        numericValue: parseFloat(match[2]),
        unit: match[3],
        raw: cleanLine,
        line: idx + 1,
      });
    }
  });

  return results;
}

/**
 * Extract temperature readings (e.g. 68.5 °C, 155.3 °F, 341 K)
 */
function extractTemperatureReadings(lines) {
  const results = [];
  const regex = /\b(?:(bearing|casing|motor|inlet|outlet|ambient)?\s*temp(?:erature)?)?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(°C|°F|C|F|K|deg\s*C|deg\s*F)\b/gi;

  lines.forEach((line, idx) => {
    const cleanLine = line.trim();
    let match;
    while ((match = regex.exec(cleanLine)) !== null) {
      const role = match[1] ? `${match[1].toLowerCase()}_temperature` : "temperature_reading";
      const valStr = `${match[2]} ${match[3].replace(/\s+/g, "")}`;
      results.push({
        field: role,
        value: valStr,
        numericValue: parseFloat(match[2]),
        unit: match[3],
        raw: cleanLine,
        line: idx + 1,
      });
    }
  });

  return results;
}

/**
 * Extract vibration values (e.g. 7.2 mm/s, 4.5 mm/s RMS, 0.18 in/s)
 */
function extractVibrationValues(lines) {
  const results = [];
  const regex = /\b(?:(drive[- ]end|non[- ]drive[- ]end|motor|pump|bearing)?\s*vibration)?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*(mm\/s(?:\s*RMS)?|in\/s|m\/s\^2|g)\b/gi;

  lines.forEach((line, idx) => {
    const cleanLine = line.trim();
    let match;
    while ((match = regex.exec(cleanLine)) !== null) {
      const role = match[1] ? `${match[1].toLowerCase().replace(/[\s\-]+/g, "_")}_vibration` : "vibration_value";
      const valStr = `${match[2]} ${match[3]}`;
      results.push({
        field: role,
        value: valStr,
        numericValue: parseFloat(match[2]),
        unit: match[3],
        raw: cleanLine,
        line: idx + 1,
      });
    }
  });

  return results;
}

/**
 * Extract Markdown or pipe-separated tables into structured row objects
 */
function extractTables(lines) {
  const tables = [];
  let currentTable = null;

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cols = trimmed
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());

      // Check if divider line (|---|---|)
      const isDivider = cols.every((c) => /^:?-+:?$/.test(c));

      if (!currentTable) {
        currentTable = { startLine: idx + 1, headers: cols, rows: [] };
      } else if (isDivider) {
        // Just header separator, skip
      } else {
        const rowObj = {};
        currentTable.headers.forEach((h, hIdx) => {
          rowObj[h || `col_${hIdx + 1}`] = cols[hIdx] || "";
        });
        currentTable.rows.push(rowObj);
      }
    } else {
      if (currentTable && currentTable.rows.length > 0) {
        tables.push(currentTable);
      }
      currentTable = null;
    }
  });

  if (currentTable && currentTable.rows.length > 0) {
    tables.push(currentTable);
  }

  return tables;
}

/**
 * Extract document metadata (title, author, inspector, status)
 */
function extractMetadata(lines) {
  const metadata = {};
  const metaRegex = /^(Title|Report|Author|Inspector|Technician|Status|Facility|Location|Department|System)\s*[:=]\s*(.+)$/i;

  lines.forEach((line) => {
    const match = line.trim().match(metaRegex);
    if (match) {
      const key = match[1].toLowerCase();
      metadata[key] = match[2].trim();
    }
  });

  return metadata;
}

/**
 * Extract structured information from document text
 */
export function extractDocumentFields(input = {}) {
  const { text, fields } = input;

  if (!text || typeof text !== "string" || !text.trim()) {
    throw new Error("Missing or empty document 'text'. Provide text to extract structured fields from.");
  }

  const lines = text.split(/\r?\n/);
  const requestedFields = Array.isArray(fields) && fields.length > 0
    ? fields.map((f) => String(f).toLowerCase().trim().replace(/[\s\-]+/g, "_"))
    : ["all"];

  const wantAll = requestedFields.includes("all");
  const wantField = (name) => wantAll || requestedFields.some((f) => f.includes(name) || name.includes(f));

  const allDetails = [];

  // 1. Equipment IDs
  if (wantField("equipment") || wantField("tag") || wantField("id")) {
    allDetails.push(...extractEquipmentIds(lines));
  }

  // 2. Inspection Dates
  if (wantField("date") || wantField("time") || wantField("inspection")) {
    allDetails.push(...extractDates(lines));
  }

  // 3. Serial Numbers
  if (wantField("serial") || wantField("sn")) {
    allDetails.push(...extractSerialNumbers(lines));
  }

  // 4. Pressure Readings
  if (wantField("pressure") || wantField("psi") || wantField("bar")) {
    allDetails.push(...extractPressureReadings(lines));
  }

  // 5. Temperature Readings
  if (wantField("temperature") || wantField("temp")) {
    allDetails.push(...extractTemperatureReadings(lines));
  }

  // 6. Vibration Values
  if (wantField("vibration")) {
    allDetails.push(...extractVibrationValues(lines));
  }

  // 7. Tables
  let tables = [];
  if (wantField("table")) {
    tables = extractTables(lines);
  }

  // 8. Metadata
  let metadata = {};
  if (wantField("meta") || wantField("author") || wantField("title") || wantField("status")) {
    metadata = extractMetadata(lines);
  }

  // Build clean dictionary of extracted fields
  const extractedFields = {};
  for (const item of allDetails) {
    if (!extractedFields[item.field]) {
      extractedFields[item.field] = item.value;
    } else if (Array.isArray(extractedFields[item.field])) {
      if (!extractedFields[item.field].includes(item.value)) {
        extractedFields[item.field].push(item.value);
      }
    } else if (extractedFields[item.field] !== item.value) {
      extractedFields[item.field] = [extractedFields[item.field], item.value];
    }
  }

  // Aliases for convenience: equipmentId, inspectionDate, vibrationReading, etc.
  if (extractedFields.equipment_id && !extractedFields.equipmentId) {
    extractedFields.equipmentId = extractedFields.equipment_id;
  }
  if (extractedFields.inspection_date && !extractedFields.inspectionDate) {
    extractedFields.inspectionDate = extractedFields.inspection_date;
  }
  if (extractedFields.vibration_value && !extractedFields.vibrationReading) {
    extractedFields.vibrationReading = extractedFields.vibration_value;
  }
  if (extractedFields.pressure_reading && !extractedFields.pressureReading) {
    extractedFields.pressureReading = extractedFields.pressure_reading;
  }

  const summary = Object.entries(extractedFields)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join("; ");

  return {
    extractedFields,
    details: allDetails,
    tables: tables.length > 0 ? tables : undefined,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    totalFieldsExtracted: allDetails.length,
    formatted: `Extracted Fields: ${summary || "None detected"}`,
  };
}

export const documentExtractionTool = {
  name: "document_extraction",
  purpose: "Extracts structured engineering fields (equipment IDs, inspection dates, pressure/temperature readings, vibration values, serial numbers, metadata, and tables) from supplied text.",
  description: "Extracts structured industrial fields from text or OCR output. Supports equipment IDs, inspection dates, pressure/temp/vibration readings, serial numbers, and tables. Does NOT replace RAG.",
  inputSchema: {
    type: "object",
    required: ["text"],
    properties: {
      text: {
        type: "string",
        description: "The document text, OCR output, or report excerpt to extract structured fields from.",
      },
      fields: {
        type: "array",
        items: { type: "string" },
        description: "Optional list of specific fields to extract (e.g. ['equipment_id', 'inspection_date', 'vibration_value']). If omitted, extracts all detected fields.",
      },
    },
  },
  execute: async (input) => {
    try {
      const res = extractDocumentFields(input);
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

export default documentExtractionTool;
