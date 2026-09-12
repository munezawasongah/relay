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
