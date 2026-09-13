/**
 * Deterministic Engineering Formula Tool
 *
 * Implements 11 controlled engineering formulas with strict validation,
 * zero-division protection, and structured result formatting.
 * Controlled registry prevents arbitrary or invented formulas.
 */

export const SUPPORTED_FORMULAS = Object.freeze({
  PRESSURE_DIFFERENCE: "pressure_difference",
  PERCENTAGE_DIFFERENCE: "percentage_difference",
  PERCENTAGE_CHANGE: "percentage_change",
  EFFICIENCY: "efficiency",
  ELECTRICAL_POWER: "electrical_power",
  MECHANICAL_POWER: "mechanical_power",
  DENSITY: "density",
  FLOW_RATE: "flow_rate",
  VELOCITY: "velocity",
  KINETIC_ENERGY: "kinetic_energy",
  POTENTIAL_ENERGY: "potential_energy",
});

function getNum(obj, keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") {
      const n = Number(obj[k]);
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

export async function execute(input = {}) {
  const rawFormula = String(input.formula || "").trim().toLowerCase();
  const formulaKey = rawFormula.replace(/[\s\-]+/g, "_");
  const unit = input.unit || "";
  const params = input.parameters || input.inputs || input;

  if (!formulaKey) {
    return {
      tool: "engineering_formula",
      status: "error",
      error: "Missing required 'formula' parameter.",
      supportedFormulas: Object.values(SUPPORTED_FORMULAS),
    };
  }

  switch (formulaKey) {
    case "pressure_difference":
    case "delta_p":
    case "pressure_diff": {
      const discharge = getNum(params, ["discharge_pressure", "dischargePressure", "discharge", "p2", "p_discharge"]);
      const suction = getNum(params, ["suction_pressure", "suctionPressure", "suction", "p1", "p_suction"]);

      if (discharge === undefined || suction === undefined) {
        return {
          tool: "engineering_formula",
          formula: "pressure_difference",
          status: "error",
          error: "Formula 'pressure_difference' requires 'discharge_pressure' and 'suction_pressure'.",
        };
      }

      const diff = discharge - suction;
      const rounded = Number(diff.toFixed(6));
      return {
        tool: "engineering_formula",
        formula: "pressure_difference",
        inputs: { discharge_pressure: discharge, suction_pressure: suction, unit: unit || "bar" },
        result: rounded,
        unit: unit || "bar",
        formula_expression: "ΔP = discharge_pressure - suction_pressure",
        status: "success",
      };
    }

    case "percentage_difference": {
      const a = getNum(params, ["value_a", "valueA", "a", "val_a", "measured", "actual"]);
      const b = getNum(params, ["value_b", "valueB", "b", "val_b", "baseline", "expected", "limit", "reference"]);

      if (a === undefined || b === undefined) {
        return {
          tool: "engineering_formula",
          formula: "percentage_difference",
          status: "error",
          error: "Formula 'percentage_difference' requires 'value_a' and 'value_b' (baseline/reference).",
        };
      }

      if (b === 0) {
        return {
          tool: "engineering_formula",
          formula: "percentage_difference",
          status: "error",
          code: "DIVISION_BY_ZERO",
          retryable: false,
          error: "Division by zero: reference value_b cannot be 0.",
          message: "Percentage difference cannot be calculated because baseline reference value is zero.",
        };
      }

      const pct = (Math.abs(a - b) / Math.abs(b)) * 100;
      const rounded = Number(pct.toFixed(4));
      return {
        tool: "engineering_formula",
        formula: "percentage_difference",
        inputs: { value_a: a, value_b: b },
        result: rounded,
        unit: "%",
        formula_expression: "abs(A - B) / B * 100",
        status: "success",
      };
    }

    case "percentage_change": {
      const oldVal = getNum(params, ["old_value", "oldValue", "old", "initial", "previous"]);
      const newVal = getNum(params, ["new_value", "newValue", "new", "final", "current"]);

      if (oldVal === undefined || newVal === undefined) {
        return {
          tool: "engineering_formula",
          formula: "percentage_change",
          status: "error",
          error: "Formula 'percentage_change' requires 'old_value' and 'new_value'.",
        };
      }

      if (oldVal === 0) {
        return {
          tool: "engineering_formula",
          formula: "percentage_change",
          status: "error",
          code: "DIVISION_BY_ZERO",
          retryable: false,
          error: "Division by zero: old_value cannot be 0.",
          message: "Percentage change cannot be calculated because initial/old value is zero.",
        };
      }

      const change = ((newVal - oldVal) / oldVal) * 100;
      const rounded = Number(change.toFixed(4));
      return {
        tool: "engineering_formula",
        formula: "percentage_change",
        inputs: { old_value: oldVal, new_value: newVal },
        result: rounded,
        unit: "%",
        formula_expression: "(New - Old) / Old * 100",
        status: "success",
      };
    }

    case "efficiency": {
      const output = getNum(params, ["useful_output", "usefulOutput", "output", "power_out", "work_out"]);
      const totalInput = getNum(params, ["input", "total_input", "totalInput", "power_in", "work_in", "power"]);

      if (output === undefined || totalInput === undefined) {
        return {
          tool: "engineering_formula",
          formula: "efficiency",
          status: "error",
          error: "Formula 'efficiency' requires 'useful_output' and 'input'.",
        };
      }

      if (totalInput === 0) {
        return {
          tool: "engineering_formula",
          formula: "efficiency",
          status: "error",
          code: "DIVISION_BY_ZERO",
          retryable: false,
          error: "Division by zero: input cannot be 0.",
          message: "Efficiency cannot be calculated because input power is zero.",
        };
      }

      const eff = (output / totalInput) * 100;
      const rounded = Number(eff.toFixed(4));
      return {
        tool: "engineering_formula",
        formula: "efficiency",
        inputs: { useful_output: output, input: totalInput },
        result: rounded,
        unit: "%",
        formula_expression: "useful_output / input * 100",
        status: "success",
      };
    }

    case "electrical_power": {
      const v = getNum(params, ["voltage", "v", "volts"]);
      const i = getNum(params, ["current", "i", "amps", "amperage"]);

      if (v === undefined || i === undefined) {
        return {
          tool: "engineering_formula",
          formula: "electrical_power",
          status: "error",
          error: "Formula 'electrical_power' requires 'voltage' (V) and 'current' (I).",
        };
      }

      const power = v * i;
      const rounded = Number(power.toFixed(4));
      return {
        tool: "engineering_formula",
        formula: "electrical_power",
        inputs: { voltage: v, current: i },
        result: rounded,
        unit: unit || "W",
        formula_expression: "P = V × I",
        status: "success",
      };
    }

    case "mechanical_power": {
      const n = getNum(params, ["speed_rpm", "speedRpm", "speed", "n", "rpm"]);
      const t = getNum(params, ["torque_nm", "torqueNm", "torque", "t"]);

      if (n === undefined || t === undefined) {
        return {
          tool: "engineering_formula",
          formula: "mechanical_power",
          status: "error",
          error: "Formula 'mechanical_power' requires 'speed_rpm' (N) and 'torque_nm' (T).",
        };
      }

      const power = (2 * Math.PI * n * t) / 60;
      const rounded = Number(power.toFixed(4));
      return {
        tool: "engineering_formula",
        formula: "mechanical_power",
        inputs: { speed_rpm: n, torque_nm: t },
        result: rounded,
        unit: unit || "W",
        formula_expression: "P = 2πNT / 60",
        status: "success",
      };
    }

    case "density": {
      const m = getNum(params, ["mass", "m", "weight"]);
      const vol = getNum(params, ["volume", "v", "vol"]);

      if (m === undefined || vol === undefined) {
        return {
          tool: "engineering_formula",
          formula: "density",
          status: "error",
          error: "Formula 'density' requires 'mass' (m) and 'volume' (V).",
        };
      }

      if (vol === 0) {
        return {
          tool: "engineering_formula",
          formula: "density",
          status: "error",
          error: "Division by zero: volume cannot be 0.",
        };
      }

      const rho = m / vol;
      const rounded = Number(rho.toFixed(4));
      return {
        tool: "engineering_formula",
        formula: "density",
        inputs: { mass: m, volume: vol },
        result: rounded,
        unit: unit || "kg/m³",
        formula_expression: "ρ = m / V",
        status: "success",
      };
    }

    case "flow_rate": {
      const vol = getNum(params, ["volume", "v", "vol"]);
      const time = getNum(params, ["time", "t", "seconds", "duration"]);

      if (vol === undefined || time === undefined) {
        return {
          tool: "engineering_formula",
          formula: "flow_rate",
          status: "error",
          error: "Formula 'flow_rate' requires 'volume' (V) and 'time' (t).",
        };
      }

      if (time === 0) {
        return {
          tool: "engineering_formula",
          formula: "flow_rate",
          status: "error",
          error: "Division by zero: time cannot be 0.",
        };
      }

      const q = vol / time;
      const rounded = Number(q.toFixed(6));
      return {
        tool: "engineering_formula",
        formula: "flow_rate",
        inputs: { volume: vol, time },
        result: rounded,
        unit: unit || "m³/s",
        formula_expression: "Q = V / t",
        status: "success",
      };
    }

    case "velocity": {
      const q = getNum(params, ["flow_rate", "flowRate", "q", "flow"]);
      const a = getNum(params, ["area", "a", "cross_sectional_area"]);

      if (q === undefined || a === undefined) {
        return {
          tool: "engineering_formula",
          formula: "velocity",
          status: "error",
          error: "Formula 'velocity' requires 'flow_rate' (Q) and 'area' (A).",
        };
      }

      if (a === 0) {
        return {
          tool: "engineering_formula",
          formula: "velocity",
          status: "error",
          error: "Division by zero: area cannot be 0.",
        };
      }

      const v = q / a;
      const rounded = Number(v.toFixed(4));
      return {
        tool: "engineering_formula",
        formula: "velocity",
        inputs: { flow_rate: q, area: a },
        result: rounded,
        unit: unit || "m/s",
        formula_expression: "v = Q / A",
        status: "success",
      };
    }

    case "kinetic_energy": {
      const m = getNum(params, ["mass", "m"]);
      const v = getNum(params, ["velocity", "v", "speed"]);

      if (m === undefined || v === undefined) {
        return {
          tool: "engineering_formula",
          formula: "kinetic_energy",
          status: "error",
          error: "Formula 'kinetic_energy' requires 'mass' (m) and 'velocity' (v).",
        };
      }

      const ke = 0.5 * m * v * v;
      const rounded = Number(ke.toFixed(4));
      return {
        tool: "engineering_formula",
        formula: "kinetic_energy",
        inputs: { mass: m, velocity: v },
        result: rounded,
        unit: unit || "J",
        formula_expression: "KE = 1/2 × m × v²",
        status: "success",
      };
    }

    case "potential_energy": {
      const m = getNum(params, ["mass", "m"]);
      const h = getNum(params, ["height", "h", "elevation"]);
      const g = getNum(params, ["gravity", "g"]) ?? 9.81;

      if (m === undefined || h === undefined) {
        return {
          tool: "engineering_formula",
          formula: "potential_energy",
          status: "error",
          error: "Formula 'potential_energy' requires 'mass' (m) and 'height' (h).",
        };
      }

      const pe = m * g * h;
      const rounded = Number(pe.toFixed(4));
      return {
        tool: "engineering_formula",
        formula: "potential_energy",
        inputs: { mass: m, height: h, gravity: g },
        result: rounded,
        unit: unit || "J",
        formula_expression: "PE = mgh",
        status: "success",
      };
    }

    default:
      return {
        tool: "engineering_formula",
        status: "error",
        error: `Unsupported engineering formula: '${input.formula}'. Arbitrary formulas are prohibited.`,
        supportedFormulas: Object.values(SUPPORTED_FORMULAS),
      };
  }
}

export default {
  execute,
  SUPPORTED_FORMULAS,
};
