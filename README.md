# Relay

Cross-platform messaging app — text, photo/video sharing, voice/video calling.
Built per `Relay: Architecture & MVP Scope`.

Deployment target: **Railway** (compute) + **Cloudflare** (DNS, CDN, R2 storage).

## Monorepo layout

```
relay/
  apps/
    mobile/                  # React Native (Expo) client — iOS/Android
    web/                     # React web client (Vite)
  services/
    auth-service/            # OTP issuance/verification, JWT sessions, device registration
    messaging-service/       # WebSocket fan-out, presence, receipts
    media-service/           # Upload handling, transcode/thumbnail, R2 writes
    call-signaling-service/  # WebRTC signaling (offer/answer/ICE), LiveKit room management
    push-service/            # FCM / APNs delivery
  packages/
    shared/                  # Shared TypeScript types/utilities across services + clients
  infra/
    railway/                 # Railway service configs / notes
    coturn/                  # TURN/STUN server config
    livekit/                 # LiveKit SFU config
```

## Local development

Prerequisites: Node.js >= 20, Docker Desktop (for Postgres/Redis/coturn).

```bash
npm install
npm run infra:up        # starts Postgres + Redis + coturn
cp .env.example .env    # then fill in secrets
```

Run a service:

```bash
npm run dev:auth
```

Run the web client:

```bash
npm run dev:web
```

Run the mobile client (Expo):

```bash
npm run dev:mobile
```

## Build status

Tracking against the phased build plan in the architecture doc:

- [x] Phase 0 — repo scaffold
- [ ] Phase 0 — Auth service + Postgres schema
- [ ] Phase 0 — React Native shell + navigation
- [ ] Phase 1 — Core messaging
- [ ] Phase 1 — E2E encryption (Signal Protocol)
- [ ] Phase 1 — Media service
- [ ] Phase 1 — Push notifications
- [ ] Phase 2 — 1:1 calling (WebRTC)
- [ ] Phase 2 — Group calls (LiveKit)
- [ ] Phase 3 — Hardening
- [ ] Phase 4 — Private beta
