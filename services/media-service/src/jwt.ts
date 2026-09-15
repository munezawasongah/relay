import { verifySessionToken } from "@relay/shared";

// Same pattern as auth-service/src/jwt.ts and messaging-service/src/auth.ts:
// every service verifies the session JWT itself (same JWT_SECRET), rather
// than calling auth-service over the network on every request.

function secret(): string {
  return process.env.JWT_SECRET || "dev-secret-do-not-use-in-production";
}

export function verifyToken(token: string): string {
  return verifySessionToken(secret(), token).userId;
}
