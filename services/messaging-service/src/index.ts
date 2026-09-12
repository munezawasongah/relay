import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  MessageReadAck,
  MessageSendAck,
  ServerToClientEvents,
} from "@relay/shared";
import { verifySocketToken } from "./auth";
import { getConversationIdsForUser, insertMessage, isConversationMember, markMessageRead } from "./db";
import { decrementPresence, incrementPresence } from "./redis";

// Messaging Service — responsibility (architecture doc, section 3.1):
// WebSocket connections, message fan-out, presence, receipts.
// See section 3.2 for the full 1:1 message flow this service implements.

interface InterServerEvents {}
interface SocketData {
  userId: string;
  conversationRooms: string[];
}

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
  httpServer,
  { cors: { origin: "*" } }
);

const PORT = process.env.MESSAGING_SERVICE_PORT || 4002;

app.get("/health", (_req, res) => {
  res.json({ service: "messaging-service", status: "ok" });
});

function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

// Auth handshake: client connects with `{ auth: { token } }` (the JWT from
// POST /otp/verify). Anything else is rejected before "connection" fires.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    return next(new Error("missing_token"));
  }
  try {
    socket.data.userId = verifySocketToken(token);
    next();
  } catch {
    next(new Error("invalid_token"));
  }
});

io.on("connection", (socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>) => {
  const { userId } = socket.data;
  console.log(`[messaging-service] ${userId} connected (${socket.id})`);

  // IMPORTANT: every socket.on(...) below is registered synchronously, before
  // any `await`. socket.io delivers events strictly in arrival order over a
  // single connection, but if this handler awaited the room-joining setup
  // first, a client that emits immediately after "connect" could race ahead
  // of the listener registration — the event would arrive with no handler
  // attached and silently vanish (no error, no ack, nothing). Registering
  // listeners first, then doing async setup, closes that race.
  socket.data.conversationRooms = [];

  socket.on("message:send", async (payload, ack: (result: MessageSendAck) => void) => {
    try {
      if (!payload?.conversationId || !payload?.ciphertext || !payload?.clientMessageId) {
        return ack({ ok: false, error: "invalid_payload" });
      }
      const room = conversationRoom(payload.conversationId);

      // Trust room membership (populated from the DB at connect time) instead
      // of re-querying Postgres on every send; fall back to a DB check if the
      // socket hasn't joined the room (e.g. it was added to the conversation
      // after connecting).
      let isMember = socket.rooms.has(room);
      if (!isMember) {
        isMember = await isConversationMember(payload.conversationId, userId);
      }
      if (!isMember) {
        return ack({ ok: false, error: "not_a_member" });
      }

      // "Delivered" (MVP semantics, matching the single delivered_at column in
      // the schema): at least one other member of the conversation is
      // connected right now to receive it immediately.
      const socketsInRoom = await io.in(room).fetchSockets();
      const deliveredNow = socketsInRoom.some((s) => s.id !== socket.id);

      const message = await insertMessage({
        conversationId: payload.conversationId,
        senderId: userId,
        ciphertext: payload.ciphertext,
        mediaRef: payload.mediaRef,
        deliveredNow,
      });

      socket.to(room).emit("message:new", message);

      // TODO(Phase 1): if !deliveredNow, call push-service so offline
      // members get a push notification, and add a "fetch missed messages
      // since last-seen" REST endpoint for when they reconnect.

      ack({ ok: true, message, clientMessageId: payload.clientMessageId });
    } catch (err) {
      console.error("[messaging-service] message:send failed", err);
      ack({ ok: false, error: "internal_error" });
    }
  });

  socket.on("message:read", async (payload, ack: (result: MessageReadAck) => void) => {
    try {
      const result = await markMessageRead(payload?.messageId, userId);
      if (!result) {
        return ack({ ok: false, error: "not_found" });
      }
      io.to(userRoom(result.senderId)).emit("message:read:ack", {
        messageId: payload.messageId,
        readAt: result.readAt,
      });
      ack({ ok: true });
    } catch (err) {
      console.error("[messaging-service] message:read failed", err);
      ack({ ok: false, error: "internal_error" });
    }
  });

  socket.on("typing:start", (payload) => {
    const room = conversationRoom(payload?.conversationId);
    if (socket.rooms.has(room)) {
      socket.to(room).emit("typing:update", { conversationId: payload.conversationId, userId, isTyping: true });
    }
  });

  socket.on("typing:stop", (payload) => {
    const room = conversationRoom(payload?.conversationId);
    if (socket.rooms.has(room)) {
      socket.to(room).emit("typing:update", { conversationId: payload.conversationId, userId, isTyping: false });
    }
  });

  socket.on("disconnect", async () => {
    console.log(`[messaging-service] ${userId} disconnected (${socket.id})`);
    const remaining = await decrementPresence(userId);
    if (remaining === 0) {
      for (const room of socket.data.conversationRooms ?? []) {
        socket.to(room).emit("presence:update", { userId, online: false });
      }
    }
  });

  // Async setup, run after every listener above is already attached. Join a
  // per-user room (fans out to every device/tab this user has open) plus a
  // room per conversation they're in, so sending is just "emit to room".
  // Caveat: a conversation created after this socket connected won't be
  // joined until the client reconnects — acceptable for now since group
  // creation isn't implemented yet (Phase 1 scope is 1:1 + basic groups).
  // message:send falls back to a DB membership check (see above) so a send
  // that races ahead of this still works correctly either way.
  (async () => {
    socket.join(userRoom(userId));
    const conversationIds = await getConversationIdsForUser(userId);
    const conversationRooms = conversationIds.map(conversationRoom);
    for (const room of conversationRooms) {
      socket.join(room);
    }
    socket.data.conversationRooms = conversationRooms;

    const connectionCount = await incrementPresence(userId);
    if (connectionCount === 1) {
      for (const room of conversationRooms) {
        socket.to(room).emit("presence:update", { userId, online: true });
      }
    }
  })().catch((err) => {
    console.error(`[messaging-service] connection setup failed for ${userId}`, err);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[messaging-service] listening on :${PORT}`);
});
