/**
 * Safe Unit Converter Tool
 *
 * Deterministic physical unit conversion tool for common industrial units.
 * Supports:
 * - Pressure: bar, kPa, MPa, psi, atm, Pa
 * - Temperature: °C, °F, K
 * - Length: mm, cm, m, km, inch, ft
 * - Flow: m3/h, L/min, L/s, m3/s, gpm
 * - Mass: kg, g, tonne, lb
 * - Volume: L, m3, gallon, ml
 * - Energy: J, kJ, MJ, Wh, kWh, cal, kcal, btu
 * - Power: W, kW, MW, hp
 * - Speed: m/s, km/h, mph, ft/s, rpm, rps, rad/s
 * - Time: seconds, minutes, hours, days
 *
 * GUARANTEES:
 * - Deterministic mathematical conversions only
 * - Zero LLM invocations or external API dependencies
 * - High-precision arithmetic and standard engineering conversion factors
 */

/**
 * Normalizes unit alias to a canonical symbol.
 */
function normalizeUnit(rawUnit) {
  if (!rawUnit || typeof rawUnit !== "string") return "";
  let u = rawUnit.trim().toLowerCase();

  // Remove degree symbol and common punctuation
  u = u.replace(/[°º]/g, "").trim();

  // Pressure
  if (u === "bar" || u === "bars") return "bar";
  if (u === "kpa" || u === "kilopascal" || u === "kilopascals") return "kpa";
  if (u === "mpa" || u === "megapascal" || u === "megapascals") return "mpa";
  if (u === "psi" || u === "psia" || u === "psig" || u === "lb/in2" || u === "lbf/in2") return "psi";
  if (u === "atm" || u === "atmosphere" || u === "atmospheres") return "atm";
  if (u === "pa" || u === "pascal" || u === "pascals") return "pa";

  // Temperature
  if (u === "c" || u === "celsius" || u === "centigrade") return "c";
  if (u === "f" || u === "fahrenheit") return "f";
  if (u === "k" || u === "kelvin") return "k";

  // Length
  if (u === "mm" || u === "millimeter" || u === "millimeters" || u === "millimetre" || u === "millimetres") return "mm";
  if (u === "cm" || u === "centimeter" || u === "centimeters" || u === "centimetre" || u === "centimetres") return "cm";
  if (u === "m" || u === "meter" || u === "meters" || u === "metre" || u === "metres") return "m";
  if (u === "km" || u === "kilometer" || u === "kilometers" || u === "kilometre" || u === "kilometres") return "km";
  if (u === "inch" || u === "inches" || u === "in" || u === '"') return "inch";
  if (u === "ft" || u === "foot" || u === "feet" || u === "'") return "ft";

  // Flow
  if (u === "m3/h" || u === "m³/h" || u === "m3/hr" || u === "m^3/h" || u === "cum/hr") return "m3/h";
  if (u === "l/min" || u === "lpm" || u === "litres/min" || u === "liters/min") return "l/min";
  if (u === "l/s" || u === "lps" || u === "litres/s" || u === "liters/s") return "l/s";
  if (u === "m3/s" || u === "m³/s" || u === "m^3/s") return "m3/s";
  if (u === "gpm" || u === "gal/min" || u === "gallon/min") return "gpm";

  // Mass
  if (u === "kg" || u === "kilogram" || u === "kilograms" || u === "kilo") return "kg";
  if (u === "g" || u === "gram" || u === "grams") return "g";
  if (u === "tonne" || u === "tonnes" || u === "t" || u === "metric ton" || u === "ton") return "tonne";
  if (u === "lb" || u === "lbs" || u === "pound" || u === "pounds") return "lb";

  // Volume
  if (u === "l" || u === "liter" || u === "liters" || u === "litre" || u === "litres") return "l";
  if (u === "ml" || u === "milliliter" || u === "milliliters" || u === "millilitre" || u === "millilitres") return "ml";
  if (u === "m3" || u === "m³" || u === "m^3" || u === "cubic meter" || u === "cubic meters") return "m3";
  if (u === "gallon" || u === "gallons" || u === "gal") return "gallon";

  // Energy
  if (u === "j" || u === "joule" || u === "joules") return "j";
  if (u === "kj" || u === "kilojoule" || u === "kilojoules") return "kj";
  if (u === "mj" || u === "megajoule" || u === "megajoules") return "mj";
  if (u === "wh" || u === "watt-hour" || u === "watt-hours") return "wh";
  if (u === "kwh" || u === "kilowatt-hour" || u === "kilowatt-hours") return "kwh";
  if (u === "cal" || u === "calorie" || u === "calories") return "cal";
  if (u === "kcal" || u === "kilocalorie" || u === "kilocalories") return "kcal";
  if (u === "btu" || u === "btus") return "btu";

  // Power
  if (u === "w" || u === "watt" || u === "watts") return "w";
  if (u === "kw" || u === "kilowatt" || u === "kilowatts") return "kw";
  if (u === "mw" || u === "megawatt" || u === "megawatts") return "mw";
  if (u === "hp" || u === "horsepower") return "hp";

  // Speed
  if (u === "m/s" || u === "mps" || u === "meter/s" || u === "meters/second") return "m/s";
  if (u === "km/h" || u === "kph" || u === "km/hr" || u === "kilometer/hour") return "km/h";
  if (u === "mph" || u === "miles/hour" || u === "mile/hour") return "mph";
  if (u === "ft/s" || u === "fps" || u === "feet/second") return "ft/s";
  if (u === "rpm" || u === "rev/min" || u === "revolutions/minute") return "rpm";
  if (u === "rps" || u === "rev/s" || u === "revolutions/second") return "rps";
  if (u === "rad/s" || u === "rad/sec" || u === "radians/second") return "rad/s";

  // Time
  if (u === "s" || u === "sec" || u === "second" || u === "seconds") return "s";
  if (u === "min" || u === "minute" || u === "minutes" || u === "m") return "min";
  if (u === "h" || u === "hr" || u === "hrs" || u === "hour" || u === "hours") return "h";
  if (u === "d" || u === "day" || u === "days") return "d";

  return u;
}

/**
 * Standard unit definitions grouped by physical dimension.
 * For linear dimensions, factors are expressed relative to a base unit.
 */
const UNIT_DEFINITIONS = {
  pressure: {
    base: "pa",
    units: {
      pa: 1,
      kpa: 1e3,
      mpa: 1e6,
      bar: 1e5,
      psi: 6894.757293168,
      atm: 101325,
    },
    display: {
      pa: "Pa",
      kpa: "kPa",
      mpa: "MPa",
      bar: "bar",
      psi: "psi",
      atm: "atm",
    },
  },
  temperature: {
    type: "temperature",
    units: ["c", "f", "k"],
    display: {
      c: "°C",
      f: "°F",
      k: "K",
    },
  },
  length: {
    base: "m",
    units: {
      mm: 1e-3,
      cm: 1e-2,
      m: 1,
      km: 1e3,
      inch: 0.0254,
      ft: 0.3048,
    },
    display: {
      mm: "mm",
      cm: "cm",
      m: "m",
      km: "km",
      inch: "in",
      ft: "ft",
    },
  },
  flow: {
    base: "m3/s",
    units: {
      "m3/s": 1,
      "m3/h": 1 / 3600,
      "l/s": 1e-3,
      "l/min": 1e-3 / 60,
      gpm: 0.003785411784 / 60,
    },
    display: {
      "m3/s": "m³/s",
      "m3/h": "m³/h",
      "l/s": "L/s",
      "l/min": "L/min",
      gpm: "gpm",
    },
  },
  mass: {
    base: "kg",
    units: {
      g: 1e-3,
      kg: 1,
      tonne: 1e3,
      lb: 0.45359237,
    },
    display: {
      g: "g",
      kg: "kg",
      tonne: "tonne",
      lb: "lb",
    },
  },
  volume: {
    base: "l",
    units: {
      ml: 1e-3,
      l: 1,
      m3: 1e3,
      gallon: 3.785411784,
    },
    display: {
      ml: "mL",
      l: "L",
      m3: "m³",
      gallon: "gallon",
    },
  },
  energy: {
    base: "j",
    units: {
      j: 1,
      kj: 1e3,
      mj: 1e6,
      wh: 3600,
      kwh: 3.6e6,
      cal: 4.184,
      kcal: 4184,
      btu: 1055.056,
    },
    display: {
      j: "J",
      kj: "kJ",
      mj: "MJ",
      wh: "Wh",
      kwh: "kWh",
      cal: "cal",
      kcal: "kcal",
      btu: "BTU",
    },
  },
  power: {
    base: "w",
    units: {
      w: 1,
      kw: 1e3,
      mw: 1e6,
      hp: 745.6998715822702,
    },
    display: {
      w: "W",
      kw: "kW",
      mw: "MW",
      hp: "hp",
    },
  },
  speed: {
    base: "m/s",
    units: {
      "m/s": 1,
      "km/h": 1 / 3.6,
      mph: 0.44704,
      "ft/s": 0.3048,
    },
    display: {
      "m/s": "m/s",
      "km/h": "km/h",
      mph: "mph",
      "ft/s": "ft/s",
    },
  },
  rotational_speed: {
    base: "rpm",
    units: {
      rpm: 1,
      rps: 60,
      "rad/s": 60 / (2 * Math.PI),
    },
    display: {
      rpm: "rpm",
      rps: "rps",
      "rad/s": "rad/s",
    },
  },
  time: {
    base: "s",
    units: {
      s: 1,
      min: 60,
      h: 3600,
      d: 86400,
    },
    display: {
      s: "s",
      min: "min",
      h: "h",
      d: "d",
    },
  },
};

/**
 * Identify the physical category of a given unit symbol.
 */
function findUnitCategory(unit) {
  for (const [category, def] of Object.entries(UNIT_DEFINITIONS)) {
    if (def.type === "temperature") {
      if (def.units.includes(unit)) return category;
    } else if (def.units && Object.prototype.hasOwnProperty.call(def.units, unit)) {
      return category;
    }
  }
  return null;
}

/**
 * Converts temperature value between C, F, K.
 */
function convertTemperature(value, from, to) {
  // Convert from -> Kelvin
  let kelvin;
  if (from === "k") kelvin = value;
  else if (from === "c") kelvin = value + 273.15;
  else if (from === "f") kelvin = (value - 32) * (5 / 9) + 273.15;
  else throw new Error(`Unsupported source temperature unit: ${from}`);

  // Convert Kelvin -> to
  if (to === "k") return kelvin;
  if (to === "c") return kelvin - 273.15;
  if (to === "f") return (kelvin - 273.15) * (9 / 5) + 32;
  throw new Error(`Unsupported target temperature unit: ${to}`);
}

/**
 * Safely parses input object or flexible string expression into numeric value and source/target units.
 */
function parseConversionInput(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Input must be an object.");
  }

  let value = input.value;
  let fromUnit = input.fromUnit || input.from || input.sourceUnit;
  let toUnit = input.toUnit || input.to || input.targetUnit;

  // Handle case where query or expression is provided as string e.g. "5.4 bar to psi"
  const rawExpr = input.expression || input.query || input.task;
  if ((value === undefined || !fromUnit || !toUnit) && typeof rawExpr === "string") {
    const match = rawExpr.trim().match(/^(-?[\d.,]+)\s*([a-zA-Z°º/³^23]+)\s*(?:to|in|into|->)\s*([a-zA-Z°º/³^23]+)$/i);
    if (match) {
      value = parseFloat(match[1].replace(/,/g, ""));
      fromUnit = match[2];
      toUnit = match[3];
    }
  }

  // Coerce string numeric value if necessary
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    value = parseFloat(cleaned);
  }

  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`Invalid numerical value: "${input.value ?? value}". Must be a finite number.`);
  }

  if (!fromUnit || typeof fromUnit !== "string") {
    throw new Error("Source unit (fromUnit) is required.");
  }
  if (!toUnit || typeof toUnit !== "string") {
    throw new Error("Target unit (toUnit) is required.");
  }

  return {
    value,
    fromUnit: fromUnit.trim(),
    toUnit: toUnit.trim(),
  };
}

export const unitConverterTool = {
  name: "unit_converter",
  purpose:
    "Performs deterministic physical unit conversions across common industrial units (Pressure: bar, kPa, MPa, psi, atm; Temperature: °C, °F, K; Length: mm, cm, m, km, inch, ft; Flow: m3/h, L/min, L/s; Mass: kg, g, tonne, lb; Volume: L, m3, gallon; Energy: J, kJ, MJ, Wh, kWh; Power: W, kW, MW, hp; Speed: m/s, km/h, rpm; Time: s, min, h, d).",
  whenToUse:
    "Use whenever a task requires converting a measurement or physical quantity from one unit to another (e.g. bar to psi, kW to hp, °C to °F, m3/h to L/min). Mandatory: do not perform unit conversions mentally or directly in the LLM response.",
  whenNotToUse:
    "Do NOT use for pure arithmetic calculations without physical units (use 'calculator'). Do NOT use for general text transformation or document searches.",
  description:
    "Converts physical measurements from one unit to another. Handles pressure (bar, kPa, MPa, psi, atm), temperature (°C, °F, K), length (mm, cm, m, km, inch, ft), flow (m3/h, L/min, L/s, gpm), mass (kg, g, tonne, lb), volume (L, m3, gallon), energy (J, kJ, kWh), power (W, kW, MW, hp), speed (m/s, km/h, rpm), and time (seconds, minutes, hours). Use whenever unit conversion is required. Never convert units mentally.",
  inputSchema: {
    type: "object",
    required: ["value", "fromUnit", "toUnit"],
    properties: {
      value: {
        type: "number",
        description: "The numerical value to convert (e.g. 5.4, 100, 25.5).",
      },
      fromUnit: {
        type: "string",
        description: "The source unit symbol (e.g. 'bar', 'psi', 'kPa', 'C', 'F', 'm3/h', 'kW').",
      },
      toUnit: {
        type: "string",
        description: "The target unit symbol (e.g. 'psi', 'bar', 'MPa', 'K', 'L/min', 'hp').",
      },
    },
  },
  permissions: [],
  execute: async (input) => {
    try {
      const { value, fromUnit: rawFrom, toUnit: rawTo } = parseConversionInput(input);
      const normFrom = normalizeUnit(rawFrom);
      const normTo = normalizeUnit(rawTo);

      if (!normFrom) throw new Error(`Unrecognized source unit: "${rawFrom}"`);
      if (!normTo) throw new Error(`Unrecognized target unit: "${rawTo}"`);

      const catFrom = findUnitCategory(normFrom);
      const catTo = findUnitCategory(normTo);

      if (!catFrom) {
        throw new Error(`Unsupported source unit: "${rawFrom}" (normalized: "${normFrom}").`);
      }
      if (!catTo) {
        throw new Error(`Unsupported target unit: "${rawTo}" (normalized: "${normTo}").`);
      }
      if (catFrom !== catTo) {
        throw new Error(
          `Incompatible unit conversion: Cannot convert "${rawFrom}" (${catFrom}) to "${rawTo}" (${catTo}). Both units must measure the same physical dimension.`
        );
      }

      let result;
      const categoryDef = UNIT_DEFINITIONS[catFrom];

      if (categoryDef.type === "temperature") {
        result = convertTemperature(value, normFrom, normTo);
      } else {
        const factorFrom = categoryDef.units[normFrom];
        const factorTo = categoryDef.units[normTo];
        // Convert fromUnit to base unit, then base unit to toUnit
        const baseValue = value * factorFrom;
        result = baseValue / factorTo;
      }

      // Round to 6 decimal places if needed to avoid floating point anomalies (e.g. 0.00000000000004)
      const roundedResult = Math.abs(result) < 1e-9 ? 0 : Number(result.toFixed(6).replace(/\.?0+$/, ""));
      const displayTo = categoryDef.display?.[normTo] || normTo;
      const displayFrom = categoryDef.display?.[normFrom] || normFrom;

      const formatted = `${roundedResult} ${displayTo}`;

      return {
        success: true,
        value,
        fromUnit: rawFrom,
        normalizedFromUnit: normFrom,
        toUnit: rawTo,
        normalizedToUnit: normTo,
        result: roundedResult,
        exactResult: result,
        formatted,
        category: catFrom,
        conversionFormula: `${value} ${displayFrom} = ${formatted}`,
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
