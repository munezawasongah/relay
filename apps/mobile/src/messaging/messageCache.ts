import AsyncStorage from "@react-native-async-storage/async-storage";

// Persistent plaintext cache, one entry per (conversation, message id).
// This isn't an optional nicety — it's required for correctness given how
// Olm sessions work:
//
// 1. A sender cannot decrypt their own sent ciphertext. Double Ratchet
//    sessions have separate sending/receiving chains; the key a message was
//    encrypted with lives only in the sending chain, which the receiving
//    side's decrypt() doesn't have access to. So "my own messages, reloaded
//    after an app restart" can only ever be shown from something recorded
//    at send time (cacheMessage, called with the plaintext we already had
//    in hand) — not by decrypting the stored ciphertext, which is
//    fundamentally impossible for the sender.
// 2. An ordinary (type 1) ratchet message can only be decrypted once —
//    decrypting it advances the ratchet, and there's no "peek" operation.
//    So closing a chat and reopening it must NOT re-decrypt history it
//    already decrypted, or the second open would corrupt session state.
//    Every peer message gets cached immediately after its one legitimate
//    decryptFromUser() call, and useDirectConversation always checks this
//    cache before ever calling decryptFromUser() again for a given message.
//
// Plaintext at rest here is normal for a messaging app (the encryption's
// job is transport/server-blindness — the server, not this device, is who
// must never see plaintext). Not itself encrypted; if that changes, revisit
// alongside the pickle-storage limitation noted in crypto/store.ts.

function storageKey(conversationId: string): string {
  return `relay.messages.${conversationId}`;
}

export async function loadCachedMessages(conversationId: string): Promise<Record<string, string>> {
  const raw = await AsyncStorage.getItem(storageKey(conversationId));
  return raw ? JSON.parse(raw) : {};
}

export async function cacheMessage(conversationId: string, messageId: string, plaintext: string): Promise<void> {
  const cache = await loadCachedMessages(conversationId);
  cache[messageId] = plaintext;
  await AsyncStorage.setItem(storageKey(conversationId), JSON.stringify(cache));
}
