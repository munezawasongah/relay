import type { NextFunction, Request, Response } from "express";
import { verifySocketToken } from "../auth";

// HTTP-side twin of the WebSocket handshake auth in ../auth.ts (same JWT,
// same verify function) — mirrors auth-service's own requireAuth shape so
// the two services read the same way, even though they don't share code
// (deliberately: each service should be able to verify a session on its
// own, without a network call to auth-service on every request).

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing_bearer_token" });
  }
  try {
    req.userId = verifySocketToken(header.slice("Bearer ".length));
    next();
  } catch {
    return res.status(401).json({ error: "invalid_or_expired_token" });
  }
}
