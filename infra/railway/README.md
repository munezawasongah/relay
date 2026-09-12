# Railway deployment notes

Each service in `services/*` deploys as its own Railway service (independently
scalable per the architecture doc's guiding principles).

Planned Railway services:

| Railway service | Source | Start command |
|---|---|---|
| relay-auth | `services/auth-service` | `npm run start -w services/auth-service` |
| relay-messaging | `services/messaging-service` | `npm run start -w services/messaging-service` |
| relay-media | `services/media-service` | `npm run start -w services/media-service` |
| relay-call-signaling | `services/call-signaling-service` | `npm run start -w services/call-signaling-service` |
| relay-push | `services/push-service` | `npm run start -w services/push-service` |
| relay-postgres | Railway Postgres plugin | — |
| relay-redis | Railway Redis plugin | — |

Each service needs `npm run build -w <service>` as its build command, and the
root `.env` variables (see `.env.example`) set per-service in the Railway
dashboard. Cloudflare sits in front as the API gateway (DNS + TLS + routing to
each Railway service's public URL).

LiveKit and coturn are not Railway-native — they're best run as their own
Railway Docker deployments (see `infra/livekit/README.md` and
`infra/coturn/README.md`) or on a small dedicated VM, since they need UDP port
ranges that Railway's HTTP-oriented networking doesn't expose well.
