/**
 * Sovereign Agent Routes
 *
 * Exposes REST and SSE endpoints for the LangGraph-powered Sovereign Agent:
 *   POST   /api/agent/tasks          - Submit and execute an agent task (JSON or SSE)
 *   GET    /api/agent/tasks/:taskId  - Get task status
 *   GET    /api/agent/tools          - List registered agent capabilities
 */

import { Router } from "express";
import {
  createAgentTask,
  getAgentTask,
  listAgentTools,
} from "../controllers/agent.controller.js";

const router = Router();

// Primary Sovereign Agent endpoints (LangGraph)
router.post("/tasks", createAgentTask);
router.get("/tasks/:taskId", getAgentTask);
router.get("/tools", listAgentTools);

// Backwards-compatible aliases for existing callers
router.post("/framework/tasks", createAgentTask);
router.get("/framework/tasks/:taskId", getAgentTask);
router.get("/framework/tools", listAgentTools);

export default router;
