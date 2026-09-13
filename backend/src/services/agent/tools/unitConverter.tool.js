/**
 * Deterministic Engineering Unit Converter Tool
 *
 * Performs exact, deterministic engineering unit conversions across standard
 * industrial dimensions: Pressure, Temperature, Length, Mass, Power, and Flow.
 *
 * GUARANTEES:
 * - Purely deterministic math (zero LLM calculation)
 * - Strict dimension validation (cannot convert pressure to length, etc.)
 * - Normalized alias resolution (e.g. '°C', 'C', 'celsius'; 'm3/h', 'm³/h')
 * - High-precision rounding to eliminate floating point artifacts
 */

// Normalized category mapping & base unit conversion factors
// Base units:
// Pressure: bar
// Temperature: custom formulas (C, F, K)
// Length: m
// Mass: kg
// Power: kW
// Flow: m3/h

const UNIT_ALIASES = {
  // Pressure (base: bar)
  bar: { category: "pressure", standard: "bar" },
  bars: { category: "pressure", standard: "bar" },
  psi: { category: "pressure", standard: "psi" },
  kpa: { category: "pressure", standard: "kPa" },
  mpa: { category: "pressure", standard: "MPa" },
  pa: { category: "pressure", standard: "Pa" },

  // Temperature
  c: { category: "temperature", standard: "°C" },
  "°c": { category: "temperature", standard: "°C" },
  celsius: { category: "temperature", standard: "°C" },
  degc: { category: "temperature", standard: "°C" },
  f: { category: "temperature", standard: "°F" },
  "°f": { category: "temperature", standard: "°F" },
  fahrenheit: { category: "temperature", standard: "°F" },
  degf: { category: "temperature", standard: "°F" },
  k: { category: "temperature", standard: "K" },
  kelvin: { category: "temperature", standard: "K" },

  // Length (base: m)
  mm: { category: "length", standard: "mm" },
  millimeter: { category: "length", standard: "mm" },
  millimeters: { category: "length", standard: "mm" },
  cm: { category: "length", standard: "cm" },
  centimeter: { category: "length", standard: "cm" },
  centimeters: { category: "length", standard: "cm" },
  m: { category: "length", standard: "m" },
  meter: { category: "length", standard: "m" },
  meters: { category: "length", standard: "m" },
  inch: { category: "length", standard: "inch" },
  inches: { category: "length", standard: "inch" },
  in: { category: "length", standard: "inch" },
  '"': { category: "length", standard: "inch" },
  ft: { category: "length", standard: "ft" },
  foot: { category: "length", standard: "ft" },
  feet: { category: "length", standard: "ft" },
  "'": { category: "length", standard: "ft" },

  // Mass (base: kg)
  g: { category: "mass", standard: "g" },
  gram: { category: "mass", standard: "g" },
  grams: { category: "mass", standard: "g" },
  kg: { category: "mass", standard: "kg" },
  kilogram: { category: "mass", standard: "kg" },
  kilograms: { category: "mass", standard: "kg" },

  // Power (base: kW)
  w: { category: "power", standard: "W" },
  watt: { category: "power", standard: "W" },
  watts: { category: "power", standard: "W" },
  kw: { category: "power", standard: "kW" },
  kilowatt: { category: "power", standard: "kW" },
  kilowatts: { category: "power", standard: "kW" },
  hp: { category: "power", standard: "HP" },
  horsepower: { category: "power", standard: "HP" },

  // Flow (base: m3/h)
  "l/min": { category: "flow", standard: "L/min" },
  lpm: { category: "flow", standard: "L/min" },
  "liter/min": { category: "flow", standard: "L/min" },
  "liters/min": { category: "flow", standard: "L/min" },
  "m3/h": { category: "flow", standard: "m³/h" },
  "m³/h": { category: "flow", standard: "m³/h" },
  "m^3/h": { category: "flow", standard: "m³/h" },
  "cum/h": { category: "flow", standard: "m³/h" },
  "cum/hr": { category: "flow", standard: "m³/h" },
};

// Factors to convert standard unit to base unit: value_in_base = value * factor
const TO_BASE_FACTORS = {
  // Pressure -> base: bar
  bar: 1,
  psi: 0.06894757293168361,
  kPa: 0.01,
  MPa: 10,
  Pa: 0.00001,

  // Length -> base: m
  m: 1,
  mm: 0.001,
  cm: 0.01,
  inch: 0.0254,
  ft: 0.3048,

  // Mass -> base: kg
  kg: 1,
  g: 0.001,

  // Power -> base: kW
  kW: 1,
  W: 0.001,
  HP: 0.745699872, // 1 mechanical HP = 745.699872 W

  // Flow -> base: m³/h
  // 1 m³/h = 1000 L / 60 min = 16.6666666667 L/min
  // 1 L/min = 0.06 m³/h
  "m³/h": 1,
  "L/min": 0.06,
};

/**
 * Clean and normalize unit string
 */
function normalizeUnit(unitStr) {
  if (typeof unitStr !== "string") return null;
  const clean = unitStr.trim().toLowerCase();
  return UNIT_ALIASES[clean] || null;
}

/**
 * Convert temperature deterministically
 */
function convertTemperature(val, fromUnit, toUnit) {
  let celsius;
  if (fromUnit === "°C") {
    celsius = val;
  } else if (fromUnit === "°F") {
    celsius = ((val - 32) * 5) / 9;
  } else if (fromUnit === "K") {
    celsius = val - 273.15;
  } else {
    throw new Error(`Unsupported temperature unit: ${fromUnit}`);
  }

  if (toUnit === "°C") {
    return celsius;
  }
  if (toUnit === "°F") {
    return (celsius * 9) / 5 + 32;
  }
  if (toUnit === "K") {
    return celsius + 273.15;
  }
  throw new Error(`Unsupported temperature target unit: ${toUnit}`);
}

/**
 * Perform unit conversion
 */
export function convertUnit(val, sourceUnitStr, targetUnitStr) {
  const numericVal = typeof val === "number" ? val : parseFloat(val);
  if (Number.isNaN(numericVal) || !Number.isFinite(numericVal)) {
    throw new Error(`Invalid numeric value: "${val}"`);
  }

  const sourceMeta = normalizeUnit(sourceUnitStr);
  if (!sourceMeta) {
    throw new Error(`Unsupported or unknown source unit: "${sourceUnitStr}". Supported units: bar, psi, kPa, MPa, °C, °F, K, mm, cm, m, inch, ft, g, kg, W, kW, HP, L/min, m³/h.`);
  }

  const targetMeta = normalizeUnit(targetUnitStr);
  if (!targetMeta) {
    throw new Error(`Unsupported or unknown target unit: "${targetUnitStr}". Supported units: bar, psi, kPa, MPa, °C, °F, K, mm, cm, m, inch, ft, g, kg, W, kW, HP, L/min, m³/h.`);
  }

  if (sourceMeta.category !== targetMeta.category) {
    throw new Error(`Incompatible units: Cannot convert ${sourceMeta.category} ("${sourceUnitStr}") to ${targetMeta.category} ("${targetUnitStr}").`);
  }

  const category = sourceMeta.category;
  const sourceStd = sourceMeta.standard;
  const targetStd = targetMeta.standard;

  let converted;

  if (category === "temperature") {
    converted = convertTemperature(numericVal, sourceStd, targetStd);
  } else {
    const toBase = TO_BASE_FACTORS[sourceStd];
    const fromBase = TO_BASE_FACTORS[targetStd];
    if (toBase === undefined || fromBase === undefined) {
      throw new Error(`Missing conversion factor for ${sourceStd} or ${targetStd}`);
    }
    const valInBase = numericVal * toBase;
    converted = valInBase / fromBase;
  }

  // Clean precision: round to 6 decimal places to prevent 5.4000000000000001
  const rounded = Math.round(converted * 1e6) / 1e6;

  return {
    inputValue: numericVal,
    sourceUnit: sourceStd,
    targetUnit: targetStd,
    convertedValue: rounded,
    formatted: `${numericVal} ${sourceStd} = ${rounded} ${targetStd}`,
  };
}

export const unitConverterTool = {
  name: "unit_converter",
  purpose: "Performs deterministic engineering unit conversions across standard industrial dimensions (pressure, temperature, length, mass, power, flow).",
  description: "Performs deterministic engineering unit conversions. Support: pressure (bar, psi, kPa, MPa), temperature (°C, °F, K), length (mm, cm, m, inch, ft), mass (g, kg), power (W, kW, HP), flow (L/min, m³/h).",
  inputSchema: {
    type: "object",
    required: ["value", "sourceUnit", "targetUnit"],
    properties: {
      value: {
        type: "number",
        description: "The numerical value to convert.",
      },
      sourceUnit: {
        type: "string",
        description: "The source engineering unit (e.g. 'bar', 'psi', '°C', 'kW', 'mm').",
      },
      targetUnit: {
        type: "string",
        description: "The desired target engineering unit (e.g. 'psi', 'kPa', '°F', 'HP', 'inch').",
      },
    },
  },
  execute: async (input) => {
    try {
      const { value, sourceUnit, targetUnit } = input || {};
      if (value === undefined || value === null) {
        return {
          success: false,
          error: "Missing required parameter 'value'.",
        };
      }
      if (!sourceUnit || typeof sourceUnit !== "string") {
        return {
          success: false,
          error: "Missing required parameter 'sourceUnit'.",
        };
      }
      if (!targetUnit || typeof targetUnit !== "string") {
        return {
          success: false,
          error: "Missing required parameter 'targetUnit'.",
        };
      }

      const res = convertUnit(value, sourceUnit, targetUnit);
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

export default unitConverterTool;
