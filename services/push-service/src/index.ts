import "dotenv/config";
import express from "express";

// Push Notification Service — responsibility (architecture doc, section 3.1):
// Delivers alerts to offline devices via FCM (Android) and APNs (iOS),
// including VoIP push for incoming calls.

const app = express();
const PORT = process.env.PUSH_SERVICE_PORT || 4005;

app.get("/health", (_req, res) => {
  res.json({ service: "push-service", status: "ok" });
});

// TODO(Phase 1): POST /push/message  - fire FCM/APNs for an offline message
// TODO(Phase 2): POST /push/call     - fire VoIP push (APNs) / high-priority FCM for a call

app.listen(PORT, () => {
  console.log(`[push-service] listening on :${PORT}`);
});
