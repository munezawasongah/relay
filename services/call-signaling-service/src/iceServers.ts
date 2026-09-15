import type { IceServerConfig } from "@relay/shared";

// Google's public STUN is fine for discovering a client's own reflexive
// address (free, no auth, industry-standard fallback) — it's TURN that
// actually needs to be ours, since that's what relays media when a direct
// P2P path fails.
const PUBLIC_STUN: IceServerConfig = { urls: "stun:stun.l.google.com:19302" };

/** Static/shared TURN credentials (matching the docker-compose dev coturn
 *  container's `--user=relay:relay`) — NOT what the infra/coturn README's
 *  "Production needs" section calls for (short-lived, per-session HMAC
 *  credentials instead of one shared static user/pass). That's a real,
 *  documented follow-up: minting per-session credentials needs coturn
 *  configured with a shared secret (`--use-auth-secret`) and this function
 *  computing an HMAC-SHA1 username/password pair per RFC 5766 Section 10.
 *  Static credentials are an acceptable MVP simplification (same
 *  reasoning as this project's other "good enough for now, documented"
 *  calls) but a real one — a leaked static TURN password is a standing
 *  relay-abuse risk, unlike a credential that expires in an hour. */
export function getIceServers(): IceServerConfig[] {
  const servers: IceServerConfig[] = [PUBLIC_STUN];

  const turnUrl = process.env.TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: process.env.TURN_USERNAME || "relay",
      credential: process.env.TURN_PASSWORD || "relay",
    });
  }

  return servers;
}
