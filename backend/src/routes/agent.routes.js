/**
 * Agent Routes
 *
 * Defines REST endpoints for the Agent foundation:
 *   POST   /api/agent/tasks          - Submit and execute an agent task
 *   GET    /api/agent/tasks/:taskId  - Get task execution state & audit steps
 *   GET    /api/agent/tools          - List registered agent capabilities
 */

import { Router } from "express";
import {
  createAgentTask,
  getAgentTask,
  listAgentTools,
} from "../controllers/agent.controller.js";
import {
  createFrameworkAgentTask,
  getFrameworkAgentTask,
  listFrameworkAgentTools,
} from "../controllers/frameworkAgent.controller.js";

const router = Router();

// Custom Agent Foundation routes
router.post("/tasks", createAgentTask);
router.get("/tasks/:taskId", getAgentTask);
router.get("/tools", listAgentTools);

// Experimental Framework (LangGraph) routes
router.post("/framework/tasks", createFrameworkAgentTask);
router.get("/framework/tasks/:taskId", getFrameworkAgentTask);
router.get("/framework/tools", listFrameworkAgentTools);

export default router;

