import path from "path";
import dotenv from "dotenv";
// Services live at services/<name>/src (or dist after build) — the shared
// .env file lives at the repo root, 3 directories up either way.
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import express from "express";
import { devicesRouter } from "./routes/devices";
import { otpRouter } from "./routes/otp";
import { usersRouter } from "./routes/users";

// Auth Service — responsibility (architecture doc, section 3.1):
// OTP issuance/verification, JWT session tokens, device registration.

const app = express();
app.use(express.json());

const PORT = process.env.AUTH_SERVICE_PORT || 4001;

app.get("/health", (_req, res) => {
  res.json({ service: "auth-service", status: "ok" });
});

app.use(otpRouter);
app.use(devicesRouter);
app.use(usersRouter);

app.listen(PORT, () => {
  console.log(`[auth-service] listening on :${PORT}`);
});
