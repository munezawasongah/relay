import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import type {
  Call,
  CallActionAck,
  CallEndReason,
  CallInviteAck,
  CallStatus,
  ClientToCallServerEvents,
  ServerToCallClientEvents,
} from "@relay/shared";
import { verifySocketToken } from "./auth";
import {
  createCall,
  getCall,
  getConversationInfoForCaller,
  getInProgressCall,
  getInProgressCallForUser,
  getUserDisplayName,
  transitionCall,
} from "./db";
import { getIceServers } from "./iceServers";

// Call Signaling Service — responsibility (architecture doc, section 3.1 / 3.3):
// Call setup/teardown, SDP offer/answer exchange, ICE candidate relay for 1:1
// calls. Deliberately 1:1-only for now — group calls need LiveKit room
// provisioning (livekit-server-sdk is already a dependency, unused so far),
// a separate slice of work from this one.
//
// "Call notifications" (VoIP push to wake a fully-closed app for an
// incoming call) is its own bullet in the doc's Phase 2 feature table,
// distinct from "1:1 voice/video calls" — deliberately not built here.
// That's why call:invite below rejects outright with "callee_unreachable"
// rather than ringing into the void: without VoIP push, there is nothing
// that can wake a callee whose app isn't already open and connected to
// this socket.

interface InterServerEvents {}
interface SocketData {
  userId: string;
}

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToCallServerEvents, ServerToCallClientEvents, InterServerEvents, SocketData>(
  httpServer,
  { cors: { origin: "*" } }
);

const PORT = process.env.CALL_SIGNALING_PORT || 4004;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ service: "call-signaling-service", status: "ok" });
});

function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** Transitions a call and, if that succeeds, tells whichever participant
 *  *isn't* `actingUserId` that it's over. Returns the updated Call, or
 *  null if the transition's status guard didn't hold (caller treats that
 *  as "invalid_state" / logs and moves on, depending on context). */
async function endCallAndNotify(
  call: Call,
  actingUserId: string,
  fromStatuses: CallStatus[],
  toStatus: CallStatus,
  reason: CallEndReason
): Promise<Call | null> {
  const updated = await transitionCall(call.id, fromStatuses, toStatus, true);
  if (!updated) return null;

  const info = await getConversationInfoForCaller(call.conversationId, actingUserId);
  if (info?.otherMemberId) {
    io.to(userRoom(info.otherMemberId)).emit("call:ended", { callId: call.id, reason });
  }
  return updated;
}

// Auth handshake — identical contract to messaging-service's: client
// connects with `{ auth: { token } }`, the JWT from POST /otp/verify.
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

io.on("connection", (socket: Socket<ClientToCallServerEvents, ServerToCallClientEvents, InterServerEvents, SocketData>) => {
  const { userId } = socket.data;
  console.log(`[call-signaling-service] ${userId} connected (${socket.id})`);
  socket.join(userRoom(userId));

  socket.on("call:invite", async (payload, ack: (result: CallInviteAck) => void) => {
    try {
      if (!payload?.conversationId || !payload?.type) {
        return ack({ ok: false, error: "internal_error" });
      }

      const info = await getConversationInfoForCaller(payload.conversationId, userId);
      if (!info) {
        return ack({ ok: false, error: "not_a_member" });
      }
      if (info.type !== "direct" || !info.otherMemberId) {
        return ack({ ok: false, error: "group_calls_not_supported" });
      }

      const existing = await getInProgressCall(payload.conversationId);
      if (existing) {
        return ack({ ok: false, error: "call_already_in_progress" });
      }

      // Can we even reach the callee? With no VoIP push (see file comment
      // above), "connected to this socket right now" is the only signal
      // there is — anything else would ring forever with nothing on the
      // other end to answer it.
      const calleeRoom = userRoom(info.otherMemberId);
      const calleeSockets = await io.in(calleeRoom).fetchSockets();
      if (calleeSockets.length === 0) {
        return ack({ ok: false, error: "callee_unreachable" });
      }

      const call = await createCall({
        conversationId: payload.conversationId,
        initiatorId: userId,
        type: payload.type,
      });
      const iceServers = getIceServers();
      const callerDisplayName = await getUserDisplayName(userId);

      io.to(calleeRoom).emit("call:incoming", { ...call, callerDisplayName, iceServers });
      ack({ ok: true, call, iceServers });
    } catch (err) {
      console.error("[call-signaling-service] call:invite failed", err);
      ack({ ok: false, error: "internal_error" });
    }
  });

  socket.on("call:accept", async (payload, ack: (result: CallActionAck) => void) => {
    try {
      const call = await getCall(payload?.callId);
      if (!call) return ack({ ok: false, error: "not_found" });
      if (call.initiatorId === userId) return ack({ ok: false, error: "not_a_participant" });

      const info = await getConversationInfoForCaller(call.conversationId, userId);
      if (!info) return ack({ ok: false, error: "not_a_participant" });

      const updated = await transitionCall(call.id, ["ringing"], "active", false);
      if (!updated) return ack({ ok: false, error: "invalid_state" });

      io.to(userRoom(call.initiatorId)).emit("call:accepted", { callId: call.id, iceServers: getIceServers() });
      ack({ ok: true });
    } catch (err) {
      console.error("[call-signaling-service] call:accept failed", err);
      ack({ ok: false, error: "internal_error" });
    }
  });

  socket.on("call:decline", async (payload, ack: (result: CallActionAck) => void) => {
    try {
      const call = await getCall(payload?.callId);
      if (!call) return ack({ ok: false, error: "not_found" });
      if (call.initiatorId === userId) return ack({ ok: false, error: "not_a_participant" });

      const updated = await endCallAndNotify(call, userId, ["ringing"], "declined", "declined");
      if (!updated) return ack({ ok: false, error: "invalid_state" });
      ack({ ok: true });
    } catch (err) {
      console.error("[call-signaling-service] call:decline failed", err);
      ack({ ok: false, error: "internal_error" });
    }
  });

  socket.on("call:hangup", async (payload, ack: (result: CallActionAck) => void) => {
    try {
      const call = await getCall(payload?.callId);
      if (!call) return ack({ ok: false, error: "not_found" });

      const info = await getConversationInfoForCaller(call.conversationId, userId);
      if (!info) return ack({ ok: false, error: "not_a_participant" });

      // Either party can hang up, from either state: "missed" if nobody
      // ever answered, "hangup" (proper) if the call was actually active.
      const reason: CallEndReason = call.status === "active" ? "hangup" : "missed";
      const toStatus: CallStatus = call.status === "active" ? "ended" : "missed";
      const updated = await endCallAndNotify(call, userId, ["ringing", "active"], toStatus, reason);
      if (!updated) return ack({ ok: false, error: "invalid_state" });
      ack({ ok: true });
    } catch (err) {
      console.error("[call-signaling-service] call:hangup failed", err);
      ack({ ok: false, error: "internal_error" });
    }
  });

  // Plain relays: WebRTC negotiation content is opaque to this server (SDP
  // and ICE candidates are addresses/codecs, not message content — nothing
  // here needs E2E encryption the way chat text does), so all this does is
  // find the other participant and forward. No ack — offer/answer/ICE are
  // fire-and-forget by nature, retried by the WebRTC layer itself if lost.
  async function relayToOtherParticipant(callId: string, event: "call:offer" | "call:answer" | "call:ice-candidate", payload: unknown) {
    const call = await getCall(callId);
    if (!call) return;
    const info = await getConversationInfoForCaller(call.conversationId, userId);
    if (info?.otherMemberId) {
      io.to(userRoom(info.otherMemberId)).emit(event, payload as never);
    }
  }

  socket.on("call:offer", (payload) => {
    if (payload?.callId) relayToOtherParticipant(payload.callId, "call:offer", payload).catch((err) => console.error("[call-signaling-service] call:offer relay failed", err));
  });
  socket.on("call:answer", (payload) => {
    if (payload?.callId) relayToOtherParticipant(payload.callId, "call:answer", payload).catch((err) => console.error("[call-signaling-service] call:answer relay failed", err));
  });
  socket.on("call:ice-candidate", (payload) => {
    if (payload?.callId) relayToOtherParticipant(payload.callId, "call:ice-candidate", payload).catch((err) => console.error("[call-signaling-service] call:ice-candidate relay failed", err));
  });

  socket.on("disconnect", async () => {
    console.log(`[call-signaling-service] ${userId} disconnected (${socket.id})`);
    try {
      // Only act if this was the user's LAST connected socket — a second
      // device/tab dropping shouldn't end a call the first one is still on.
      const remaining = await io.in(userRoom(userId)).fetchSockets();
      if (remaining.length > 0) return;

      const call = await getInProgressCallForUser(userId);
      if (!call) return;

      const reason: CallEndReason = call.status === "active" ? "hangup" : "missed";
      const toStatus: CallStatus = call.status === "active" ? "ended" : "missed";
      await endCallAndNotify(call, userId, ["ringing", "active"], toStatus, reason);
    } catch (err) {
      console.error(`[call-signaling-service] disconnect cleanup failed for ${userId}`, err);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`[call-signaling-service] listening on :${PORT}`);
});
