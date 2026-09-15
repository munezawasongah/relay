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
import {
  getConversationIdsForUser,
  getOtherMemberIds,
  getUserDisplayName,
  insertMessage,
  isConversationMember,
  markMessageRead,
} from "./db";
import { notifyOfflinePush } from "./push";
import { conversationsRouter } from "./routes/conversations";
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

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ service: "messaging-service", status: "ok" });
});

app.use(conversationsRouter);

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
      const otherSocketsInRoom = socketsInRoom.filter((s) => s.id !== socket.id);
      const deliveredNow = otherSocketsInRoom.length > 0;
      // Which specific *users* are online right now (not just "someone
      // other than this socket") — a device's own second tab/device
      // shouldn't count as "the recipient is online" for push purposes,
      // and this also generalizes correctly once groups exist (today's
      // deliveredNow flag doesn't distinguish "peer online" from "some
      // other member online", which happens to be the same thing for a
      // 2-person conversation).
      const connectedOtherUserIds = new Set(otherSocketsInRoom.map((s) => s.data.userId));

      const message = await insertMessage({
        conversationId: payload.conversationId,
        senderId: userId,
        ciphertext: payload.ciphertext,
        mediaRef: payload.mediaRef,
        deliveredNow,
      });

      socket.to(room).emit("message:new", message);

      ack({ ok: true, message, clientMessageId: payload.clientMessageId });

      // Offline-recipient push notifications (architecture doc section 3.2:
      // "if offline, persists to PostgreSQL and triggers a push
      // notification"). Fire-and-forget, and deliberately AFTER the ack
      // above — a slow push-service call or DB lookup here should never
      // delay the sender's own send confirmation, and a push failure here
      // should never look like the message failed to send (it already
      // didn't fail; it's persisted and fanned out to whoever IS online).
      (async () => {
        const otherMemberIds = await getOtherMemberIds(payload.conversationId, userId);
        const offlineRecipientIds = otherMemberIds.filter((id) => !connectedOtherUserIds.has(id));
        if (offlineRecipientIds.length === 0) return;

        const senderDisplayName = await getUserDisplayName(userId);
        await Promise.all(
          offlineRecipientIds.map((recipientId) =>
            notifyOfflinePush({
              userId: recipientId,
              senderDisplayName,
              conversationId: payload.conversationId,
            })
          )
        );
      })().catch((err) => {
        console.error("[messaging-service] offline push notification failed", err);
      });
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
