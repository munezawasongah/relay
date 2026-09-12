import { RelayCrypto } from "@relay/crypto";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { fetchOneTimeKeyCount, publishIdentityKey, publishOneTimeKeys } from "../api/keys";
import { SecureStoreCryptoStore } from "./store";

// Wires packages/crypto (built and tested in isolation — see its README
// section) into the client side of auth-service's key-publishing endpoints.
// This is the "message flow" half of the architecture doc's immediate next
// step: an identity now actually gets created and registered on sign-in, so
// a peer can later fetch a usable prekey bundle for this user. Sending and
// receiving encrypted messages themselves is the next piece, once the
// messaging-service WebSocket client exists in this app.

const PICKLE_KEY_STORAGE_KEY = "relay.crypto.pickleKey";
const LOW_WATER_MARK = 10; // top up once fewer than this many keys are left unclaimed server-side
const TOP_UP_COUNT = 20;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The pickle key encrypts everything RelayCrypto persists (see facade.ts).
 *  It never leaves this device and is never sent to the server — losing it
 *  means losing every session this device holds, same as losing the device
 *  itself. Generated once per install, 256 bits from the platform CSPRNG. */
async function getOrCreatePickleKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(PICKLE_KEY_STORAGE_KEY);
  if (existing) return existing;

  const bytes = await Crypto.getRandomBytesAsync(32);
  const pickleKey = toHex(bytes);
  await SecureStore.setItemAsync(PICKLE_KEY_STORAGE_KEY, pickleKey);
  return pickleKey;
}

let cryptoInstance: Promise<RelayCrypto> | undefined;

/** Memoized: every call site in the app shares one initialized RelayCrypto
 *  instance (and so one in-memory Olm.Account) rather than racing separate
 *  inits against the same SecureStore-backed account. */
export function getRelayCrypto(): Promise<RelayCrypto> {
  if (!cryptoInstance) {
    cryptoInstance = (async () => {
      const pickleKey = await getOrCreatePickleKey();
      const crypto = new RelayCrypto(new SecureStoreCryptoStore(), pickleKey);
      await crypto.init();
      return crypto;
    })();
  }
  return cryptoInstance;
}

/** Call once after sign-in (and again after restoring a session on app
 *  launch — both call sites in AuthContext). Publishing the identity key is
 *  idempotent (POST /keys/identity is a plain upsert) so calling this every
 *  launch is safe; the one-time-key top-up only actually publishes anything
 *  when the server-side pool has run low. */
export async function ensureKeysPublished(token: string): Promise<void> {
  const crypto = await getRelayCrypto();

  const identity = crypto.getIdentityKeys();
  await publishIdentityKey(token, identity.curve25519);

  const { count } = await fetchOneTimeKeyCount(token);
  if (count >= LOW_WATER_MARK) return;

  const bundle = await crypto.generateOneTimeKeys(TOP_UP_COUNT);
  await publishOneTimeKeys(token, bundle.curve25519);
  await crypto.markKeysAsPublished();
}
