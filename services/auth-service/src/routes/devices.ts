import { Router } from "express";
import { z } from "zod";
import { upsertDevice } from "../db";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth";

export const devicesRouter = Router();

const registerSchema = z.object({
  platform: z.enum(["ios", "android", "web"]),
  pushToken: z.string().optional(),
});

devicesRouter.post("/devices/register", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_request" });
  }
  await upsertDevice(req.userId!, parsed.data.platform, parsed.data.pushToken);
  res.json({ ok: true });
});
