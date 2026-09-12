import jwt from "jsonwebtoken";

const EXPIRES_IN = "30d";

// Read lazily, not as a top-level const — see db.ts's pool() for why.
function secret(): string {
  return process.env.JWT_SECRET || "dev-secret-do-not-use-in-production";
}

export interface SessionPayload {
  userId: string;
}

export function signSession(userId: string): string {
  return jwt.sign({ userId } satisfies SessionPayload, secret(), { expiresIn: EXPIRES_IN });
}

export function verifySession(token: string): SessionPayload {
  return jwt.verify(token, secret()) as SessionPayload;
}
