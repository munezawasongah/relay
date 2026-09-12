import "dotenv/config";
import express from "express";

// Auth Service — responsibility (architecture doc, section 3.1):
// OTP issuance/verification, JWT session tokens, device registration.
//
// Route implementations land in the "Phase 0: Auth service + Postgres schema"
// build step. This file boots the service shell so it can be deployed on
// Railway from day one and wired into the API gateway routing.

const app = express();
app.use(express.json());

const PORT = process.env.AUTH_SERVICE_PORT || 4001;

app.get("/health", (_req, res) => {
  res.json({ service: "auth-service", status: "ok" });
});

// TODO(Phase 0): POST /otp/request        - issue SMS OTP for a phone number
// TODO(Phase 0): POST /otp/verify         - verify OTP, return JWT session token
// TODO(Phase 0): POST /devices/register   - register a device + push token
// TODO(Phase 0): GET  /users/me           - fetch the authenticated user's profile

app.listen(PORT, () => {
  console.log(`[auth-service] listening on :${PORT}`);
});
