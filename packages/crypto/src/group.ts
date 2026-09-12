import { Olm } from "./olm";

export interface GroupCiphertext {
  ciphertext: string;
}

export interface GroupPlaintext {
  plaintext: string;
  messageIndex: number;
}

/** Megolm-style: the session a member sends group messages with. One per
 *  conversation, created (and rotated on membership change — not yet
 *  implemented, see facade.ts) by whoever last (re)established it. */
export class GroupOutboundSession {
  private constructor(private session: InstanceType<typeof Olm.OutboundGroupSession>) {}

  static create(): GroupOutboundSession {
    const session = new Olm.OutboundGroupSession();
    session.create();
    return new GroupOutboundSession(session);
  }

  static fromPickle(pickleKey: string, pickle: string): GroupOutboundSession {
    const session = new Olm.OutboundGroupSession();
    session.unpickle(pickleKey, pickle);
    return new GroupOutboundSession(session);
  }

  pickle(pickleKey: string): string {
    return this.session.pickle(pickleKey);
  }

  /** The session key every other member needs, distributed to each of them
   *  individually over a 1:1 DirectSession (never sent in the clear to the
   *  group) so they can decrypt what this session encrypts. */
  sessionKey(): string {
    return this.session.session_key();
  }

  sessionId(): string {
    return this.session.session_id();
  }

  encrypt(plaintext: string): GroupCiphertext {
    return { ciphertext: this.session.encrypt(plaintext) };
  }
}

/** The session a member uses to *read* one specific other member's group
 *  messages — built from the session key that member distributed. One per
 *  (conversation, sender). */
export class GroupInboundSession {
  private constructor(private session: InstanceType<typeof Olm.InboundGroupSession>) {}

  static create(sessionKey: string): GroupInboundSession {
    const session = new Olm.InboundGroupSession();
    session.create(sessionKey);
    return new GroupInboundSession(session);
  }

  static fromPickle(pickleKey: string, pickle: string): GroupInboundSession {
    const session = new Olm.InboundGroupSession();
    session.unpickle(pickleKey, pickle);
    return new GroupInboundSession(session);
  }

  pickle(pickleKey: string): string {
    return this.session.pickle(pickleKey);
  }

  sessionId(): string {
    return this.session.session_id();
  }

  decrypt(message: GroupCiphertext): GroupPlaintext {
    const result = this.session.decrypt(message.ciphertext);
    return { plaintext: result.plaintext, messageIndex: result.message_index };
  }
}
