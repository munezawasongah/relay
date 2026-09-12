import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@relay/shared";

// Messaging Service — responsibility (architecture doc, section 3.1):
// WebSocket connections, message fan-out, presence, receipts.
// See section 3.2 for the full 1:1 message flow this service implements.

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: "*" },
});

const PORT = process.env.MESSAGING_SERVICE_PORT || 4002;

app.get("/health", (_req, res) => {
  res.json({ service: "messaging-service", status: "ok" });
});

io.on("connection", (socket) => {
  console.log(`[messaging-service] client connected: ${socket.id}`);

  // TODO(Phase 1): authenticate socket via JWT from auth-service
  // TODO(Phase 1): register connection in Redis for presence + routing
  // TODO(Phase 1): message:send -> persist/forward, ack delivery
  // TODO(Phase 1): message:read -> propagate read receipt
  // TODO(Phase 1): typing:start / typing:stop -> fan out to conversation members

  socket.on("disconnect", () => {
    console.log(`[messaging-service] client disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[messaging-service] listening on :${PORT}`);
});
