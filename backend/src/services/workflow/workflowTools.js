/**
 * Sovereign Workflow Tools
 *
 * Re-uses the tool registry and tool executors from the simple agent.
 */

import {
  createAgentTools,
  getAgentToolsMetadata,
  CalculatorSchema,
  UnitConverterSchema,
  TextTransformSchema,
  RetrievalSchema,
  CodingSchema,
  ExecuteCodeSchema,
  VisionSchema,
} from "../agent/agentTools.js";

export const createWorkflowTools = createAgentTools;
export const getWorkflowToolsMetadata = getAgentToolsMetadata;

export {
  CalculatorSchema,
  UnitConverterSchema,
  TextTransformSchema,
  RetrievalSchema,
  CodingSchema,
  ExecuteCodeSchema,
  VisionSchema,
};

export default {
  createWorkflowTools,
  getWorkflowToolsMetadata,
  CalculatorSchema,
  UnitConverterSchema,
  TextTransformSchema,
  RetrievalSchema,
  CodingSchema,
  ExecuteCodeSchema,
  VisionSchema,
};
