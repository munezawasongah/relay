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

/** Every other member of the conversation, excluding the sender — used to
 *  figure out who to push-notify (see index.ts's message:send handler).
 *  Correct for both direct and group conversations, unlike deriving it
 *  from a single hardcoded "peerId". */
export async function getOtherMemberIds(conversationId: string, senderId: string): Promise<string[]> {
  const { rows } = await pool().query<{ user_id: string }>(
    "SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id != $2",
    [conversationId, senderId]
  );
  return rows.map((r) => r.user_id);
}

/** For the push notification's title — the recipient's device shows "X sent
 *  you a message", and the server has no plaintext to put in the body (see
 *  push-service's routes/push.ts), so the sender's name is the only useful
 *  content available. Falls back to a generic label rather than throwing if
 *  the user somehow doesn't exist (shouldn't happen; not worth failing the
 *  whole send over). */
export async function getUserDisplayName(userId: string): Promise<string> {
  const { rows } = await pool().query<{ display_name: string }>(
    "SELECT display_name FROM users WHERE id = $1",
    [userId]
  );
  return rows[0]?.display_name || "Someone";
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

export interface ConversationRow {
  id: string;
  type: "direct" | "group";
  name: string | null;
  peer_id: string | null;
  peer_display_name: string | null;
  peer_avatar_url: string | null;
  last_message_id: string | null;
  last_message_sender_id: string | null;
  last_message_sent_at: string | null;
}

/** One row per conversation the user belongs to, with (for direct
 *  conversations only — see PublicUser/ConversationSummary in
 *  @relay/shared) the other member's public info and last-message
 *  metadata. Metadata only: ciphertext content isn't fetched here, so this
 *  can't be used to preview message content, by design — see ChatListScreen
 *  for why decrypting speculatively here would be unsafe (each Olm ratchet
 *  message can only be decrypted once). */
export async function listConversationsForUser(userId: string): Promise<ConversationRow[]> {
  const { rows } = await pool().query<ConversationRow>(
    `SELECT
       c.id,
       c.type,
       c.name,
       peer.id AS peer_id,
       peer.display_name AS peer_display_name,
       peer.avatar_url AS peer_avatar_url,
       lm.id AS last_message_id,
       lm.sender_id AS last_message_sender_id,
       lm.sent_at AS last_message_sent_at
     FROM conversations c
     JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = $1
     LEFT JOIN conversation_members other_member
       ON c.type = 'direct' AND other_member.conversation_id = c.id AND other_member.user_id != $1
     LEFT JOIN users peer ON peer.id = other_member.user_id
     LEFT JOIN LATERAL (
       SELECT id, sender_id, sent_at FROM messages
       WHERE conversation_id = c.id
       ORDER BY sent_at DESC
       LIMIT 1
     ) lm ON true
     ORDER BY COALESCE(lm.sent_at, c.created_at) DESC`,
    [userId]
  );
  return rows;
}

/** Most recent `limit` messages, optionally paging backward from
 *  `beforeMessageId` (for "load older messages" as the user scrolls up).
 *  Returns oldest-first so the caller can append straight into a
 *  chronological list. */
export async function getMessagesForConversation(
  conversationId: string,
  limit: number,
  beforeMessageId?: string
): Promise<Message[]> {
  let rows: MessageRow[];
  if (beforeMessageId) {
    ({ rows } = await pool().query<MessageRow>(
      `SELECT m.* FROM messages m
       WHERE m.conversation_id = $1
         AND m.sent_at < (SELECT sent_at FROM messages WHERE id = $3)
       ORDER BY m.sent_at DESC
       LIMIT $2`,
      [conversationId, limit, beforeMessageId]
    ));
  } else {
    ({ rows } = await pool().query<MessageRow>(
      `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY sent_at DESC LIMIT $2`,
      [conversationId, limit]
    ));
  }
  return rows.map(toMessage).reverse();
}

/** Finds the existing direct conversation between these two users, or
 *  creates one. Direct conversations are unordered pairs, so this always
 *  looks for an existing one before creating — otherwise two users tapping
 *  "message" on each other around the same time could end up with two
 *  separate direct conversations. Guarded by a transaction-scoped Postgres
 *  advisory lock keyed to the (sorted, so order-independent) pair, so two
 *  concurrent calls for the same pair serialize instead of racing —
 *  there's no schema-level unique constraint for "at most one direct
 *  conversation per pair" (would need a migration), so this is the
 *  concurrency guarantee until one exists. */
export async function findOrCreateDirectConversation(
  userId: string,
  peerId: string
): Promise<string> {
  const lockKey = [userId, peerId].sort().join(":");

  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [lockKey]);

    const { rows: existing } = await client.query<{ id: string }>(
      `SELECT c.id FROM conversations c
       JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = $1
       JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = $2
       WHERE c.type = 'direct'
       LIMIT 1`,
      [userId, peerId]
    );
    if (existing.length > 0) {
      await client.query("COMMIT");
      return existing[0].id;
    }

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO conversations (type) VALUES ('direct') RETURNING id`
    );
    const conversationId = rows[0].id;
    await client.query(
      `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
      [conversationId, userId, peerId]
    );
    await client.query("COMMIT");
    return conversationId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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
