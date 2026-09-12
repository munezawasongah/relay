import { initCrypto } from "./olm";
import { IdentityAccount, type IdentityKeys, type OneTimeKeyBundle } from "./identity";
import { DirectSession, type EncryptedDirectMessage } from "./session";
import { GroupInboundSession, GroupOutboundSession, type GroupCiphertext, type GroupPlaintext } from "./group";
import type { CryptoStore } from "./store";

export interface PeerKeyBundle {
  identityKey: string;
  oneTimeKey: string;
}

/**
 * High-level entry point tying identity + sessions + group sessions to a
 * CryptoStore. This is the "prototype the Signal Protocol integration in
 * isolation" piece the architecture doc's immediate-next-steps calls for —
 * it does not talk to the network itself. Publishing key bundles to
 * auth-service, fetching a peer's bundle before the first message, and
 * distributing group session keys over the messaging service are all
 * follow-up wiring, deliberately kept out of this package so the crypto
 * engine can be tested (and trusted) on its own first.
 *
 * `pickleKey` encrypts everything this class persists via the store. In the
 * mobile app that key itself belongs in expo-secure-store; it must never be
 * sent to the server or logged.
 */
export class RelayCrypto {
  private identity?: IdentityAccount;

  constructor(private store: CryptoStore, private pickleKey: string) {}

  async init(): Promise<void> {
    await initCrypto();
    const existing = await this.store.loadAccount();
    if (existing) {
      this.identity = IdentityAccount.fromPickle(this.pickleKey, existing);
    } else {
      this.identity = IdentityAccount.create();
      await this.store.saveAccount(this.identity.pickle(this.pickleKey));
    }
  }

  private requireIdentity(): IdentityAccount {
    if (!this.identity) throw new Error("RelayCrypto.init() must be called first");
    return this.identity;
  }

  getIdentityKeys(): IdentityKeys {
    return this.requireIdentity().getIdentityKeys();
  }

  /** Generates fresh one-time keys and persists the account immediately
   *  (generation mutates account state). Returns the new keys to publish —
   *  call markKeysAsPublished() once the upload to auth-service succeeds. */
  async generateOneTimeKeys(count = 5): Promise<OneTimeKeyBundle> {
    const identity = this.requireIdentity();
    const bundle = identity.generateOneTimeKeys(count);
    await this.store.saveAccount(identity.pickle(this.pickleKey));
    return bundle;
  }

  async markKeysAsPublished(): Promise<void> {
    const identity = this.requireIdentity();
    identity.markKeysAsPublished();
    await this.store.saveAccount(identity.pickle(this.pickleKey));
  }

  /** Encrypts a 1:1 message to `peerId`. Reuses the existing ratcheting
   *  session if one exists; otherwise bootstraps a new one from `theirBundle`
   *  (required — and only used — the first time this device messages that peer). */
  async encryptToUser(
    peerId: string,
    plaintext: string,
    theirBundle?: PeerKeyBundle
  ): Promise<EncryptedDirectMessage> {
    const identity = this.requireIdentity();
    let session: DirectSession;

    const existingPickle = await this.store.loadDirectSession(peerId);
    if (existingPickle) {
      session = DirectSession.fromPickle(this.pickleKey, existingPickle);
    } else {
      if (!theirBundle) {
        throw new Error(`No session with ${peerId} yet and no key bundle supplied to start one`);
      }
      session = DirectSession.createOutbound(identity, theirBundle.identityKey, theirBundle.oneTimeKey);
    }

    const message = session.encrypt(plaintext);
    await this.store.saveDirectSession(peerId, session.pickle(this.pickleKey));
    return message;
  }

  /** Decrypts a 1:1 message from `peerId`. A type-0 (PreKey) message from a
   *  peer with no existing session bootstraps a fresh inbound session and
   *  consumes the one-time key it used, so it can't be replayed. */
  async decryptFromUser(peerId: string, message: EncryptedDirectMessage): Promise<string> {
    const identity = this.requireIdentity();
    const existingPickle = await this.store.loadDirectSession(peerId);

    if (existingPickle) {
      const session = DirectSession.fromPickle(this.pickleKey, existingPickle);
      if (message.type !== 0 || session.matchesInbound(message.body)) {
        const plaintext = session.decrypt(message);
        await this.store.saveDirectSession(peerId, session.pickle(this.pickleKey));
        return plaintext;
      }
      // type 0 but doesn't match the session we have: falls through to
      // establish a new inbound session below (e.g. the peer reinstalled).
    }

    if (message.type !== 0) {
      throw new Error(`No session with ${peerId} and message isn't a PreKey message — can't bootstrap one`);
    }

    const session = DirectSession.createInbound(identity, message.body);
    const plaintext = session.decrypt(message);
    identity.removeOneTimeKeysFor(DirectSession.raw(session));

    await this.store.saveAccount(identity.pickle(this.pickleKey));
    await this.store.saveDirectSession(peerId, session.pickle(this.pickleKey));
    return plaintext;
  }

  /** Starts (or rotates) the group session this device sends with for
   *  `conversationId`. Returns the session key — the caller must distribute
   *  it to every other member via encryptToUser (1:1, never in the clear)
   *  before sending the first group message under this session. */
  async createGroupSession(conversationId: string): Promise<string> {
    const session = GroupOutboundSession.create();
    await this.store.saveOutboundGroupSession(conversationId, session.pickle(this.pickleKey));
    return session.sessionKey();
  }

  async encryptToGroup(conversationId: string, plaintext: string): Promise<GroupCiphertext> {
    const pickle = await this.store.loadOutboundGroupSession(conversationId);
    if (!pickle) {
      throw new Error(`No outbound group session for ${conversationId} — call createGroupSession() first`);
    }
    const session = GroupOutboundSession.fromPickle(this.pickleKey, pickle);
    const ciphertext = session.encrypt(plaintext);
    await this.store.saveOutboundGroupSession(conversationId, session.pickle(this.pickleKey));
    return ciphertext;
  }

  /** Call once per (conversation, sender) after receiving that sender's
   *  session key over a 1:1 encrypted channel (decryptFromUser). */
  async receiveGroupSessionKey(conversationId: string, senderId: string, sessionKey: string): Promise<void> {
    const session = GroupInboundSession.create(sessionKey);
    await this.store.saveInboundGroupSession(conversationId, senderId, session.pickle(this.pickleKey));
  }

  async decryptFromGroup(
    conversationId: string,
    senderId: string,
    message: GroupCiphertext
  ): Promise<GroupPlaintext> {
    const pickle = await this.store.loadInboundGroupSession(conversationId, senderId);
    if (!pickle) {
      throw new Error(
        `No inbound group session for ${senderId} in ${conversationId} — call receiveGroupSessionKey() first`
      );
    }
    const session = GroupInboundSession.fromPickle(this.pickleKey, pickle);
    const result = session.decrypt(message);
    await this.store.saveInboundGroupSession(conversationId, senderId, session.pickle(this.pickleKey));
    return result;
  }
}
