/**
 * Sovereign Workflow Routes (6 Industrial Workflows)
 *
 * Exposes REST and SSE endpoints for the 6-Workflow Agent:
 *   POST   /workflow                 - Submit and execute a workflow task (JSON or SSE)
 *   POST   /workflow/tasks           - Alias for workflow execution
 *   GET    /workflow/tasks/:taskId   - Get workflow task status
 *   GET    /workflow/tools           - List registered workflow capabilities
 */

import { Router } from "express";
import {
  createWorkflowTask,
  getWorkflowTask,
  listWorkflowTools,
} from "../controllers/workflow.controller.js";

const router = Router();

// Primary 6-Workflow Agent endpoints
router.post("/", createWorkflowTask);
router.post("/tasks", createWorkflowTask);
router.get("/tasks/:taskId", getWorkflowTask);
router.get("/tools", listWorkflowTools);

export default router;
