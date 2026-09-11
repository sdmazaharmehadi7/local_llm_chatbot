/**
 * Tool Registry Service
 *
 * Central catalog of all Agent capabilities in the sovereign AI workbench.
 * Enforces strict whitelist validation:
 * - Only registered tools can be accessed or executed.
 * - Disallows arbitrary tool names or code execution.
 * - Validates tool input schemas prior to execution.
 */

class ToolRegistryService {
  constructor() {
    this.tools = new Map();
  }

  /**
   * Register a new tool in the catalog.
   *
   * @param {object} tool
   * @param {string} tool.name - Unique identifier (e.g. "calculator", "retrieve_information")
   * @param {string} tool.description - Human and agent readable explanation of capability
   * @param {object} tool.inputSchema - Input schema specification (required keys, property types, or validator)
   * @param {Array<string>} [tool.permissions=[]] - Required permission flags (e.g. ["read:docs"])
   * @param {Function} tool.execute - Execution implementation function
   */
  registerTool(tool) {
    if (!tool || typeof tool !== "object") {
      throw new Error("Tool definition must be a valid object.");
    }

    const { name, description, inputSchema, execute } = tool;

    if (!name || typeof name !== "string" || !/^[a-z0-9_]+$/.test(name)) {
      throw new Error(
        `Invalid tool name: "${name}". Tool name must be alphanumeric lowercase with underscores.`
      );
    }

    if (this.tools.has(name)) {
      throw new Error(`Tool "${name}" is already registered.`);
    }

    if (!description || typeof description !== "string") {
      throw new Error(`Tool "${name}" must provide a descriptive explanation.`);
    }

    if (typeof execute !== "function") {
      throw new Error(`Tool "${name}" must provide an execute function.`);
    }

    this.tools.set(name, {
      name,
      description,
      purpose: tool.purpose || description,
      whenToUse: tool.whenToUse || "",
      whenNotToUse: tool.whenNotToUse || "",
      inputSchema: inputSchema || {},
      permissions: Array.isArray(tool.permissions) ? tool.permissions : [],
      execute,
    });
  }

  /**
   * Retrieve a tool by name.
   * @param {string} name
   * @returns {object|null}
   */
  getTool(name) {
    return this.tools.get(name) || null;
  }

  /**
   * Get all registered tools (metadata only, omitting executable function).
   * @returns {Array<{name: string, description: string, purpose?: string, whenToUse?: string, whenNotToUse?: string, inputSchema: object, permissions: string[]}>}
   */
  getTools() {
    return Array.from(this.tools.values()).map(
      ({ name, description, purpose, whenToUse, whenNotToUse, inputSchema, permissions }) => ({
        name,
        description,
        purpose,
        whenToUse,
        whenNotToUse,
        inputSchema,
        permissions,
      })
    );
  }

  /**
   * Check if a tool is registered.
   * @param {string} name
   * @returns {boolean}
   */
  hasTool(name) {
    return this.tools.has(name);
  }

  /**
   * Unregister a tool (primarily used for unit testing).
   * @param {string} name
   * @returns {boolean}
   */
  unregisterTool(name) {
    return this.tools.delete(name);
  }

  /**
   * Clear all registered tools (useful for unit tests isolation).
   */
  clear() {
    this.tools.clear();
  }

  /**
   * Validate tool inputs against the tool's registered schema.
   *
   * @param {string} name
   * @param {object} input
   * @returns {{ valid: boolean, error?: string }}
   */
  validateToolInput(name, input) {
    const tool = this.getTool(name);
    if (!tool) {
      return { valid: false, error: `Tool "${name}" is not registered.` };
    }

    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return { valid: false, error: `Tool "${name}" requires an input object.` };
    }

    const { inputSchema } = tool;

    // 1. If custom validator is present on schema
    if (typeof inputSchema.validate === "function") {
      try {
        const customResult = inputSchema.validate(input);
        if (customResult && customResult.valid === false) {
          return { valid: false, error: customResult.error || "Input validation failed." };
        }
        if (customResult === false) {
          return { valid: false, error: "Input validation failed." };
        }
      } catch (err) {
        return { valid: false, error: err.message };
      }
    }

    // 2. Schema check: required fields
    if (Array.isArray(inputSchema.required)) {
      for (const reqKey of inputSchema.required) {
        if (input[reqKey] === undefined || input[reqKey] === null || input[reqKey] === "") {
          return {
            valid: false,
            error: `Missing required field "${reqKey}" for tool "${name}".`,
          };
        }
      }
    }

    // 3. Schema check: properties types
    if (inputSchema.properties && typeof inputSchema.properties === "object") {
      for (const [key, propDef] of Object.entries(inputSchema.properties)) {
        if (input[key] !== undefined && input[key] !== null) {
          const expectedType = propDef.type;
          if (expectedType) {
            const actualType = Array.isArray(input[key]) ? "array" : typeof input[key];
            if (actualType !== expectedType) {
              return {
                valid: false,
                error: `Field "${key}" must be of type ${expectedType}, received ${actualType}.`,
              };
            }
          }
        }
      }
    }

    return { valid: true };
  }
}

export const toolRegistry = new ToolRegistryService();
export default toolRegistry;
