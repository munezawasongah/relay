// Storage is deliberately abstracted out of this package: mobile persists
// pickles in expo-secure-store, web in IndexedDB, and neither belongs in a
// package meant to run in both places (plus Node, for testing). Callers
// implement CryptoStore against whatever's appropriate for their platform.
//
// Every pickle is a string produced by Olm's own pickle(key) — already
// encrypted at rest with the pickle key the caller supplies (see
// RelayCrypto in facade.ts). This store just needs to persist opaque
// strings, not understand their contents.
export interface CryptoStore {
  loadAccount(): Promise<string | null>;
  saveAccount(pickle: string): Promise<void>;

  // Keyed by the other user's id (1:1 conversations map one session per peer
  // for Phase 1; multi-device fan-out is a follow-up).
  loadDirectSession(peerId: string): Promise<string | null>;
  saveDirectSession(peerId: string, pickle: string): Promise<void>;

  // The group session *we* send with, one per conversation we've created a
  // session for.
  loadOutboundGroupSession(conversationId: string): Promise<string | null>;
  saveOutboundGroupSession(conversationId: string, pickle: string): Promise<void>;

  // The group session we use to *read* a given sender's messages in a given
  // conversation — Megolm-style, keyed by (conversationId, senderId) since
  // each member encrypts with their own outbound session.
  loadInboundGroupSession(conversationId: string, senderId: string): Promise<string | null>;
  saveInboundGroupSession(conversationId: string, senderId: string, pickle: string): Promise<void>;
}

/** In-memory implementation for tests and local development. Not durable —
 *  never use this in the mobile or web clients themselves. */
export class InMemoryCryptoStore implements CryptoStore {
  private account: string | null = null;
  private directSessions = new Map<string, string>();
  private outboundGroupSessions = new Map<string, string>();
  private inboundGroupSessions = new Map<string, string>();

  async loadAccount() {
    return this.account;
  }
  async saveAccount(pickle: string) {
    this.account = pickle;
  }

  async loadDirectSession(peerId: string) {
    return this.directSessions.get(peerId) ?? null;
  }
  async saveDirectSession(peerId: string, pickle: string) {
    this.directSessions.set(peerId, pickle);
  }

  async loadOutboundGroupSession(conversationId: string) {
    return this.outboundGroupSessions.get(conversationId) ?? null;
  }
  async saveOutboundGroupSession(conversationId: string, pickle: string) {
    this.outboundGroupSessions.set(conversationId, pickle);
  }

  async loadInboundGroupSession(conversationId: string, senderId: string) {
    return this.inboundGroupSessions.get(`${conversationId}:${senderId}`) ?? null;
  }
  async saveInboundGroupSession(conversationId: string, senderId: string, pickle: string) {
    this.inboundGroupSessions.set(`${conversationId}:${senderId}`, pickle);
  }
}
