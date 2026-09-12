import { Olm } from "./olm";
import { IdentityAccount } from "./identity";

export interface EncryptedDirectMessage {
  type: 0 | 1; // 0 = PreKey message (bootstraps a new inbound session), 1 = ordinary ratchet message
  body: string;
}

/** Wraps Olm.Session: the Double Ratchet session with one specific peer.
 *  One of these per (my device, their device) pair. */
export class DirectSession {
  private constructor(private session: InstanceType<typeof Olm.Session>) {}

  /** Alice's side: bootstraps a new session using Bob's identity key and one
   *  of his published one-time keys (fetched from the server ahead of time). */
  static createOutbound(
    identity: IdentityAccount,
    theirIdentityKey: string,
    theirOneTimeKey: string
  ): DirectSession {
    const session = new Olm.Session();
    session.create_outbound(IdentityAccount.raw(identity), theirIdentityKey, theirOneTimeKey);
    return new DirectSession(session);
  }

  /** Bob's side: the first message from a new peer is always a PreKey
   *  message (type 0) — this consumes it to establish the inbound session.
   *  Caller must remove_one_time_keys via the account afterward (handled in
   *  facade.ts) so that one-time key can't be reused. */
  static createInbound(identity: IdentityAccount, preKeyMessageBody: string): DirectSession {
    const session = new Olm.Session();
    session.create_inbound(IdentityAccount.raw(identity), preKeyMessageBody);
    return new DirectSession(session);
  }

  static fromPickle(pickleKey: string, pickle: string): DirectSession {
    const session = new Olm.Session();
    session.unpickle(pickleKey, pickle);
    return new DirectSession(session);
  }

  pickle(pickleKey: string): string {
    return this.session.pickle(pickleKey);
  }

  /** True if an incoming PreKey message belongs to *this* session (used to
   *  tell "first message from a peer I already have a session with, e.g.
   *  they reinstalled the app" apart from "genuinely new peer"). */
  matchesInbound(preKeyMessageBody: string): boolean {
    return this.session.matches_inbound(preKeyMessageBody);
  }

  encrypt(plaintext: string): EncryptedDirectMessage {
    return this.session.encrypt(plaintext);
  }

  decrypt(message: EncryptedDirectMessage): string {
    return this.session.decrypt(message.type, message.body);
  }

  /** Internal accessor for facade.ts — needed once, to call
   *  Account.remove_one_time_keys(session) after consuming a PreKey message. */
  static raw(session: DirectSession): InstanceType<typeof Olm.Session> {
    return session.session;
  }
}
