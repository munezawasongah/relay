import type { CryptoStore } from "@relay/crypto";
import * as SecureStore from "expo-secure-store";

// The mobile half of the storage-agnostic CryptoStore interface (see
// packages/crypto/src/store.ts) — pickles are already encrypted by Olm
// itself before they ever reach here, so this is just persisting opaque
// strings under per-purpose keys in the platform keychain.
//
// KNOWN LIMITATION: expo-secure-store caps individual values at 2048 bytes
// on iOS (Keychain-backed). A single direct-session or group-session pickle
// is small and comfortably under that, but the *account* pickle grows with
// the one-time-key pool — keys accumulate until a peer's inbound session
// actually consumes them (see IdentityAccount.removeOneTimeKeysFor), not
// merely when generated. Frequent top-ups (bootstrap.ts) with few new 1:1
// chats being started by others could in theory push the account pickle
// past that limit over months of use. Not addressed here — flagging it as a
// real follow-up before this ships (options: prune/rotate old unclaimed
// one-time keys server-side after N days so the client can safely forget
// them too, or move account storage to expo-sqlite with app-level
// encryption, which doesn't have this ceiling).

const KEY_PREFIX = "relay.crypto.";

function directSessionKey(peerId: string): string {
  return `${KEY_PREFIX}session.${peerId}`;
}
function outboundGroupKey(conversationId: string): string {
  return `${KEY_PREFIX}group.out.${conversationId}`;
}
function inboundGroupKey(conversationId: string, senderId: string): string {
  return `${KEY_PREFIX}group.in.${conversationId}.${senderId}`;
}

export class SecureStoreCryptoStore implements CryptoStore {
  async loadAccount(): Promise<string | null> {
    return (await SecureStore.getItemAsync(`${KEY_PREFIX}account`)) ?? null;
  }
  async saveAccount(pickle: string): Promise<void> {
    await SecureStore.setItemAsync(`${KEY_PREFIX}account`, pickle);
  }

  async loadDirectSession(peerId: string): Promise<string | null> {
    return (await SecureStore.getItemAsync(directSessionKey(peerId))) ?? null;
  }
  async saveDirectSession(peerId: string, pickle: string): Promise<void> {
    await SecureStore.setItemAsync(directSessionKey(peerId), pickle);
  }

  async loadOutboundGroupSession(conversationId: string): Promise<string | null> {
    return (await SecureStore.getItemAsync(outboundGroupKey(conversationId))) ?? null;
  }
  async saveOutboundGroupSession(conversationId: string, pickle: string): Promise<void> {
    await SecureStore.setItemAsync(outboundGroupKey(conversationId), pickle);
  }

  async loadInboundGroupSession(conversationId: string, senderId: string): Promise<string | null> {
    return (await SecureStore.getItemAsync(inboundGroupKey(conversationId, senderId))) ?? null;
  }
  async saveInboundGroupSession(conversationId: string, senderId: string, pickle: string): Promise<void> {
    await SecureStore.setItemAsync(inboundGroupKey(conversationId, senderId), pickle);
  }
}
