/**
 * Safe Calculator Tool
 *
 * Evaluates mathematical expressions using a secure, deterministic
 * tokenizer and recursive descent parser.
 *
 * SECURITY GUARANTEES:
 * - NO eval()
 * - NO Function() constructor
 * - NO VM / child_process / execution sandbox
 * - Disallows all letters/identifiers except a strictly whitelisted set of math functions
 * - Guards against division by zero, infinite recursion, and non-finite outputs
 */

const ALLOWED_FUNCTIONS = Object.freeze({
  sqrt: (args) => {
    if (args.length !== 1) throw new Error("sqrt requires 1 argument");
    if (args[0] < 0) throw new Error("sqrt of negative number is undefined in real numbers");
    return Math.sqrt(args[0]);
  },
  abs: (args) => {
    if (args.length !== 1) throw new Error("abs requires 1 argument");
    return Math.abs(args[0]);
  },
  round: (args) => {
    if (args.length !== 1) throw new Error("round requires 1 argument");
    return Math.round(args[0]);
  },
  floor: (args) => {
    if (args.length !== 1) throw new Error("floor requires 1 argument");
    return Math.floor(args[0]);
  },
  ceil: (args) => {
    if (args.length !== 1) throw new Error("ceil requires 1 argument");
    return Math.ceil(args[0]);
  },
  min: (args) => {
    if (args.length === 0) throw new Error("min requires at least 1 argument");
    return Math.min(...args);
  },
  max: (args) => {
    if (args.length === 0) throw new Error("max requires at least 1 argument");
    return Math.max(...args);
  },
  pow: (args) => {
    if (args.length !== 2) throw new Error("pow requires 2 arguments (base, exponent)");
    return Math.pow(args[0], args[1]);
  },
});

/**
 * Tokenize mathematical expression into safe symbols.
 * @param {string} expr
 * @returns {Array<{type: string, value: any}>}
 */
function tokenize(expr) {
  const tokens = [];
  let i = 0;
  const length = expr.length;

  while (i < length) {
    const ch = expr[i];

    // Skip whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    // Numbers (integers or floating point)
    if (/[0-9]/.test(ch) || (ch === "." && i + 1 < length && /[0-9]/.test(expr[i + 1]))) {
      let numStr = "";
      let hasDot = false;

      while (i < length && (/[0-9]/.test(expr[i]) || expr[i] === ".")) {
        if (expr[i] === ".") {
          if (hasDot) throw new Error(`Invalid number format near: "${numStr}."`);
          hasDot = true;
        }
        numStr += expr[i];
        i++;
      }
      tokens.push({ type: "NUMBER", value: parseFloat(numStr) });
      continue;
    }

    // Function identifiers (alphabetic only)
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (i < length && /[a-zA-Z0-9_]/.test(expr[i])) {
        ident += expr[i];
        i++;
      }
      ident = ident.toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(ALLOWED_FUNCTIONS, ident)) {
        throw new Error(`Unauthorized identifier or unsupported function: "${ident}"`);
      }
      tokens.push({ type: "FUNC", value: ident });
      continue;
    }

    // Operators and punctuation
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "%" || ch === "^") {
      // Check for '**' power syntax
      if (ch === "*" && i + 1 < length && expr[i + 1] === "*") {
        tokens.push({ type: "OP", value: "^" });
        i += 2;
        continue;
      }
      tokens.push({ type: "OP", value: ch });
      i++;
      continue;
    }

    if (ch === "(" || ch === ")" || ch === ",") {
      tokens.push({ type: ch, value: ch });
      i++;
      continue;
    }

    throw new Error(`Invalid character in mathematical expression: "${ch}"`);
  }

  return tokens;
}

/**
 * Recursive descent parser for evaluating token streams safely.
 */
class SafeExpressionParser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() {
    return this.tokens[this.pos] || null;
  }

  consume(expectedType, expectedValue) {
    const token = this.peek();
    if (!token) {
      throw new Error(`Unexpected end of expression, expected ${expectedType || expectedValue}`);
    }
    if (expectedType && token.type !== expectedType) {
      throw new Error(`Expected token type ${expectedType} but found ${token.type}`);
    }
    if (expectedValue !== undefined && token.value !== expectedValue) {
      throw new Error(`Expected "${expectedValue}" but found "${token.value}"`);
    }
    this.pos++;
    return token;
  }

  parse() {
    const result = this.parseExpression();
    if (this.pos < this.tokens.length) {
      throw new Error(`Unexpected token at position ${this.pos}: "${this.tokens[this.pos].value}"`);
    }
    return result;
  }

  // Expression: Term (('+' | '-') Term)*
  parseExpression() {
    let result = this.parseTerm();

    while (this.peek() && this.peek().type === "OP" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.consume("OP").value;
      const right = this.parseTerm();
      result = op === "+" ? result + right : result - right;
    }

    return result;
  }

  // Term: Power (('*' | '/' | '%') Power)*
  parseTerm() {
    let result = this.parsePower();

    while (
      this.peek() &&
      this.peek().type === "OP" &&
      (this.peek().value === "*" || this.peek().value === "/" || this.peek().value === "%")
    ) {
      const op = this.consume("OP").value;
      const right = this.parsePower();

      if (op === "*") {
        result = result * right;
      } else if (op === "/") {
        if (right === 0) {
          throw new Error("Division by zero is not allowed.");
        }
        result = result / right;
      } else if (op === "%") {
        if (right === 0) {
          throw new Error("Modulo by zero is not allowed.");
        }
        result = result % right;
      }
    }

    return result;
  }

  // Power: Factor ('^' Factor)* (right-associative)
  parsePower() {
    let base = this.parseFactor();

    if (this.peek() && this.peek().type === "OP" && this.peek().value === "^") {
      this.consume("OP", "^");
      const exponent = this.parsePower(); // right-associative
      base = Math.pow(base, exponent);
    }

    return base;
  }

  // Factor: ('+' | '-') Factor | NUMBER | '(' Expression ')' | FUNC '(' args ')'
  parseFactor() {
    const token = this.peek();
    if (!token) {
      throw new Error("Unexpected end of expression");
    }

    // Unary plus/minus
    if (token.type === "OP" && (token.value === "+" || token.value === "-")) {
      const op = this.consume("OP").value;
      const operand = this.parseFactor();
      return op === "-" ? -operand : operand;
    }

    if (token.type === "NUMBER") {
      return this.consume("NUMBER").value;
    }

    if (token.type === "FUNC") {
      const funcName = this.consume("FUNC").value;
      this.consume("(");
      const args = [];

      if (this.peek() && this.peek().type !== ")") {
        args.push(this.parseExpression());
        while (this.peek() && this.peek().type === ",") {
          this.consume(",");
          args.push(this.parseExpression());
        }
      }

      this.consume(")");
      const fn = ALLOWED_FUNCTIONS[funcName];
      return fn(args);
    }

    if (token.type === "(") {
      this.consume("(");
      const result = this.parseExpression();
      this.consume(")");
      return result;
    }

    throw new Error(`Unexpected token: "${token.value}"`);
  }
}

/**
 * Safely compute a mathematical expression string.
 *
 * @param {string} expression
 * @returns {number}
 */
export function evaluateSafeExpression(expression) {
  if (typeof expression !== "string") {
    throw new Error("Mathematical expression must be a string.");
  }

  const trimmed = expression.trim();
  if (!trimmed) {
    throw new Error("Expression cannot be empty.");
  }

  if (trimmed.length > 500) {
    throw new Error("Expression exceeds maximum allowed length (500 characters).");
  }

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) {
    throw new Error("No valid tokens found in expression.");
  }

  const parser = new SafeExpressionParser(tokens);
  const result = parser.parse();

  if (typeof result !== "number" || !Number.isFinite(result)) {
    throw new Error(`Expression resulted in non-finite or invalid number: ${result}`);
  }

  // Round tiny floating point inaccuracies (e.g. 0.1 + 0.2 = 0.30000000000000004)
  const precisionRounded = Math.round(result * 1e12) / 1e12;
  return precisionRounded;
}

export const calculatorTool = {
  name: "calculator",
  description:
    "Safely evaluates mathematical expressions and calculations without arbitrary code execution. Supports +, -, *, /, %, ^, parentheses, sqrt, abs, round, floor, ceil, min, max, pow.",
  inputSchema: {
    type: "object",
    required: ["expression"],
    properties: {
      expression: {
        type: "string",
        description: "The mathematical expression to evaluate (e.g. '25 * 0.17' or 'sqrt(144) + 10')",
      },
    },
  },
  permissions: [],
  execute: async (input) => {
    const { expression } = input || {};
    const value = evaluateSafeExpression(expression);
    return {
      expression,
      value,
      formatted: String(value),
    };
  },
};

export default calculatorTool;
