import { signSessionToken, verifySessionToken, type SessionPayload } from "@relay/shared";

// Read lazily, not as a top-level const — see db.ts's pool() for why.
function secret(): string {
  return process.env.JWT_SECRET || "dev-secret-do-not-use-in-production";
}

export function signSession(userId: string): string {
  return signSessionToken(secret(), userId);
}

export function verifySession(token: string): SessionPayload {
  return verifySessionToken(secret(), token);
}
