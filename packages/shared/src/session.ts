import jwt from "jsonwebtoken";

// Shared between auth-service (issues tokens) and any service that needs to
// authenticate a request/socket without calling auth-service over the network
// (messaging-service's WebSocket handshake, in particular). Every caller must
// be configured with the same JWT_SECRET.

const EXPIRES_IN = "30d";

export interface SessionPayload {
  userId: string;
}

export function signSessionToken(secret: string, userId: string): string {
  return jwt.sign({ userId } satisfies SessionPayload, secret, { expiresIn: EXPIRES_IN });
}

export function verifySessionToken(secret: string, token: string): SessionPayload {
  return jwt.verify(token, secret) as SessionPayload;
}
