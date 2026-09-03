/**
 * App
 *
 * Configures and exports the Express application instance.
 * - Applies middleware (JSON parsing, CORS)
 * - Mounts all API routes
 *
 * Kept separate from server.js so the app can be imported
 * and tested independently without starting the HTTP server.
 */

import express from "express";
import cors from "cors";
import "dotenv/config";

import chatRoutes from "./routes/chat.routes.js";
import { checkOllamaHealth } from "./services/ollama.service.js";

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

// CORS — allow the Vite dev server to communicate with this backend
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Parse incoming JSON bodies
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Lightweight health check. Also reports Ollama reachability.
 */
app.get("/api/health", async (_req, res) => {
  const ollama = await checkOllamaHealth();
  return res.json({
    status: "ok",
    message: "Local Chat backend is running",
    ollama,
  });
});

// Chat endpoints
app.use("/api/chat", chatRoutes);

// ─── 404 Fallback ─────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ success: false, error: "Route not found." });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("[app] Unhandled error:", err);
  res.status(500).json({ success: false, error: "Internal server error." });
});

export default app;
