import { Router } from "express";
import { z } from "zod";
import { createUser, findUserByPhone } from "../db";
import { signSession } from "../jwt";
import { issueOtp, sendSms, verifyOtp } from "../otp";

export const otpRouter = Router();

const requestSchema = z.object({
  phoneNumber: z.string().min(8).max(20),
});

otpRouter.post("/otp/request", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_phone_number" });
  }
  const { phoneNumber } = parsed.data;

  const code = await issueOtp(phoneNumber);
  await sendSms(phoneNumber, code);

  const devPayload = process.env.NODE_ENV !== "production" ? { devCode: code } : {};
  res.json({ ok: true, ...devPayload });
});

const verifySchema = z.object({
  phoneNumber: z.string().min(8).max(20),
  code: z.string().length(6),
  displayName: z.string().min(1).max(80).optional(),
});

otpRouter.post("/otp/verify", async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_request" });
  }
  const { phoneNumber, code, displayName } = parsed.data;

  const result = await verifyOtp(phoneNumber, code);
  if (result !== "ok") {
    return res.status(401).json({ error: result });
  }

  let user = await findUserByPhone(phoneNumber);
  if (!user) {
    user = await createUser(phoneNumber, displayName ?? phoneNumber);
  }

  const token = signSession(user.id);
  res.json({
    token,
    user: {
      id: user.id,
      phoneNumber: user.phone_number,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      createdAt: user.created_at,
    },
  });
});
