import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryCryptoStore } from "./store";
import { RelayCrypto } from "./facade";

// These exercise the whole engine against real Olm (the pure-JS build — see
// olm-legacy.d.ts for why), not mocks. This is the "prototype the Signal
// Protocol integration in isolation" step the architecture doc's immediate
// next steps call for, before it's wired into the messaging service.

async function makeUser(pickleKey: string) {
  const store = new InMemoryCryptoStore();
  const crypto = new RelayCrypto(store, pickleKey);
  await crypto.init();
  return { store, crypto };
}

test("1:1 session: bootstrap, round-trip, and ratchet advances", async () => {
  const alice = await makeUser("alice-pickle-key");
  const bob = await makeUser("bob-pickle-key");

  const bobIdentity = bob.crypto.getIdentityKeys();
  const bobOtks = await bob.crypto.generateOneTimeKeys(1);
  await bob.crypto.markKeysAsPublished();
  const bobOtk = Object.values(bobOtks.curve25519)[0];

  // Alice sends the first message, bootstrapping the session from Bob's published bundle.
  const msg1 = await alice.crypto.encryptToUser("bob", "Hello Bob, it's Alice", {
    identityKey: bobIdentity.curve25519,
    oneTimeKey: bobOtk,
  });
  assert.equal(msg1.type, 0, "first message must be a PreKey message");
  assert.ok(!msg1.body.includes("Hello Bob"), "ciphertext must not contain the plaintext");

  const plaintext1 = await bob.crypto.decryptFromUser("alice", msg1);
  assert.equal(plaintext1, "Hello Bob, it's Alice");

  // Bob replies — this must reuse the now-established session (type 1, not another PreKey).
  const reply1 = await bob.crypto.encryptToUser("alice", "Hi Alice!");
  assert.equal(reply1.type, 1, "a reply on an established session is an ordinary ratchet message");
  const replyPlaintext = await alice.crypto.decryptFromUser("bob", reply1);
  assert.equal(replyPlaintext, "Hi Alice!");

  // Alice sends a second message on the now-established session.
  const msg2 = await alice.crypto.encryptToUser("bob", "Second message");
  assert.equal(msg2.type, 1);
  const plaintext2 = await bob.crypto.decryptFromUser("alice", msg2);
  assert.equal(plaintext2, "Second message");

  // Forward secrecy sanity check: encrypting the same plaintext twice must
  // not produce the same ciphertext, since the ratchet advances every message.
  const dup1 = await alice.crypto.encryptToUser("bob", "same text");
  const dup2 = await alice.crypto.encryptToUser("bob", "same text");
  assert.notEqual(dup1.body, dup2.body, "ratchet must advance between identical-plaintext messages");
});

test("1:1 session: persists across a simulated app restart", async () => {
  const alicePickleKey = "alice-pickle-key";
  const bobPickleKey = "bob-pickle-key";

  const aliceStore = new InMemoryCryptoStore();
  let alice = new RelayCrypto(aliceStore, alicePickleKey);
  await alice.init();

  const bob = await makeUser(bobPickleKey);
  const bobIdentity = bob.crypto.getIdentityKeys();
  const bobOtks = await bob.crypto.generateOneTimeKeys(1);
  const bobOtk = Object.values(bobOtks.curve25519)[0];

  const msg1 = await alice.encryptToUser("bob", "before restart", {
    identityKey: bobIdentity.curve25519,
    oneTimeKey: bobOtk,
  });
  await bob.crypto.decryptFromUser("alice", msg1);

  // An Olm outbound session keeps sending type-0 (PreKey) messages until it
  // has *received* a reply — that's what flips it to the ordinary ratchet
  // (type 1), independent of persistence. So Bob replies here, before the
  // restart, to actually exercise "does a restored session stay established"
  // rather than "does a session that never heard back stay in bootstrap mode"
  // (which would be true either way and wouldn't prove persistence works).
  const reply = await bob.crypto.encryptToUser("alice", "got it");
  await alice.decryptFromUser("bob", reply);

  // Simulate Alice's app restarting: a brand new RelayCrypto instance, but
  // backed by the same (now-persisted) store — nothing is kept in memory
  // across this line.
  alice = new RelayCrypto(aliceStore, alicePickleKey);
  await alice.init();

  const msg2 = await alice.encryptToUser("bob", "after restart");
  assert.equal(msg2.type, 1, "the restored session should still be established, not bootstrapping anew");
  const plaintext2 = await bob.crypto.decryptFromUser("alice", msg2);
  assert.equal(plaintext2, "after restart");
});

test("group session: distributed key lets multiple members decrypt, in order", async () => {
  const alice = await makeUser("alice-pickle-key");
  const bob = await makeUser("bob-pickle-key");
  const carol = await makeUser("carol-pickle-key");

  const conversationId = "group-1";
  const sessionKey = await alice.crypto.createGroupSession(conversationId);

  // In the real app this key is distributed to each member over a 1:1
  // encrypted DirectSession (encryptToUser/decryptFromUser) — that transport
  // step is exercised by the 1:1 tests above, so here we simulate having
  // already received and decrypted it.
  await bob.crypto.receiveGroupSessionKey(conversationId, "alice", sessionKey);
  await carol.crypto.receiveGroupSessionKey(conversationId, "alice", sessionKey);

  const ciphertext1 = await alice.crypto.encryptToGroup(conversationId, "Hello group");
  const bobResult1 = await bob.crypto.decryptFromGroup(conversationId, "alice", ciphertext1);
  const carolResult1 = await carol.crypto.decryptFromGroup(conversationId, "alice", ciphertext1);
  assert.equal(bobResult1.plaintext, "Hello group");
  assert.equal(carolResult1.plaintext, "Hello group");
  assert.equal(bobResult1.messageIndex, 0);

  const ciphertext2 = await alice.crypto.encryptToGroup(conversationId, "Second group message");
  const bobResult2 = await bob.crypto.decryptFromGroup(conversationId, "alice", ciphertext2);
  assert.equal(bobResult2.plaintext, "Second group message");
  assert.equal(bobResult2.messageIndex, 1);

  // A member with no distributed key yet must not be able to read anything.
  const dave = await makeUser("dave-pickle-key");
  await assert.rejects(() => dave.crypto.decryptFromGroup(conversationId, "alice", ciphertext1));
});

test("decryptFromUser rejects a type-1 message with no established session", async () => {
  const alice = await makeUser("alice-pickle-key");
  await assert.rejects(
    () => alice.crypto.decryptFromUser("nobody", { type: 1, body: "bm90aGluZw==" }),
    /No session with nobody/
  );
});
