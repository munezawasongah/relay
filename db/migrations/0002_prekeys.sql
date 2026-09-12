-- One-time prekeys for X3DH-style session bootstrap. This is the server-side
-- half of "wire the crypto engine into auth-service key publishing" (see
-- README's build status / architecture doc section 5.2 immediate next steps).
--
-- The long-term identity key reuses the existing users.public_key column.
-- The architecture doc's data model sketch (section 4.1) models one identity
-- key per user, not per device — consistent with the crypto engine's own MVP
-- scope, which deliberately defers multi-device fan-out
-- (see packages/crypto/src/facade.ts).

CREATE TABLE IF NOT EXISTS one_time_prekeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, key_id)
);

-- Every "does user X have keys left" / "claim one" query filters on this.
CREATE INDEX IF NOT EXISTS idx_one_time_prekeys_unclaimed
  ON one_time_prekeys (user_id)
  WHERE claimed_at IS NULL;
