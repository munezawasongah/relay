import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import express from "express";
import { requireInternalSecret } from "./middleware/requireInternalSecret";
import { pushRouter } from "./routes/push";

// Push Notification Service — responsibility (architecture doc, section 3.1):
// Delivers alerts to offline devices via FCM (Android) and APNs (iOS),
// including VoIP push for incoming calls.
//
// Only ever called by other services (see requireInternalSecret), never
// directly by a client.

const app = express();
const PORT = process.env.PUSH_SERVICE_PORT || 4005;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ service: "push-service", status: "ok" });
});

app.use(requireInternalSecret, pushRouter);

// TODO(Phase 2): POST /push/call - VoIP push (raw APNs, not FCM) / high-priority FCM for a call

app.listen(PORT, () => {
  console.log(`[push-service] listening on :${PORT}`);
});
