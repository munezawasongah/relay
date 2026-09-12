import { Olm } from "./olm";

export interface IdentityKeys {
  curve25519: string;
  ed25519: string;
}

export interface OneTimeKeyBundle {
  /** curve25519 key id -> base64 public key. Each is single-use: the server
   *  hands one out per session bootstrap and it's discarded after. */
  curve25519: Record<string, string>;
}

/** Wraps Olm.Account: this device's long-term identity key pair plus a pool
 *  of one-time prekeys published to the server so other users can start an
 *  encrypted session with this device even while it's offline (X3DH-style). */
export class IdentityAccount {
  private constructor(private account: InstanceType<typeof Olm.Account>) {}

  static create(): IdentityAccount {
    const account = new Olm.Account();
    account.create();
    return new IdentityAccount(account);
  }

  static fromPickle(pickleKey: string, pickle: string): IdentityAccount {
    const account = new Olm.Account();
    account.unpickle(pickleKey, pickle);
    return new IdentityAccount(account);
  }

  pickle(pickleKey: string): string {
    return this.account.pickle(pickleKey);
  }

  getIdentityKeys(): IdentityKeys {
    return JSON.parse(this.account.identity_keys());
  }

  /** Tops up the one-time-key pool and returns the newly generated keys
   *  (not the full existing pool) so the caller can publish just the delta
   *  to the server. Call markKeysAsPublished() once that upload succeeds. */
  generateOneTimeKeys(count: number): OneTimeKeyBundle {
    this.account.generate_one_time_keys(count);
    const all: OneTimeKeyBundle = JSON.parse(this.account.one_time_keys());
    return all;
  }

  markKeysAsPublished(): void {
    this.account.mark_keys_as_published();
  }

  /** Consumes the one-time key that was used to establish `rawSession` so it
   *  can never be reused. Takes the raw Olm.Session (see DirectSession.raw)
   *  because that's the API Olm exposes this through. */
  removeOneTimeKeysFor(rawSession: InstanceType<typeof Olm.Session>): void {
    this.account.remove_one_time_keys(rawSession);
  }

  /** Internal accessor for session.ts — kept out of the public surface so
   *  callers can't reach into raw Olm state and bypass pickling. */
  static raw(identity: IdentityAccount): InstanceType<typeof Olm.Account> {
    return identity.account;
  }
}
