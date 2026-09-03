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
import chatsRoutes from "./routes/chats.routes.js";
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

/**
 * GET /api/models
 * Returns available models for the frontend model selector
 */
app.get("/api/models", (_req, res) => {
  const modelName = process.env.OLLAMA_MODEL || "qwen3:8b";
  return res.json({
    models: [
      {
        id: "ollama-qwen3",
        model_id: modelName,
        name: "Qwen 3 8B",
        display_name: "Qwen 3 (8B Local)",
        provider: "ollama",
        provider_id: "ollama",
        type: "text",
        enabled: true,
        is_default: true,
        context_window: 40960,
        metadata: {
          supports_tools: true,
          description: "Local Qwen 3 8B model via Ollama with reasoning support",
        },
      },
    ],
  });
});

// Legacy single-turn chat (kept for backend testing with curl)
app.use("/api/chat", chatRoutes);

// AI SDK v6 streaming completion — consumed by useChatStream.js / @ai-sdk/react
// POST /api/chats/:id/completion
app.use("/api/chats", chatsRoutes);

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
