import { verifySessionToken } from "@relay/shared";

function secret(): string {
  return process.env.JWT_SECRET || "dev-secret-do-not-use-in-production";
}

/** Verifies the JWT issued by auth-service. Returns the userId, or throws.
 *  Same pattern as messaging-service's auth.ts — every service verifies
 *  the shared-secret JWT independently, no network call to auth-service
 *  needed. */
export function verifySocketToken(token: string): string {
  return verifySessionToken(secret(), token).userId;
}
