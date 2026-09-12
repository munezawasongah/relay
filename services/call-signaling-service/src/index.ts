import "dotenv/config";
import express from "express";

// Call Signaling Service — responsibility (architecture doc, section 3.1 / 3.3):
// Call setup/teardown, SDP offer/answer exchange, ICE candidate relay for 1:1 calls;
// LiveKit room provisioning for group calls (4-8 participants).

const app = express();
const PORT = process.env.CALL_SIGNALING_PORT || 4004;

app.get("/health", (_req, res) => {
  res.json({ service: "call-signaling-service", status: "ok" });
});

// TODO(Phase 2): POST /calls           - initiate a call, notify callee via push-service
// TODO(Phase 2): WS   offer/answer/ice - relay between two peers for 1:1 calls
// TODO(Phase 2): POST /calls/:id/join  - issue LiveKit room token for group calls

app.listen(PORT, () => {
  console.log(`[call-signaling-service] listening on :${PORT}`);
});
