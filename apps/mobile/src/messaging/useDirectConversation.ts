import type { EncryptedDirectMessage } from "@relay/crypto";
import type { Message, MessageSendAck } from "@relay/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchKeyBundle } from "../api/keys";
import { useAuth } from "../auth/AuthContext";
import { getRelayCrypto } from "../crypto/bootstrap";
import { fetchMessages } from "../api/conversations";
import { useMessaging } from "./MessagingContext";
import { cacheMessage, loadCachedMessages } from "./messageCache";

export interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  sentAt: string;
  readAt?: string;
  /** A media-service object id (see api/media.ts) — media itself is NOT
   *  end-to-end encrypted (see @relay/shared's MediaInfo doc comment), only
   *  the caption in `text` is. */
  mediaRef?: string;
  /** Optimistically added, not yet acked by the server. */
  pending?: boolean;
  /** Either the send failed, or (history only) this message's plaintext
   *  isn't recoverable — see messageCache.ts for why that happens for a
   *  device's own older sent messages. */
  unavailable?: boolean;
}

function randomLocalId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Encrypts for `peerId`, transparently fetching and using that peer's
 *  prekey bundle the first time there's no existing session — see
 *  RelayCrypto.encryptToUser's own doc comment for when that bundle is
 *  actually needed vs. ignored (an existing session ignores it). */
async function encryptForPeer(
  peerId: string,
  text: string,
  token: string
): Promise<EncryptedDirectMessage> {
  const crypto = await getRelayCrypto();
  try {
    return await crypto.encryptToUser(peerId, text);
  } catch (err) {
    const noSession = err instanceof Error && err.message.includes("no key bundle supplied");
    if (!noSession) throw err;

    const bundle = await fetchKeyBundle(token, peerId);
    return await crypto.encryptToUser(peerId, text, {
      identityKey: bundle.identityKey,
      oneTimeKey: bundle.oneTimeKey,
    });
  }
}

function toChatMessage(
  m: { id: string; senderId: string; sentAt: string; readAt?: string; mediaRef?: string },
  text: string,
  extra?: Partial<ChatMessage>
): ChatMessage {
  return { id: m.id, senderId: m.senderId, sentAt: m.sentAt, readAt: m.readAt, mediaRef: m.mediaRef, text, ...extra };
}

/** Backs a single 1:1 chat screen: loads history (decrypting whatever
 *  hasn't already been decrypted — see messageCache.ts for why that
 *  distinction matters), listens for live messages over the shared socket,
 *  and exposes sendText(). Group conversations aren't supported here —
 *  Megolm session creation/key-distribution is real additional complexity
 *  deliberately left for when group chat UI itself gets built. */
export function useDirectConversation(conversationId: string, peerId: string) {
  const { token, user } = useAuth();
  const { socket } = useMessaging();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [peerTyping, setPeerTyping] = useState(false);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout>>();

  // History load — see messageCache.ts: a message already in the cache
  // must never be passed to decryptFromUser again.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!token || !user) return;
      setIsLoadingHistory(true);

      const [cache, { messages: history }, crypto] = await Promise.all([
        loadCachedMessages(conversationId),
        fetchMessages(token, conversationId),
        getRelayCrypto(),
      ]);

      const resolved: ChatMessage[] = [];
      const toMarkRead: string[] = [];

      for (const m of history) {
        const isOwn = m.senderId === user.id;

        if (cache[m.id] !== undefined) {
          resolved.push(toChatMessage(m, cache[m.id]));
        } else if (isOwn) {
          // Can't be decrypted — see messageCache.ts. Only reachable when
          // this message was never cached at send time (e.g. sent from a
          // since-reinstalled copy of this app).
          resolved.push(toChatMessage(m, "You sent a message", { unavailable: true }));
        } else {
          try {
            const encrypted: EncryptedDirectMessage = JSON.parse(m.ciphertext);
            const text = await crypto.decryptFromUser(peerId, encrypted);
            await cacheMessage(conversationId, m.id, text);
            resolved.push(toChatMessage(m, text));
            if (!m.readAt) toMarkRead.push(m.id);
          } catch (err) {
            console.warn("[messaging] failed to decrypt history message", m.id, err);
            resolved.push(toChatMessage(m, "Couldn't decrypt this message", { unavailable: true }));
          }
        }
      }

      if (cancelled) return;
      setMessages(resolved);
      setIsLoadingHistory(false);

      for (const messageId of toMarkRead) {
        socket?.emit("message:read", { messageId }, () => {});
      }
    })();

    return () => {
      cancelled = true;
    };
    // socket is intentionally omitted: marking-as-read is best-effort and
    // shouldn't re-run the whole history load if the socket reconnects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, peerId, token, user]);

  // Live receive.
  useEffect(() => {
    if (!socket) return;
    const activeSocket = socket; // narrowed capture — see below, this closure runs across an await

    async function onNew(message: Message) {
      if (message.conversationId !== conversationId) return;

      const cache = await loadCachedMessages(conversationId);
      let text = cache[message.id];
      if (text === undefined) {
        try {
          const crypto = await getRelayCrypto();
          const encrypted: EncryptedDirectMessage = JSON.parse(message.ciphertext);
          text = await crypto.decryptFromUser(peerId, encrypted);
          await cacheMessage(conversationId, message.id, text);
        } catch (err) {
          console.warn("[messaging] failed to decrypt incoming message", message.id, err);
          text = "Couldn't decrypt this message";
        }
      }

      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, toChatMessage(message, text)]));
      activeSocket.emit("message:read", { messageId: message.id }, () => {});
    }

    function onTyping(payload: { conversationId: string; userId: string; isTyping: boolean }) {
      if (payload.conversationId === conversationId && payload.userId === peerId) {
        setPeerTyping(payload.isTyping);
      }
    }

    activeSocket.on("message:new", onNew);
    activeSocket.on("typing:update", onTyping);
    return () => {
      activeSocket.off("message:new", onNew);
      activeSocket.off("typing:update", onTyping);
    };
  }, [socket, conversationId, peerId]);

  const sendText = useCallback(
    async (text: string, mediaRef?: string) => {
      if (!token || !user || !socket) return;
      const trimmed = text.trim();
      if (!trimmed && !mediaRef) return; // nothing to send

      const localId = randomLocalId();
      const nowIso = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        { id: localId, senderId: user.id, text: trimmed, mediaRef, sentAt: nowIso, pending: true },
      ]);

      try {
        // A media-only message still needs *some* ciphertext (the DB column
        // is NOT NULL) — encrypting an empty string is fine for Olm, it's
        // just zero-length plaintext.
        const encrypted = await encryptForPeer(peerId, trimmed, token);
        const ciphertext = JSON.stringify(encrypted);

        socket.emit(
          "message:send",
          { conversationId, ciphertext, clientMessageId: localId, mediaRef },
          async (ack: MessageSendAck) => {
            if (!ack.ok || !ack.message) {
              setMessages((prev) => prev.map((m) => (m.id === localId ? { ...m, pending: false, unavailable: true } : m)));
              return;
            }
            await cacheMessage(conversationId, ack.message.id, trimmed);
            setMessages((prev) =>
              prev.map((m) => (m.id === localId ? toChatMessage(ack.message!, trimmed) : m))
            );
          }
        );
      } catch (err) {
        console.error("[messaging] send failed", err);
        setMessages((prev) => prev.map((m) => (m.id === localId ? { ...m, pending: false, unavailable: true } : m)));
      }
    },
    [token, user, socket, peerId, conversationId]
  );

  const notifyTyping = useCallback(
    (isTyping: boolean) => {
      if (!socket) return;
      clearTimeout(typingStopTimer.current);
      socket.emit(isTyping ? "typing:start" : "typing:stop", { conversationId });
      if (isTyping) {
        typingStopTimer.current = setTimeout(() => {
          socket.emit("typing:stop", { conversationId });
        }, 3000);
      }
    },
    [socket, conversationId]
  );

  return { messages, isLoadingHistory, peerTyping, sendText, notifyTyping };
}
