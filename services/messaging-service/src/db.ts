import { Pool } from "pg";
import type { Message } from "@relay/shared";

// Lazily constructed — see the auth-service's db.ts for why (dotenv.config()
// runs after ES import hoisting has already evaluated this module otherwise).
let _pool: Pool | undefined;
function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

export async function getConversationIdsForUser(userId: string): Promise<string[]> {
  const { rows } = await pool().query<{ conversation_id: string }>(
    "SELECT conversation_id FROM conversation_members WHERE user_id = $1",
    [userId]
  );
  return rows.map((r) => r.conversation_id);
}

export async function isConversationMember(conversationId: string, userId: string): Promise<boolean> {
  const { rows } = await pool().query(
    "SELECT 1 FROM conversation_members WHERE conversation_id = $1 AND user_id = $2",
    [conversationId, userId]
  );
  return rows.length > 0;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  ciphertext: string;
  media_ref: string | null;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    ciphertext: row.ciphertext,
    mediaRef: row.media_ref ?? undefined,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at ?? undefined,
    readAt: row.read_at ?? undefined,
  };
}

export async function insertMessage(params: {
  conversationId: string;
  senderId: string;
  ciphertext: string;
  mediaRef?: string;
  deliveredNow: boolean;
}): Promise<Message> {
  const { rows } = await pool().query<MessageRow>(
    `INSERT INTO messages (conversation_id, sender_id, ciphertext, media_ref, delivered_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN now() ELSE NULL END)
     RETURNING *`,
    [params.conversationId, params.senderId, params.ciphertext, params.mediaRef ?? null, params.deliveredNow]
  );
  return toMessage(rows[0]);
}

export async function markMessageRead(
  messageId: string,
  readerId: string
): Promise<{ readAt: string; senderId: string } | null> {
  // Only a recipient (not the sender) can mark a message read, and only once.
  const { rows } = await pool().query<{ read_at: string; sender_id: string }>(
    `UPDATE messages
     SET read_at = COALESCE(read_at, now())
     WHERE id = $1
       AND sender_id != $2
       AND EXISTS (
         SELECT 1 FROM conversation_members
         WHERE conversation_id = messages.conversation_id AND user_id = $2
       )
     RETURNING read_at, sender_id`,
    [messageId, readerId]
  );
  if (rows.length === 0) return null;
  return { readAt: rows[0].read_at, senderId: rows[0].sender_id };
}
