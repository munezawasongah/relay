import { Router } from "express";
import { findUserById } from "../db";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth";

export const usersRouter = Router();

usersRouter.get("/users/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await findUserById(req.userId!);
  if (!user) {
    return res.status(404).json({ error: "user_not_found" });
  }
  res.json({
    id: user.id,
    phoneNumber: user.phone_number,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    createdAt: user.created_at,
  });
});
