import { Pool } from "pg";

// Lazily constructed: ES module imports are hoisted above plain statements,
// so a Pool built at module-load time would read process.env.DATABASE_URL
// before index.ts's dotenv.config() call has actually run. Building it on
// first use guarantees env vars are loaded first.
let _pool: Pool | undefined;
export function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

export interface UserRow {
  id: string;
  phone_number: string;
  display_name: string;
  avatar_url: string | null;
  public_key: string | null;
  created_at: string;
}

export async function findUserByPhone(phoneNumber: string): Promise<UserRow | null> {
  const { rows } = await pool().query<UserRow>(
    "SELECT * FROM users WHERE phone_number = $1",
    [phoneNumber]
  );
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<UserRow | null> {
  const { rows } = await pool().query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function createUser(phoneNumber: string, displayName: string): Promise<UserRow> {
  const { rows } = await pool().query<UserRow>(
    `INSERT INTO users (phone_number, display_name)
     VALUES ($1, $2)
     RETURNING *`,
    [phoneNumber, displayName]
  );
  return rows[0];
}

export async function upsertDevice(
  userId: string,
  platform: "ios" | "android" | "web",
  pushToken?: string
): Promise<void> {
  await pool().query(
    `INSERT INTO devices (user_id, platform, push_token, last_seen)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, platform)
     DO UPDATE SET push_token = EXCLUDED.push_token, last_seen = now()`,
    [userId, platform, pushToken ?? null]
  );
}

// --- Prekey publishing (Olm/Megolm — see packages/crypto and
// db/migrations/0002_prekeys.sql for the full picture) ---

export async function setIdentityKey(userId: string, identityKey: string): Promise<void> {
  await pool().query("UPDATE users SET public_key = $1 WHERE id = $2", [identityKey, userId]);
}

/** Idempotent: re-publishing the same key_id (e.g. a retried request after a
 *  dropped response) is a no-op rather than a duplicate or an error. Returns
 *  how many were actually new, so the caller can tell a retry from a bug. */
export async function insertOneTimeKeys(
  userId: string,
  keys: Record<string, string>
): Promise<number> {
  const entries = Object.entries(keys);
  if (entries.length === 0) return 0;

  const values: string[] = [];
  const params: string[] = [userId];
  entries.forEach(([keyId, publicKey], i) => {
    const a = params.push(keyId);
    const b = params.push(publicKey);
    values.push(`($1, $${a}, $${b})`);
  });

  const { rowCount } = await pool().query(
    `INSERT INTO one_time_prekeys (user_id, key_id, public_key)
     VALUES ${values.join(", ")}
     ON CONFLICT (user_id, key_id) DO NOTHING`,
    params
  );
  return rowCount ?? 0;
}

export async function countUnclaimedOneTimeKeys(userId: string): Promise<number> {
  const { rows } = await pool().query<{ count: string }>(
    "SELECT count(*) FROM one_time_prekeys WHERE user_id = $1 AND claimed_at IS NULL",
    [userId]
  );
  return Number(rows[0]?.count ?? 0);
}

/** Atomically claims one unclaimed one-time key for `userId` so it can never
 *  be handed out twice, even under concurrent requests (FOR UPDATE SKIP
 *  LOCKED — a second concurrent claim skips the row the first is mid-claim
 *  on rather than blocking or double-issuing it). Returns null if none are
 *  left; the caller (routes/keys.ts) turns that into a 409 the client can
 *  act on by asking that peer's device to top up next time it's online. */
export async function claimOneTimeKey(
  userId: string
): Promise<{ keyId: string; publicKey: string } | null> {
  const { rows } = await pool().query<{ key_id: string; public_key: string }>(
    `UPDATE one_time_prekeys
     SET claimed_at = now()
     WHERE id = (
       SELECT id FROM one_time_prekeys
       WHERE user_id = $1 AND claimed_at IS NULL
       ORDER BY created_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING key_id, public_key`,
    [userId]
  );
  if (rows.length === 0) return null;
  return { keyId: rows[0].key_id, publicKey: rows[0].public_key };
}
