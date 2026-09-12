import { verifySessionToken } from "@relay/shared";

function secret(): string {
  return process.env.JWT_SECRET || "dev-secret-do-not-use-in-production";
}

/** Verifies the JWT issued by auth-service. Returns the userId, or throws. */
export function verifySocketToken(token: string): string {
  return verifySessionToken(secret(), token).userId;
}
