/**
 * Models Routes
 *
 * Defines HTTP routes for local model discovery, status, and switching.
 *
 * Routes:
 *   GET  /api/models          — list supported local chat models
 *   GET  /api/models/status   — inspect current active model and RAM state
 *   POST /api/models/select   — switch active model with RAM unloading/loading
 */

import { Router } from "express";
import {
  getModels,
  getModelStatus,
  selectModel,
} from "../controllers/models.controller.js";

const router = Router();

router.get("/", getModels);
router.get("/status", getModelStatus);
router.post("/select", selectModel);

export default router;
