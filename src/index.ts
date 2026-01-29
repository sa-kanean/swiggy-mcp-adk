import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { Runner, InMemorySessionService } from "@google/adk";
import { createValentineAgent, cleanupAgent } from "./agent/agent.js";
import { router } from "./server/routes.js";
import { authCallbackRouter } from "./server/routes.js";
import { setupWebSocket } from "./server/websocket.js";
import { corsMiddleware } from "./server/middleware.js";
import { registerOAuthClient } from "./auth/swiggy-oauth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || "3000", 10);
const APP_NAME = "swiggy-valentine";

async function main() {
  // Register OAuth client with Swiggy (non-blocking — warn if fails)
  registerOAuthClient().catch((err) => {
    console.warn("[Startup] OAuth client registration failed:", err.message);
  });

  // Create agent
  const agent = await createValentineAgent();
  console.log("[Agent] Swiggy Cupid agent created");

  // Create session service and runner
  const sessionService = new InMemorySessionService();
  const runner = new Runner({
    appName: APP_NAME,
    agent,
    sessionService,
  });
  console.log("[Runner] ADK Runner initialized");

  // Set up Express
  const app = express();
  app.use(express.json());
  app.use(corsMiddleware);

  // Auth callback at root level (redirect URI: http://localhost:3000/auth/callback)
  app.use("/auth", authCallbackRouter);

  // API routes
  app.use("/api", router);

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", agent: "swiggy_cupid", version: "1.0.0" });
  });

  // Serve static frontend
  app.use(express.static(path.join(__dirname, "public")));

  // SPA fallback — serve index.html for any non-API route
  app.get("*", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  // Create HTTP server and attach WebSocket
  const server = createServer(app);
  setupWebSocket(server, agent, sessionService, runner);

  // Start server
  server.listen(PORT, () => {
    console.log(`[Server] Swiggy Valentine Agent running on port ${PORT}`);
    console.log(`[Server] UI:        http://localhost:${PORT}`);
    console.log(`[Server] REST API:  http://localhost:${PORT}/api`);
    console.log(`[Server] WebSocket: ws://localhost:${PORT}/ws/:roomId`);
    console.log(`[Server] Auth CB:   http://localhost:${PORT}/auth/callback`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[Server] Shutting down...");
    await cleanupAgent();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[Server] Fatal error:", err);
  process.exit(1);
});
