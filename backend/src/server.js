/**
 * Server Entry Point
 *
 * Loads environment variables, starts the HTTP server,
 * and handles graceful shutdown.
 *
 * Usage:
 *   node src/server.js        (production)
 *   node --watch src/server.js (development — built-in file watcher)
 */

import "dotenv/config";
import app from "./app.js";

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log("─────────────────────────────────────────────");
  console.log(`  Local Chat Backend`);
  console.log(`  Server  : http://localhost:${PORT}`);
  console.log(`  Health  : http://localhost:${PORT}/api/health`);
  console.log(`  Chat    : POST http://localhost:${PORT}/api/chat`);
  console.log(`  Ollama  : ${process.env.OLLAMA_BASE_URL || "http://localhost:11434"}`);
  console.log(`  Model   : ${process.env.OLLAMA_MODEL || "qwen3:8b"}`);
  console.log("─────────────────────────────────────────────");
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n[server] Received ${signal}. Shutting down gracefully…`);
  server.close(() => {
    console.log("[server] HTTP server closed.");
    process.exit(0);
  });

  // Force exit if server hasn't closed in 5 s
  setTimeout(() => {
    console.error("[server] Forced shutdown after timeout.");
    process.exit(1);
  }, 5000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Catch unhandled promise rejections so the process doesn't silently die
process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason);
});
