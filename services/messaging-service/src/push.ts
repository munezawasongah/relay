// Fires an offline-message push through push-service. Deliberately
// fire-and-forget from the caller's point of view (see index.ts —
// message:send's ack to the sender doesn't wait on this): a push provider
// hiccup should never make the sender think their message failed to send,
// since it already succeeded (persisted + fanned out to whoever IS
// connected) by the time this runs.
export async function notifyOfflinePush(params: {
  userId: string;
  senderDisplayName: string;
  conversationId: string;
}): Promise<void> {
  const baseUrl = process.env.PUSH_SERVICE_URL || "http://localhost:4005";
  const secret = process.env.INTERNAL_SERVICE_SECRET || "dev-secret-do-not-use-in-production";

  try {
    const res = await fetch(`${baseUrl}/push/message`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      console.warn(`[messaging-service] push-service returned ${res.status} for user ${params.userId}`);
    }
  } catch (err) {
    console.warn(`[messaging-service] failed to reach push-service for user ${params.userId}`, err);
  }
}
