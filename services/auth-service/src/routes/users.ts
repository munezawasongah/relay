import { Router } from "express";
import { findUserByPhone, findUserById } from "../db";
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

// Minimal stand-in for the architecture doc's "Contacts: sync from device
// contact list, match against registered users" (full sync is its own,
// separate Phase 1 deliverable — not built yet). This is just enough to
// start a new direct conversation by phone number: apps/mobile's "new chat"
// flow looks a person up, then POSTs /conversations/direct with the id this
// returns. Deliberately returns only public-facing fields — never the
// phone number back (the caller already has it), and no key material
// (that's a separate lookup via GET /keys/bundle/:userId, kept out of this
// response so a phone-number lookup alone can't be used to fingerprint
// whether someone has published keys yet).
usersRouter.get("/users/by-phone/:phoneNumber", requireAuth, async (req: AuthedRequest, res) => {
  const user = await findUserByPhone(req.params.phoneNumber);
  if (!user) {
    return res.status(404).json({ error: "user_not_found" });
  }
  res.json({
    id: user.id,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
  });
});
