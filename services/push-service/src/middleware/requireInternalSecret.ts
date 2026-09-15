import type { NextFunction, Request, Response } from "express";

// push-service is only ever called by other services (messaging-service
// today; call-signaling-service in Phase 2 for VoIP push), never directly
// by a client — there's no user JWT in play here. This shared-secret
// header is the MVP-simple equivalent of auth-service/messaging-service's
// requireAuth, matching the same "one shared secret in .env" pattern as
// JWT_SECRET. In production these services also sit on a private Railway
// network unreachable from outside, so this is a second layer, not the
// only one.
function secret(): string {
  return process.env.INTERNAL_SERVICE_SECRET || "dev-secret-do-not-use-in-production";
}

export function requireInternalSecret(req: Request, res: Response, next: NextFunction) {
  const provided = req.header("x-internal-secret");
  if (!provided || provided !== secret()) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}
