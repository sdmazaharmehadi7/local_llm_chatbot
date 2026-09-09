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

const router = Router();

router.post("/tasks", createAgentTask);
router.get("/tasks/:taskId", getAgentTask);
router.get("/tools", listAgentTools);

export default router;
