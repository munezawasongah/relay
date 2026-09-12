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
