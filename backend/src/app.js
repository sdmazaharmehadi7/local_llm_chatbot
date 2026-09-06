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
import foldersRoutes from "./routes/folders.routes.js";
import modelsRoutes from "./routes/models.routes.js";
import { checkOllamaHealth } from "./services/ollama.service.js";
import { isDbConnected } from "./db/index.js";

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

// CORS — allow the Vite dev server to communicate with this backend
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Parse incoming JSON bodies
app.use(express.json());

// ─── Auth Session Route ───────────────────────────────────────────────────────
app.get("/api/auth/session", (_req, res) => {
  return res.json({
    user: {
      id: "user-local-admin",
      username: "Admin",
      role: "admin",
      created_at: new Date().toISOString(),
    },
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Lightweight health check. Also reports Ollama reachability.
 */
app.get("/api/health", async (_req, res) => {
  const llmProvider = (process.env.LLM_PROVIDER || "ollama").toLowerCase();
  const embeddingProvider = (process.env.EMBEDDING_PROVIDER || "ollama").toLowerCase();
  const ollama = await checkOllamaHealth();
  const dbConnected = await isDbConnected();

  return res.json({
    status: "ok",
    message: "Local Chat backend is running",
    database: {
      type: "postgresql",
      provider: "neon",
      connected: dbConnected,
    },
    providers: {
      llm: llmProvider,
      embedding: embeddingProvider,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    },
    ollama,
  });
});

// Models management — discovery, status, switching (one model at a time in RAM)
app.use("/api/models", modelsRoutes);

// Legacy single-turn chat (kept for backend testing with curl)
app.use("/api/chat", chatRoutes);

// AI SDK v6 streaming completion & chat history persistence
// /api/chats/*
app.use("/api/chats", chatsRoutes);

// Folders organization
// /api/folders/*
app.use("/api/folders", foldersRoutes);

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
