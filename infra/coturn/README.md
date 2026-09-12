# coturn (TURN/STUN)

Local dev: `docker-compose.yml` at the repo root runs a coturn container with
throwaway credentials (`relay:relay`) — good enough for testing NAT traversal
on a LAN.

Production needs a real deployment with:

- a public static IP (UDP relay ports 49160-49200 must be reachable)
- TLS on the TURN listener (`turns:`) with a real certificate
- credentials minted per-session (short-lived, HMAC-based) rather than a
  shared static user/pass

This does not run well on Railway (UDP port range) — plan for a small
dedicated VM (e.g. a $5/mo box) or a managed TURN provider if self-hosting
becomes a maintenance burden.
