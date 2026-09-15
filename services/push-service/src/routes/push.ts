import { Router } from "express";
import { z } from "zod";
import { clearDeadPushToken, listPushTargetsForUser } from "../db";
import { sendPushToTokens } from "../fcm";

export const pushRouter = Router();

const messagePayloadSchema = z.object({
  userId: z.string().uuid(),
  senderDisplayName: z.string().min(1).max(80),
  conversationId: z.string().uuid(),
});

// Called by messaging-service (see its index.ts) right after a message is
// persisted for a recipient who has no device currently connected to the
// WebSocket — the "offline -> push notification" half of the architecture
// doc's message flow (section 3.2).
//
// Deliberately generic body: the server (this one included) never has
// message plaintext — that's the whole point of E2E encryption — so the
// notification can say "X sent you a message" but never what it says.
pushRouter.post("/push/message", async (req, res) => {
  const parsed = messagePayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_request" });
  }
  const { userId, senderDisplayName, conversationId } = parsed.data;

  try {
    const targets = await listPushTargetsForUser(userId);
    const result = await sendPushToTokens(
      targets.map((t) => t.pushToken),
      {
        title: senderDisplayName,
        body: "Sent you a message",
        data: { type: "message", conversationId },
      }
    );

    await Promise.all(result.deadTokens.map((token) => clearDeadPushToken(token)));

    res.json({ ok: true, attempted: result.attempted, delivered: result.delivered });
  } catch (err) {
    console.error("[push-service] POST /push/message failed", err);
    res.status(500).json({ error: "internal_error" });
  }
});
