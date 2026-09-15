import type {
  CallActionAck,
  CallEndReason,
  CallInviteAck,
  CallType,
  IceCandidateLike,
  IceServerConfig,
  IncomingCallPayload,
  SessionDescriptionLike,
} from "@relay/shared";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { MediaStream, MediaStreamTrack } from "react-native-webrtc";
import { useAuth } from "../auth/AuthContext";
import { navigate } from "../navigation/navigationRef";
import { connectCallSocket, type CallSocket } from "./callSocket";
import { createPeerConnection, getLocalStream } from "./peerConnection";

export type CallPhase = "idle" | "outgoing-ringing" | "incoming-ringing" | "connecting" | "active" | "ended";

export interface ActiveCallInfo {
  callId: string;
  conversationId: string;
  peerId: string;
  peerDisplayName: string;
  type: CallType;
  direction: "incoming" | "outgoing";
}

interface CallRuntimeState {
  phase: CallPhase;
  call: ActiveCallInfo | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  endReason: CallEndReason | null;
  isMuted: boolean;
  isCameraOff: boolean;
  error: string | null;
}

const initialRuntimeState: CallRuntimeState = {
  phase: "idle",
  call: null,
  localStream: null,
  remoteStream: null,
  endReason: null,
  isMuted: false,
  isCameraOff: false,
  error: null,
};

export type StartCallError =
  | "not_a_member"
  | "group_calls_not_supported"
  | "callee_unreachable"
  | "call_already_in_progress"
  | "internal_error"
  | "media_permission_denied"
  | "not_connected";

interface CallState extends CallRuntimeState {
  startCall: (params: { conversationId: string; peerId: string; peerDisplayName: string; type: CallType }) => Promise<StartCallError | null>;
  acceptCall: () => Promise<void>;
  declineCall: () => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMute: () => void;
  toggleCamera: () => void;
}

const CallContext = createContext<CallState | undefined>(undefined);

/** Owns the call-signaling socket connection AND the WebRTC peer
 *  connection for the lifetime of a signed-in session — sits above the
 *  navigator (see App.tsx) because an incoming call can land while the
 *  user is on any screen, not just a chat. Screens reach all of this via
 *  useCall(); CallScreen is the only screen that renders call UI, reached
 *  by calling navigate("Call") (see navigation/navigationRef.ts) rather
 *  than through a normal navigation prop, since this call can originate
 *  from outside any specific screen's component tree (an incoming call
 *  arriving while on the ChatList, say).
 *
 *  Signaling/WebRTC protocol, and why (see call-signaling-service's
 *  index.ts for the server side of the same story):
 *  - Caller: startCall() gets local media, emits call:invite, and on ok
 *    creates its RTCPeerConnection right away (using the iceServers the
 *    invite ack returned) — but does NOT create an offer yet. Creating
 *    media-negotiation state for a call nobody has agreed to yet is
 *    wasted work if it's declined.
 *  - Callee: call:incoming just shows ringing UI; no media, no peer
 *    connection, until the user actually taps Accept.
 *  - Once accepted (call:accepted on the caller's side), the CALLER
 *    creates the offer. The callee's accept flow gets its own media +
 *    peer connection going in parallel, so there's a real race between
 *    "callee's peer connection exists" and "call:offer arrives" — same
 *    for ICE candidates arriving before there's anywhere to put them.
 *    pendingOfferRef / pendingCandidatesRef below exist purely to absorb
 *    that race: buffer, then flush once setRemoteDescription resolves. */
export function CallProvider({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuth();

  const stateRef = useRef<CallRuntimeState>(initialRuntimeState);
  const [renderState, setRenderState] = useState<CallRuntimeState>(initialRuntimeState);
  const update = useCallback((patch: Partial<CallRuntimeState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    setRenderState(stateRef.current);
  }, []);

  const socketRef = useRef<CallSocket | null>(null);
  const pcRef = useRef<ReturnType<typeof createPeerConnection> | null>(null);
  const iceServersRef = useRef<IceServerConfig[]>([]);
  const pendingOfferRef = useRef<SessionDescriptionLike | null>(null);
  const pendingCandidatesRef = useRef<IceCandidateLike[]>([]);
  const hasRemoteDescriptionRef = useRef(false);
  const endTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const teardownMedia = useCallback(() => {
    stateRef.current.localStream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    pcRef.current?.close();
    pcRef.current = null;
    pendingOfferRef.current = null;
    pendingCandidatesRef.current = [];
    hasRemoteDescriptionRef.current = false;
    iceServersRef.current = [];
  }, []);

  const resetToIdle = useCallback(() => {
    teardownMedia();
    update({ ...initialRuntimeState });
  }, [teardownMedia, update]);

  const endLocally = useCallback(
    (reason: CallEndReason) => {
      update({ phase: "ended", endReason: reason, remoteStream: null });
      clearTimeout(endTimerRef.current);
      endTimerRef.current = setTimeout(resetToIdle, 2500);
    },
    [resetToIdle, update]
  );

  // --- Peer connection wiring, shared by both the caller and callee paths ---
  const setUpPeerConnection = useCallback((iceServers: IceServerConfig[]) => {
    const pc = createPeerConnection(iceServers);

    pc.addEventListener("icecandidate", (event) => {
      const call = stateRef.current.call;
      if (event.candidate && call) {
        socketRef.current?.emit("call:ice-candidate", { callId: call.callId, candidate: event.candidate.toJSON() });
      }
    });

    pc.addEventListener("track", (event) => {
      const [stream] = event.streams;
      if (stream) update({ remoteStream: stream });
    });

    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "connected") {
        update({ phase: "active" });
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        // A network-level failure the signaling layer wouldn't otherwise
        // catch (e.g. TURN unreachable and P2P also failed) — end the call
        // locally rather than leaving the UI stuck on "connecting".
        if (stateRef.current.phase !== "ended" && stateRef.current.phase !== "idle") {
          const call = stateRef.current.call;
          if (call) socketRef.current?.emit("call:hangup", { callId: call.callId }, () => {});
          endLocally("hangup");
        }
      }
    });

    pcRef.current = pc;
    return pc;
  }, [endLocally, update]);

  const flushPendingCandidates = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc) return;
    const candidates = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn("[calling] failed to add buffered ICE candidate", err);
      }
    }
  }, []);

  // The callee's one and only path from "received an offer" to "sent an
  // answer" — used both when the offer arrives after our peer connection
  // already exists (the common case) AND when acceptCall() finds one
  // already buffered in pendingOfferRef (the offer won the race and
  // arrived before getUserMedia/createPeerConnection finished). Exactly
  // one of those two call sites runs per call, never both, since the
  // second one always clears pendingOfferRef first.
  const answerOffer = useCallback(async (callId: string, description: SessionDescriptionLike) => {
    const pc = pcRef.current;
    if (!pc) return;
    try {
      await pc.setRemoteDescription(description);
      hasRemoteDescriptionRef.current = true;
      await flushPendingCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current?.emit("call:answer", { callId, description: { type: "answer", sdp: answer.sdp } });
    } catch (err) {
      console.error("[calling] failed to answer offer", err);
    }
  }, [flushPendingCandidates]);

  // --- Socket event handlers ---
  useEffect(() => {
    if (!token) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    const socket = connectCallSocket(token);
    socketRef.current = socket;

    socket.on("call:incoming", (payload: IncomingCallPayload) => {
      // No call-waiting in this MVP — a second incoming call while already
      // on one is simply not offered to the UI. The caller will see this
      // as call_already_in_progress if they're calling the same
      // conversation, or callee_unreachable style silence otherwise (their
      // own call-signaling connection is still up, just busy).
      if (stateRef.current.phase !== "idle") return;

      iceServersRef.current = payload.iceServers;
      update({
        phase: "incoming-ringing",
        call: {
          callId: payload.id,
          conversationId: payload.conversationId,
          peerId: payload.initiatorId,
          peerDisplayName: payload.callerDisplayName,
          type: payload.type,
          direction: "incoming",
        },
      });
      navigate("Call", undefined);
    });

    socket.on("call:accepted", async ({ iceServers }) => {
      const call = stateRef.current.call;
      if (!call || call.direction !== "outgoing") return;
      iceServersRef.current = iceServers;
      update({ phase: "connecting" });

      const pc = setUpPeerConnection(iceServers);
      stateRef.current.localStream?.getTracks().forEach((t: MediaStreamTrack) => pc.addTrack(t, stateRef.current.localStream!));

      try {
        const offer = await pc.createOffer({});
        await pc.setLocalDescription(offer);
        socketRef.current?.emit("call:offer", { callId: call.callId, description: { type: "offer", sdp: offer.sdp } });
      } catch (err) {
        console.error("[calling] failed to create/send offer", err);
        endLocally("hangup");
      }
    });

    socket.on("call:offer", async ({ description }) => {
      const callId = stateRef.current.call?.callId;
      if (pcRef.current && callId) {
        await answerOffer(callId, description);
      } else {
        // Arrived before our own peer connection exists yet (accept() is
        // still awaiting getUserMedia) — applied once it's created, by
        // acceptCall's own pendingOfferRef check below.
        pendingOfferRef.current = description;
      }
    });

    socket.on("call:answer", async ({ description }) => {
      if (!pcRef.current) return;
      try {
        await pcRef.current.setRemoteDescription(description);
        hasRemoteDescriptionRef.current = true;
        await flushPendingCandidates();
      } catch (err) {
        console.error("[calling] failed to apply answer", err);
      }
    });

    socket.on("call:ice-candidate", async ({ candidate }) => {
      if (pcRef.current && hasRemoteDescriptionRef.current) {
        try {
          await pcRef.current.addIceCandidate(candidate);
        } catch (err) {
          console.warn("[calling] failed to add ICE candidate", err);
        }
      } else {
        pendingCandidatesRef.current.push(candidate);
      }
    });

    socket.on("call:ended", ({ reason }) => {
      if (stateRef.current.call) {
        endLocally(reason);
      }
    });

    socket.on("connect_error", (err) => {
      console.warn("[calling] connect_error", err.message);
    });

    return () => {
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
    // Deliberately only [token] — everything else this closure needs is
    // read through stateRef/pcRef (always current), not captured by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, answerOffer, endLocally, flushPendingCandidates, setUpPeerConnection, update]);

  const startCall = useCallback(
    async ({
      conversationId,
      peerId,
      peerDisplayName,
      type,
    }: {
      conversationId: string;
      peerId: string;
      peerDisplayName: string;
      type: CallType;
    }): Promise<StartCallError | null> => {
      if (stateRef.current.phase !== "idle") return "call_already_in_progress";
      const socket = socketRef.current;
      if (!socket || !user) return "not_connected";

      let localStream: MediaStream;
      try {
        localStream = await getLocalStream(type);
      } catch (err) {
        console.warn("[calling] getUserMedia failed", err);
        return "media_permission_denied";
      }

      update({
        phase: "outgoing-ringing",
        call: { callId: "", conversationId, peerId, peerDisplayName, type, direction: "outgoing" },
        localStream,
      });
      navigate("Call", undefined);

      const ack: CallInviteAck = await new Promise((resolve) =>
        socket.emit("call:invite", { conversationId, type }, resolve)
      );
      if (!ack.ok || !ack.call) {
        localStream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
        resetToIdle();
        return ack.error ?? "internal_error";
      }

      update({ call: { ...stateRef.current.call!, callId: ack.call.id } });
      return null;
    },
    [resetToIdle, update, user]
  );

  const acceptCall = useCallback(async () => {
    const call = stateRef.current.call;
    const socket = socketRef.current;
    if (!call || !socket || call.direction !== "incoming") return;

    let localStream: MediaStream;
    try {
      localStream = await getLocalStream(call.type);
    } catch (err) {
      console.warn("[calling] getUserMedia failed on accept", err);
      update({ error: "Couldn't access your camera/microphone." });
      await declineCallInternal(socket, call.callId);
      resetToIdle();
      return;
    }

    update({ phase: "connecting", localStream });
    const pc = setUpPeerConnection(iceServersRef.current);
    localStream.getTracks().forEach((t: MediaStreamTrack) => pc.addTrack(t, localStream));

    const ack: CallActionAck = await new Promise((resolve) => socket.emit("call:accept", { callId: call.callId }, resolve));
    if (!ack.ok) {
      endLocally("hangup");
      return;
    }

    if (pendingOfferRef.current) {
      const offer = pendingOfferRef.current;
      pendingOfferRef.current = null;
      await answerOffer(call.callId, offer);
    }
    // If the offer hasn't arrived yet, the "call:offer" handler (in the
    // main socket effect above) will see pcRef.current already set by the
    // time it fires and call answerOffer itself.
  }, [answerOffer, endLocally, resetToIdle, setUpPeerConnection, update]);

  async function declineCallInternal(socket: CallSocket, callId: string) {
    await new Promise<CallActionAck>((resolve) => socket.emit("call:decline", { callId }, resolve));
  }

  const declineCall = useCallback(async () => {
    const call = stateRef.current.call;
    const socket = socketRef.current;
    if (!call || !socket) return;
    await declineCallInternal(socket, call.callId);
    resetToIdle();
  }, [resetToIdle]);

  const hangUp = useCallback(async () => {
    const call = stateRef.current.call;
    const socket = socketRef.current;
    if (!call || !socket) {
      resetToIdle();
      return;
    }
    if (!call.callId) {
      // Outgoing call that hasn't gotten a callId back from the invite ack
      // yet — nothing server-side to hang up on.
      resetToIdle();
      return;
    }
    const ack: CallActionAck = await new Promise((resolve) => socket.emit("call:hangup", { callId: call.callId }, resolve));
    const reason: CallEndReason = pcRef.current?.connectionState === "connected" ? "hangup" : "missed";
    endLocally(ack.ok ? reason : "hangup");
  }, [endLocally, resetToIdle]);

  const toggleMute = useCallback(() => {
    const stream = stateRef.current.localStream;
    if (!stream) return;
    const nextMuted = !stateRef.current.isMuted;
    stream.getAudioTracks().forEach((t: MediaStreamTrack) => (t.enabled = !nextMuted));
    update({ isMuted: nextMuted });
  }, [update]);

  const toggleCamera = useCallback(() => {
    const stream = stateRef.current.localStream;
    if (!stream) return;
    const nextOff = !stateRef.current.isCameraOff;
    stream.getVideoTracks().forEach((t: MediaStreamTrack) => (t.enabled = !nextOff));
    update({ isCameraOff: nextOff });
  }, [update]);

  const value: CallState = { ...renderState, startCall, acceptCall, declineCall, hangUp, toggleMute, toggleCamera };

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

export function useCall(): CallState {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within a CallProvider");
  return ctx;
}
