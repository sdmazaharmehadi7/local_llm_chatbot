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
import modelsRoutes from "./routes/models.routes.js";
import authRoutes from "./routes/auth.routes.js";
import filesRoutes from "./routes/files.routes.js";
import knowledgeBaseRoutes from "./routes/knowledgeBase.routes.js";
import authMiddleware from "./middleware/auth.middleware.js";
import { checkOllamaHealth } from "./services/ollama.service.js";

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

// CORS — allow the Vite dev server to communicate with this backend
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-User-Id", "X-Vercel-AI-UI-Message-Stream"],
  })
);

// Parse incoming JSON bodies
app.use(express.json());

// Scopes req.userId and req.user safely
app.use(authMiddleware);

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

// Auth session and management
app.use("/api/auth", authRoutes);

// Models management — discovery, status, switching (one model at a time in RAM)
app.use("/api/models", modelsRoutes);

// Legacy single-turn chat (kept for backend testing with curl)
app.use("/api/chat", chatRoutes);

// File upload & attachment management
app.use("/api/files", filesRoutes);

// Knowledge Base document management & RAG
app.use("/api/knowledge-base", knowledgeBaseRoutes);

// AI SDK v6 streaming completion — consumed by useChatStream.js / @ai-sdk/react
// POST /api/chats/:id/completion
app.use("/api/chats", chatsRoutes);

// Auxiliary endpoints to prevent 404s in frontend
app.get("/api/memory/status", (_req, res) => {
  res.json({ success: true, enabled: false, globalEnabled: false });
});

app.get("/api/memory", (_req, res) => {
  res.json({ success: true, memories: [] });
});

app.get("/api/folders", (_req, res) => {
  res.json({ success: true, folders: [] });
});

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
