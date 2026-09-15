// Core domain types shared between backend services and clients.
// Mirrors the data model sketch in the architecture doc (section 4.1).

export type Platform = "ios" | "android" | "web";

export interface User {
  id: string;
  phoneNumber: string;
  displayName: string;
  avatarUrl?: string;
  publicKey: string; // Signal Protocol identity public key
  createdAt: string;
}

export interface Device {
  id: string;
  userId: string;
  pushToken?: string;
  platform: Platform;
  lastSeen: string;
}

export type ConversationType = "direct" | "group";

export interface Conversation {
  id: string;
  type: ConversationType;
  name?: string; // group only
  createdAt: string;
}

export type ConversationRole = "member" | "admin";

export interface ConversationMember {
  conversationId: string;
  userId: string;
  role: ConversationRole;
  joinedAt: string;
}

export interface MediaObject {
  id: string;
  r2Key: string;
  mimeType: string;
  sizeBytes: number;
  thumbnailKey?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  ciphertext: string; // Signal Protocol encrypted payload, base64
  mediaRef?: string; // MediaObject id
  sentAt: string;
  deliveredAt?: string;
  readAt?: string;
}

export type CallType = "audio" | "video";
export type CallStatus = "ringing" | "active" | "ended" | "missed" | "declined";

export interface Call {
  id: string;
  conversationId: string;
  initiatorId: string;
  type: CallType;
  status: CallStatus;
  startedAt: string;
  endedAt?: string;
}

// --- WebSocket event contracts (Messaging Service) ---

export interface MessageSendPayload {
  conversationId: string;
  ciphertext: string;
  mediaRef?: string;
  clientMessageId: string;
}

export interface MessageSendAck {
  ok: boolean;
  error?: "not_a_member" | "invalid_payload" | "internal_error";
  message?: Message;
  clientMessageId?: string;
}

export interface MessageReadAck {
  ok: boolean;
  error?: "not_found" | "internal_error";
}

export interface ClientToServerEvents {
  "message:send": (payload: MessageSendPayload, ack: (result: MessageSendAck) => void) => void;
  "message:read": (payload: { messageId: string }, ack: (result: MessageReadAck) => void) => void;
  "typing:start": (payload: { conversationId: string }) => void;
  "typing:stop": (payload: { conversationId: string }) => void;
}

export interface ServerToClientEvents {
  "message:new": (message: Message) => void;
  "message:delivered": (payload: { messageId: string; deliveredAt: string }) => void;
  "message:read:ack": (payload: { messageId: string; readAt: string }) => void;
  "typing:update": (payload: { conversationId: string; userId: string; isTyping: boolean }) => void;
  "presence:update": (payload: { userId: string; online: boolean }) => void;
}

// --- Prekey publishing (Auth Service) ---
// Mirrors packages/crypto's IdentityKeys/OneTimeKeyBundle shapes (curve25519
// only — see packages/crypto/src/identity.ts for why ed25519 isn't needed
// here: session bootstrap only uses the curve25519 side).

export interface PublishIdentityKeyPayload {
  identityKey: string;
}

export interface PublishOneTimeKeysPayload {
  oneTimeKeys: Record<string, string>; // keyId -> base64 curve25519 public key
}

export interface PublishOneTimeKeysResponse {
  ok: true;
  inserted: number;
}

export interface OneTimeKeyCountResponse {
  count: number;
}

export interface KeyBundleResponse {
  identityKey: string;
  oneTimeKey: string;
}

export type KeyBundleError = "identity_key_not_published" | "no_one_time_keys_available";

// --- Conversations (REST — Messaging Service) ---
// The WebSocket contract above (ClientToServerEvents/ServerToClientEvents)
// covers the live path. These cover what a client needs before it can use
// that live path: which conversations it's in, and message history for one
// of them (both server-blind — ciphertext travels opaquely, same as live).

export interface PublicUser {
  id: string;
  displayName: string;
  avatarUrl?: string;
}

export interface ConversationSummary {
  id: string;
  type: ConversationType;
  name?: string;
  /** The other member, for a direct conversation. Absent for groups (Phase
   *  1 scope: this endpoint doesn't resolve full group rosters). */
  peer?: PublicUser;
  lastMessage?: {
    id: string;
    senderId: string;
    sentAt: string;
  };
}

export interface CreateDirectConversationPayload {
  peerId: string;
}

// --- Media (Media Service) ---
// Deliberately NOT end-to-end encrypted, unlike message content (see the
// architecture doc's feature table: E2E encryption is scoped to "1:1 and
// group message content", separately from "Media messages: ... with
// client-side compression before upload") — media-service can read image
// bytes because it has to, to generate thumbnails. See README for the
// implications and what a genuinely encrypted-media follow-up would need.

export interface MediaInfo {
  id: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
  thumbnailUrl?: string;
}

