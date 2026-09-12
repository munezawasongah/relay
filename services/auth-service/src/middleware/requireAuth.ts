import type { NextFunction, Request, Response } from "express";
import { verifySession } from "../jwt";

export interface AuthedRequest extends Request {
  userId?: string;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing_bearer_token" });
  }
  try {
    const { userId } = verifySession(header.slice("Bearer ".length));
    req.userId = userId;
    next();
  } catch {
    return res.status(401).json({ error: "invalid_or_expired_token" });
  }
}
