import { Pool } from "pg";
import type { Call, CallStatus, CallType } from "@relay/shared";

// Lazily constructed — see auth-service's db.ts for why (dotenv.config()
// runs after ES import hoisting has already evaluated this module otherwise).
let _pool: Pool | undefined;
function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

interface CallRow {
  id: string;
  conversation_id: string;
  initiator_id: string;
  type: CallType;
  status: CallStatus;
  started_at: string;
  ended_at: string | null;
}

function toCall(row: CallRow): Call {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    initiatorId: row.initiator_id,
    type: row.type,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
  };
}

export interface ConversationInfo {
  type: "direct" | "group";
  /** The other member's id, for a direct conversation the caller belongs
   *  to. Always undefined for a group (group calling isn't built — see
   *  index.ts's call:invite handler, which rejects those outright rather
   *  than guessing who to ring). */
  otherMemberId?: string;
}

/** Null means the caller isn't a member of this conversation at all (or it
 *  doesn't exist) — same "not_a_member" failure mode messaging-service
 *  already uses for the equivalent check on message:send. */
export async function getConversationInfoForCaller(
  conversationId: string,
  callerId: string
): Promise<ConversationInfo | null> {
  const { rows } = await pool().query<{ type: "direct" | "group"; other_member_id: string | null }>(
    `SELECT c.type, other_member.user_id AS other_member_id
     FROM conversations c
     JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = $2
     LEFT JOIN conversation_members other_member
       ON c.type = 'direct' AND other_member.conversation_id = c.id AND other_member.user_id != $2
     WHERE c.id = $1`,
    [conversationId, callerId]
  );
  if (rows.length === 0) return null;
  return { type: rows[0].type, otherMemberId: rows[0].other_member_id ?? undefined };
}

/** An existing call is "in the way" of a new one for the same conversation
 *  if it's still ringing or active — mirrors the direct-conversation
 *  find-or-create race-guard reasoning elsewhere in this codebase, just
 *  without needing an advisory lock: two invites landing at nearly the same
 *  instant is an edge case worth a plain existence check, not worth the
 *  complexity a lock would add for something this low-stakes (worst case,
 *  a caller gets "call_already_in_progress" and retries). */
export async function getInProgressCall(conversationId: string): Promise<Call | null> {
  const { rows } = await pool().query<CallRow>(
    `SELECT * FROM calls WHERE conversation_id = $1 AND status IN ('ringing', 'active') LIMIT 1`,
    [conversationId]
  );
  return rows[0] ? toCall(rows[0]) : null;
}

export async function createCall(params: {
  conversationId: string;
  initiatorId: string;
  type: CallType;
}): Promise<Call> {
  const { rows } = await pool().query<CallRow>(
    `INSERT INTO calls (conversation_id, initiator_id, type, status)
     VALUES ($1, $2, $3, 'ringing')
     RETURNING *`,
    [params.conversationId, params.initiatorId, params.type]
  );
  return toCall(rows[0]);
}

export async function getCall(callId: string): Promise<Call | null> {
  const { rows } = await pool().query<CallRow>("SELECT * FROM calls WHERE id = $1", [callId]);
  return rows[0] ? toCall(rows[0]) : null;
}

/** Transitions a call's status. `expectedCurrentStatus` guards against
 *  acting twice on the same call (e.g. accept racing hangup) — the update
 *  only applies if the row is still in the state the caller expected it
 *  to be in, same idea as markMessageRead's read_at guard in
 *  messaging-service. Returns null if that guard didn't hold (or the call
 *  doesn't exist), which the caller treats as "invalid_state". */
export async function transitionCall(
  callId: string,
  expectedCurrentStatus: CallStatus[],
  newStatus: CallStatus,
  setEndedAt: boolean
): Promise<Call | null> {
  const { rows } = await pool().query<CallRow>(
    `UPDATE calls
     SET status = $2, ended_at = CASE WHEN $3 THEN now() ELSE ended_at END
     WHERE id = $1 AND status = ANY($4)
     RETURNING *`,
    [callId, newStatus, setEndedAt, expectedCurrentStatus]
  );
  return rows[0] ? toCall(rows[0]) : null;
}

/** Used on socket disconnect (see index.ts) to catch a call left dangling
 *  by an app crash/force-close/lost connection rather than a clean hangup —
 *  otherwise the other party's call screen would just sit there forever
 *  with no signal that anything went wrong. */
export async function getInProgressCallForUser(userId: string): Promise<Call | null> {
  const { rows } = await pool().query<CallRow>(
    `SELECT c.* FROM calls c
     JOIN conversation_members cm ON cm.conversation_id = c.conversation_id AND cm.user_id = $1
     WHERE c.status IN ('ringing', 'active')
     LIMIT 1`,
    [userId]
  );
  return rows[0] ? toCall(rows[0]) : null;
}

export async function getUserDisplayName(userId: string): Promise<string> {
  const { rows } = await pool().query<{ display_name: string }>(
    "SELECT display_name FROM users WHERE id = $1",
    [userId]
  );
  return rows[0]?.display_name || "Someone";
}
