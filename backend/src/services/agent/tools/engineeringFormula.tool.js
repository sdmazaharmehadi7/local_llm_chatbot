/**
 * Deterministic Engineering Formula Tool
 *
 * Executes approved, registered industrial engineering formulas deterministically.
 *
 * GUARANTEES:
 * - Never invents formulas: only executes formulas explicitly registered in the registry
 * - Strict parameter validation and range checking (e.g. speed > 0, torque > 0)
 * - Extensible: new approved formulas can be registered cleanly without modifying agent architecture
 * - Returns structured output: formulaName, formulaUsed, inputValues, calculatedResult, unit
 */

/**
 * Registry of approved industrial formulas
 */
const FORMULA_REGISTRY = new Map();

/**
 * Register an approved engineering formula
 *
 * @param {string} id Unique formula identifier
 * @param {object} definition Formula definition
 * @param {string} definition.name Human readable formula name
 * @param {string} definition.formula Mathematical representation
 * @param {string} definition.outputUnit Unit of calculated result
 * @param {Array<{key: string, name: string, unit: string, required: boolean, validate?: (v: number) => boolean}>} definition.parameters
 * @param {Function} definition.calculate Calculation function taking params object
 * @param {Array<string>} [definition.aliases] Alternative names/keys
 */
export function registerFormula(id, definition) {
  const entry = {
    id: id.toLowerCase().trim(),
    name: definition.name,
    formula: definition.formula,
    outputUnit: definition.outputUnit,
    parameters: definition.parameters || [],
    calculate: definition.calculate,
    aliases: (definition.aliases || []).map((a) => a.toLowerCase().trim()),
  };
  FORMULA_REGISTRY.set(entry.id, entry);
  for (const alias of entry.aliases) {
    FORMULA_REGISTRY.set(alias, entry);
  }
}

// -------------------------------------------------------------------------
// Initial Registered Pump Formulas
// -------------------------------------------------------------------------

// 1. Pump Torque: T = P * 9550 / N
registerFormula("pump_torque", {
  name: "Pump Torque",
  formula: "T = P * 9550 / N",
  outputUnit: "Nm",
  aliases: ["torque", "calculate_torque", "motor_torque", "shaft_torque"],
  parameters: [
    {
      key: "P",
      name: "Power",
      unit: "kW",
      required: true,
      validate: (v) => v >= 0,
      description: "Power in kilowatts (kW)",
    },
    {
      key: "N",
      name: "Speed",
      unit: "RPM",
      required: true,
      validate: (v) => v > 0,
      description: "Rotational speed in revolutions per minute (RPM)",
    },
  ],
  calculate: ({ P, N }) => {
    return (P * 9550) / N;
  },
});

// 2. Pump Power from Torque and Speed: P = T * N / 9550
registerFormula("pump_power", {
  name: "Pump Power",
  formula: "P = T * N / 9550",
  outputUnit: "kW",
  aliases: ["power_from_torque", "calculate_power", "motor_power"],
  parameters: [
    {
      key: "T",
      name: "Torque",
      unit: "Nm",
      required: true,
      validate: (v) => v >= 0,
      description: "Torque in Newton-meters (Nm)",
    },
    {
      key: "N",
      name: "Speed",
      unit: "RPM",
      required: true,
      validate: (v) => v > 0,
      description: "Rotational speed in revolutions per minute (RPM)",
    },
  ],
  calculate: ({ T, N }) => {
    return (T * N) / 9550;
  },
});

// 3. Pump Speed from Power and Torque: N = P * 9550 / T
registerFormula("pump_speed", {
  name: "Pump Speed",
  formula: "N = P * 9550 / T",
  outputUnit: "RPM",
  aliases: ["speed_from_power_torque", "calculate_speed", "calculate_rpm", "rpm"],
  parameters: [
    {
      key: "P",
      name: "Power",
      unit: "kW",
      required: true,
      validate: (v) => v >= 0,
      description: "Power in kilowatts (kW)",
    },
    {
      key: "T",
      name: "Torque",
      unit: "Nm",
      required: true,
      validate: (v) => v > 0,
      description: "Torque in Newton-meters (Nm)",
    },
  ],
  calculate: ({ P, T }) => {
    return (P * 9550) / T;
  },
});

/**
 * Get all registered formula metadata
 */
export function getRegisteredFormulas() {
  const seen = new Set();
  const list = [];
  for (const entry of FORMULA_REGISTRY.values()) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      list.push({
        id: entry.id,
        name: entry.name,
        formula: entry.formula,
        outputUnit: entry.outputUnit,
        parameters: entry.parameters.map((p) => ({
          key: p.key,
          name: p.name,
          unit: p.unit,
          description: p.description,
        })),
      });
    }
  }
  return list;
}

/**
 * Execute an approved formula deterministically
 */
export function executeFormula(formulaNameOrKey, rawParams = {}) {
  if (!formulaNameOrKey || typeof formulaNameOrKey !== "string") {
    throw new Error("Missing formula name. Please provide a registered formula name or key (e.g. 'pump_torque').");
  }

  const normalizedKey = formulaNameOrKey.trim().toLowerCase().replace(/[\s\-]+/g, "_");
  const formulaDef = FORMULA_REGISTRY.get(normalizedKey);

  if (!formulaDef) {
    const available = getRegisteredFormulas().map((f) => `"${f.id}" (${f.name}: ${f.formula})`).join(", ");
    throw new Error(`Formula "${formulaNameOrKey}" is not registered in the approved engineering formula catalog. Available registered formulas: ${available}.`);
  }

  // Normalize parameter keys (e.g. case-insensitive match: P, p, power -> P)
  const normalizedInputs = {};
  const lowerRawParams = {};
  for (const [k, v] of Object.entries(rawParams || {})) {
    lowerRawParams[k.toLowerCase()] = v;
  }

  for (const param of formulaDef.parameters) {
    const directVal = rawParams[param.key] ?? lowerRawParams[param.key.toLowerCase()] ?? lowerRawParams[param.name.toLowerCase()];
    if (directVal === undefined || directVal === null) {
      if (param.required) {
        throw new Error(`Missing required parameter '${param.key}' (${param.name} in ${param.unit}) for formula "${formulaDef.name}".`);
      }
    } else {
      const numVal = typeof directVal === "number" ? directVal : parseFloat(directVal);
      if (Number.isNaN(numVal) || !Number.isFinite(numVal)) {
        throw new Error(`Invalid numerical value for parameter '${param.key}': "${directVal}".`);
      }
      if (typeof param.validate === "function" && !param.validate(numVal)) {
        throw new Error(`Parameter '${param.key}' (${numVal}) failed validation for formula "${formulaDef.name}". Value must be positive/non-zero.`);
      }
      normalizedInputs[param.key] = numVal;
    }
  }

  const rawResult = formulaDef.calculate(normalizedInputs);
  const calculatedResult = Math.round(rawResult * 1e4) / 1e4;

  const paramSummary = Object.entries(normalizedInputs)
    .map(([k, v]) => `${k} = ${v}`)
    .join(", ");

  return {
    formulaName: formulaDef.name,
    formulaUsed: formulaDef.formula,
    inputValues: normalizedInputs,
    calculatedResult,
    unit: formulaDef.outputUnit,
    formatted: `${formulaDef.name} (${formulaDef.formula}) with [${paramSummary}] = ${calculatedResult} ${formulaDef.outputUnit}`,
  };
}

export const engineeringFormulaTool = {
  name: "engineering_formula",
  purpose: "Performs approved deterministic engineering calculations (such as pump torque T = P * 9550 / N, pump power P = T * N / 9550, and pump speed N = P * 9550 / T). Never invents formulas.",
  description: "Executes approved deterministic engineering formulas from the catalog. Supports pump torque (T = P * 9550 / N), pump power (P = T * N / 9550), and pump speed (N = P * 9550 / T). Only executes registered formulas.",
  inputSchema: {
    type: "object",
    required: ["formula", "parameters"],
    properties: {
      formula: {
        type: "string",
        description: "The registered formula identifier or name (e.g. 'pump_torque', 'pump_power', 'pump_speed').",
      },
      parameters: {
        type: "object",
        description: "The numerical parameters required by the formula (e.g. { P: 22, N: 960 } for pump_torque).",
      },
    },
  },
  execute: async (input) => {
    try {
      const { formula, parameters } = input || {};
      const res = executeFormula(formula, parameters);
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

export default engineeringFormulaTool;
