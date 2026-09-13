/**
 * Deterministic Unit Conversion Tool
 *
 * Implements exact conversions across 7 engineering categories:
 * - Pressure (Pa, kPa, MPa, bar, psi)
 * - Temperature (°C, °F, K)
 * - Length (mm, cm, m, km, inch, ft)
 * - Mass (g, kg, tonne, lb)
 * - Flow (L/s, L/min, m³/s, m³/h)
 * - Energy (J, kJ, MJ, Wh, kWh)
 * - Power (W, kW, MW, hp)
 *
 * Enforces category validation: incompatible unit conversions are rejected.
 */

// Normalization alias mapping
function normalizeUnit(unitStr) {
  const u = String(unitStr || "").trim().toLowerCase();
  // Pressure
  if (u === "pa" || u === "pascal" || u === "pascals") return { unit: "pa", category: "pressure" };
  if (u === "kpa" || u === "kilopascal") return { unit: "kpa", category: "pressure" };
  if (u === "mpa" || u === "megapascal") return { unit: "mpa", category: "pressure" };
  if (u === "bar" || u === "bars") return { unit: "bar", category: "pressure" };
  if (u === "psi" || u === "pounds per square inch") return { unit: "psi", category: "pressure" };

  // Temperature
  if (u === "°c" || u === "c" || u === "celsius" || u === "degc" || u === "deg c") return { unit: "c", category: "temperature" };
  if (u === "°f" || u === "f" || u === "fahrenheit" || u === "degf" || u === "deg f") return { unit: "f", category: "temperature" };
  if (u === "k" || u === "kelvin") return { unit: "k", category: "temperature" };

  // Length
  if (u === "mm" || u === "millimeter" || u === "millimeters") return { unit: "mm", category: "length" };
  if (u === "cm" || u === "centimeter" || u === "centimeters") return { unit: "cm", category: "length" };
  if (u === "m" || u === "meter" || u === "meters" || u === "metre") return { unit: "m", category: "length" };
  if (u === "km" || u === "kilometer" || u === "kilometers") return { unit: "km", category: "length" };
  if (u === "inch" || u === "inches" || u === "in") return { unit: "inch", category: "length" };
  if (u === "ft" || u === "feet" || u === "foot") return { unit: "ft", category: "length" };

  // Mass
  if (u === "g" || u === "gram" || u === "grams") return { unit: "g", category: "mass" };
  if (u === "kg" || u === "kilogram" || u === "kilograms") return { unit: "kg", category: "mass" };
  if (u === "tonne" || u === "tonnes" || u === "t" || u === "metric ton") return { unit: "tonne", category: "mass" };
  if (u === "lb" || u === "lbs" || u === "pound" || u === "pounds") return { unit: "lb", category: "mass" };

  // Flow
  if (u === "l/s" || u === "lps" || u === "liters/sec" || u === "litres/sec") return { unit: "l/s", category: "flow" };
  if (u === "l/min" || u === "lpm" || u === "liters/min" || u === "litres/min") return { unit: "l/min", category: "flow" };
  if (u === "m³/s" || u === "m3/s" || u === "m^3/s" || u === "cubic meters per second") return { unit: "m3/s", category: "flow" };
  if (u === "m³/h" || u === "m3/h" || u === "m^3/h" || u === "cubic meters per hour") return { unit: "m3/h", category: "flow" };

  // Energy
  if (u === "j" || u === "joule" || u === "joules") return { unit: "j", category: "energy" };
  if (u === "kj" || u === "kilojoule" || u === "kilojoules") return { unit: "kj", category: "energy" };
  if (u === "mj" || u === "megajoule" || u === "megajoules") return { unit: "mj", category: "energy" };
  if (u === "wh" || u === "watt-hour" || u === "watt hour") return { unit: "wh", category: "energy" };
  if (u === "kwh" || u === "kilowatt-hour" || u === "kilowatt hour") return { unit: "kwh", category: "energy" };

  // Power
  if (u === "w" || u === "watt" || u === "watts") return { unit: "w", category: "power" };
  if (u === "kw" || u === "kilowatt" || u === "kilowatts") return { unit: "kw", category: "power" };
  if (u === "mw" || u === "megawatt" || u === "megawatts") return { unit: "mw", category: "power" };
  if (u === "hp" || u === "horsepower") return { unit: "hp", category: "power" };

  return { unit: u, category: "unknown" };
}

// Factor to base unit (Pa, m, kg, m3/s, J, W)
const TO_BASE_FACTORS = {
  // Pressure (Base: Pa)
  pa: 1,
  kpa: 1000,
  mpa: 1000000,
  bar: 100000,
  psi: 6894.757293,

  // Length (Base: m)
  mm: 0.001,
  cm: 0.01,
  m: 1,
  km: 1000,
  inch: 0.0254,
  ft: 0.3048,

  // Mass (Base: kg)
  g: 0.001,
  kg: 1,
  tonne: 1000,
  lb: 0.45359237,

  // Flow (Base: m³/s)
  "l/s": 0.001,
  "l/min": 0.001 / 60,
  "m3/s": 1,
  "m3/h": 1 / 3600,

  // Energy (Base: J)
  j: 1,
  kj: 1000,
  mj: 1000000,
  wh: 3600,
  kwh: 3600000,

  // Power (Base: W)
  w: 1,
  kw: 1000,
  mw: 1000000,
  hp: 745.699872,
};

function convertTemperature(value, from, to) {
  let inCelsius;
  if (from === "c") inCelsius = value;
  else if (from === "f") inCelsius = (value - 32) * (5 / 9);
  else if (from === "k") inCelsius = value - 273.15;

  if (to === "c") return inCelsius;
  if (to === "f") return (inCelsius * 9) / 5 + 32;
  if (to === "k") return inCelsius + 273.15;
  return inCelsius;
}

export async function execute(input = {}) {
  const value = Number(input.value !== undefined ? input.value : input.amount);
  const rawFrom = input.from_unit || input.fromUnit || input.from;
  const rawTo = input.to_unit || input.toUnit || input.to;

  if (Number.isNaN(value) || value === undefined) {
    return {
      tool: "unit_conversion",
      status: "error",
      code: "INVALID_ARGUMENT_TYPE",
      field: "value",
      expected: "number",
      received: typeof input.value,
      retryable: true,
      error: "Missing or invalid numeric 'value' to convert.",
      message: "Please provide a valid numeric 'value' to convert.",
    };
  }

  if (!rawFrom || !rawTo) {
    return {
      tool: "unit_conversion",
      status: "error",
      code: "INVALID_ARGUMENT_TYPE",
      retryable: true,
      error: "Both 'from_unit' and 'to_unit' parameters are required.",
      message: "Both 'from_unit' and 'to_unit' parameters are required.",
    };
  }

  const fromInfo = normalizeUnit(rawFrom);
  const toInfo = normalizeUnit(rawTo);

  if (fromInfo.category === "unknown") {
    return {
      tool: "unit_conversion",
      status: "error",
      code: "UNRECOGNIZED_UNIT",
      unit: rawFrom,
      retryable: false,
      error: `Unsupported or unrecognized unit: '${rawFrom}'.`,
      message: `Unsupported or unrecognized unit: '${rawFrom}'.`,
    };
  }

  if (toInfo.category === "unknown") {
    return {
      tool: "unit_conversion",
      status: "error",
      code: "UNRECOGNIZED_UNIT",
      unit: rawTo,
      retryable: false,
      error: `Unsupported or unrecognized unit: '${rawTo}'.`,
      message: `Unsupported or unrecognized unit: '${rawTo}'.`,
    };
  }

  if (fromInfo.category !== toInfo.category) {
    return {
      tool: "unit_conversion",
      status: "error",
      code: "INCOMPATIBLE_UNITS",
      from_category: fromInfo.category,
      to_category: toInfo.category,
      from_unit: rawFrom,
      to_unit: rawTo,
      retryable: false,
      error: `Incompatible units: cannot convert from ${fromInfo.category} (${rawFrom}) to ${toInfo.category} (${rawTo}).`,
      message: `${rawFrom} is a unit of ${fromInfo.category} and ${rawTo} is a unit of ${toInfo.category}. They are physically incompatible without additional physical parameters.`,
    };
  }

  let convertedValue;
  if (fromInfo.category === "temperature") {
    convertedValue = convertTemperature(value, fromInfo.unit, toInfo.unit);
  } else {
    const toBase = TO_BASE_FACTORS[fromInfo.unit];
    const fromBase = TO_BASE_FACTORS[toInfo.unit];
    const baseValue = value * toBase;
    convertedValue = baseValue / fromBase;
  }

  const roundedResult = Number(convertedValue.toFixed(6));

  return {
    tool: "unit_conversion",
    category: fromInfo.category,
    value,
    from_unit: rawFrom,
    to_unit: rawTo,
    result: roundedResult,
    conversion_factor: fromInfo.category !== "temperature" ? Number((TO_BASE_FACTORS[fromInfo.unit] / TO_BASE_FACTORS[toInfo.unit]).toFixed(8)) : undefined,
    status: "success",
  };
}

export default {
  execute,
  normalizeUnit,
};
