import { Pool } from "pg";

// Lazily constructed — see auth-service's db.ts for why (dotenv.config()
// runs after ES import hoisting has already evaluated this module otherwise).
let _pool: Pool | undefined;
function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return _pool;
}

export interface DevicePushTarget {
  platform: "ios" | "android" | "web";
  pushToken: string;
}

/** A user can have at most one row per platform (see the `devices` table's
 *  UNIQUE (user_id, platform) constraint) — so this is "up to 3 devices",
 *  not "however many times they've signed in." Only rows with a push token
 *  actually registered are returned; a signed-in device that never called
 *  POST /devices/register with one (or explicitly opted out) is silently
 *  skipped, not an error. */
export async function listPushTargetsForUser(userId: string): Promise<DevicePushTarget[]> {
  const { rows } = await pool().query<{ platform: DevicePushTarget["platform"]; push_token: string }>(
    "SELECT platform, push_token FROM devices WHERE user_id = $1 AND push_token IS NOT NULL",
    [userId]
  );
  return rows.map((r) => ({ platform: r.platform, pushToken: r.push_token }));
}

/** Firebase reported this token as dead (app uninstalled, token rotated,
 *  etc.) — stop trying it. Cheaper to just clear it than to track retries;
 *  the device re-registers a fresh token next time it opens the app and
 *  calls POST /devices/register again. */
export async function clearDeadPushToken(pushToken: string): Promise<void> {
  await pool().query("UPDATE devices SET push_token = NULL WHERE push_token = $1", [pushToken]);
}
