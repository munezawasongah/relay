import { Router } from "express";
import { z } from "zod";
import type { ConversationSummary } from "@relay/shared";
import {
  findOrCreateDirectConversation,
  getMessagesForConversation,
  isConversationMember,
  listConversationsForUser,
} from "../db";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth";

// REST half of the Messaging Service (architecture doc section 3.1) — the
// socket.io server in index.ts is the live path; this is what a client
// calls before it can use that live path at all: which conversations it's
// in, and history for one of them. Both server-blind, same as the
// WebSocket side: message content only ever travels as ciphertext.

export const conversationsRouter = Router();

conversationsRouter.get("/conversations", requireAuth, async (req: AuthedRequest, res) => {
  const rows = await listConversationsForUser(req.userId!);
  const conversations: ConversationSummary[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    name: row.name ?? undefined,
    peer: row.peer_id
      ? {
          id: row.peer_id,
          displayName: row.peer_display_name ?? "",
          avatarUrl: row.peer_avatar_url ?? undefined,
        }
      : undefined,
    lastMessage: row.last_message_id
      ? {
          id: row.last_message_id,
          senderId: row.last_message_sender_id!,
          sentAt: row.last_message_sent_at!,
        }
      : undefined,
  }));
  res.json({ conversations });
});

const messagesQuerySchema = z.object({
  before: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

conversationsRouter.get(
  "/conversations/:conversationId/messages",
  requireAuth,
  async (req: AuthedRequest, res) => {
    const parsed = messagesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request" });
    }

    const isMember = await isConversationMember(req.params.conversationId, req.userId!);
    if (!isMember) {
      return res.status(403).json({ error: "not_a_member" });
    }

    const messages = await getMessagesForConversation(
      req.params.conversationId,
      parsed.data.limit ?? 50,
      parsed.data.before
    );
    res.json({ messages });
  }
);

const createDirectSchema = z.object({
  peerId: z.string().uuid(),
});

conversationsRouter.post("/conversations/direct", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createDirectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_request" });
  }
  if (parsed.data.peerId === req.userId) {
    return res.status(400).json({ error: "cannot_message_self" });
  }

  try {
    const conversationId = await findOrCreateDirectConversation(req.userId!, parsed.data.peerId);
    res.json({ conversationId });
  } catch (err) {
    // Most likely peerId doesn't exist (FK violation on conversation_members).
    console.error("[messaging-service] POST /conversations/direct failed", err);
    res.status(400).json({ error: "invalid_peer" });
  }
});
