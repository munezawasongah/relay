import { Router } from "express";
import { z } from "zod";
import {
  claimOneTimeKey,
  countUnclaimedOneTimeKeys,
  findUserById,
  insertOneTimeKeys,
  setIdentityKey,
} from "../db";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth";

// Prekey publishing endpoints — the auth-service side of "prototype the
// Signal Protocol integration in isolation before wiring it into the
// messaging service" (architecture doc section 5.2). packages/crypto
// generates and manages the key material; this router is just storage +
// atomic claim/handout, and never sees anything but public keys.

export const keysRouter = Router();

const identitySchema = z.object({
  identityKey: z.string().min(1),
});

keysRouter.post("/keys/identity", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = identitySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_request" });
  }
  await setIdentityKey(req.userId!, parsed.data.identityKey);
  res.json({ ok: true });
});

// Shape matches OneTimeKeyBundle["curve25519"] from packages/crypto
// (generateOneTimeKeys' return value) — the client publishes exactly what
// that call gives it, no reshaping needed on either side.
const oneTimeKeysSchema = z.object({
  oneTimeKeys: z.record(z.string(), z.string()).refine((keys) => Object.keys(keys).length > 0, {
    message: "oneTimeKeys must not be empty",
  }),
});

keysRouter.post("/keys/one-time", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = oneTimeKeysSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_request" });
  }
  const inserted = await insertOneTimeKeys(req.userId!, parsed.data.oneTimeKeys);
  res.json({ ok: true, inserted });
});

keysRouter.get("/keys/one-time/count", requireAuth, async (req: AuthedRequest, res) => {
  const count = await countUnclaimedOneTimeKeys(req.userId!);
  res.json({ count });
});

// Fetches the prekey bundle needed to bootstrap a new 1:1 session with
// `userId` (RelayCrypto.encryptToUser's `theirBundle` argument). Claims (and
// so permanently consumes) one one-time key as a side effect — that's
// intentional and matches Olm/X3DH semantics: each one-time key backs at
// most one session bootstrap, ever.
keysRouter.get("/keys/bundle/:userId", requireAuth, async (req: AuthedRequest, res) => {
  const { userId } = req.params;

  const user = await findUserById(userId);
  if (!user || !user.public_key) {
    return res.status(404).json({ error: "identity_key_not_published" });
  }

  const oneTimeKey = await claimOneTimeKey(userId);
  if (!oneTimeKey) {
    // Not an error in the peer's identity or the request — just means that
    // device hasn't topped up its one-time-key pool recently. The caller
    // should surface "can't start a chat with this person right now" and
    // retry later rather than falling back to sending without one: the
    // crypto engine's DirectSession.createOutbound requires a one-time key
    // for every new session (see packages/crypto/src/facade.ts).
    return res.status(409).json({ error: "no_one_time_keys_available" });
  }

  res.json({
    identityKey: user.public_key,
    oneTimeKey: oneTimeKey.publicKey,
  });
});
