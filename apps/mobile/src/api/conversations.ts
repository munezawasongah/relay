import type { ConversationSummary, Message } from "@relay/shared";
import { MESSAGING_BASE_URL } from "../config";
import { ApiError } from "./client";

// Talks to messaging-service's REST endpoints (services/messaging-service/
// src/routes/conversations.ts) — a separate base URL from auth-service, so
// this doesn't go through api/client.ts's apiRequest (which is hardcoded to
// API_BASE_URL). Same request/error shape, just pointed elsewhere.

async function messagingRequest<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown; token: string }
): Promise<T> {
  const res = await fetch(`${MESSAGING_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.token}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as T;
}

export function fetchConversations(token: string): Promise<{ conversations: ConversationSummary[] }> {
  return messagingRequest("/conversations", { token });
}

export function fetchMessages(
  token: string,
  conversationId: string,
  before?: string
): Promise<{ messages: Message[] }> {
  const query = before ? `?before=${encodeURIComponent(before)}` : "";
  return messagingRequest(`/conversations/${conversationId}/messages${query}`, { token });
}

export function createDirectConversation(
  token: string,
  peerId: string
): Promise<{ conversationId: string }> {
  return messagingRequest("/conversations/direct", { method: "POST", token, body: { peerId } });
}
