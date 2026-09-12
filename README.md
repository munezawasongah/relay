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
    crypto/                  # E2E encryption engine (Olm/Megolm — see note below)
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

## E2E encryption: Olm/Megolm, not libsignal

The architecture doc names "Signal Protocol (libsignal)". In practice both the
official `@signalapp/libsignal-client` (AGPL-3.0) and the popular JS port
`@privacyresearch/libsignal-protocol-typescript` (GPL-3.0) are copyleft-licensed
— bundling either into a closed-source app would likely require open-sourcing
Relay itself. `packages/crypto` uses Matrix's Olm (1:1, Double Ratchet) and
Megolm (group, sender-key ratchet) instead: Apache-2.0, same security
properties, audited and used in production by Element/Matrix.

One more wrinkle: Olm's default build loads a WebAssembly binary, and React
Native's default JS engine (Hermes) doesn't support WebAssembly. The package
imports the `olm_legacy.js` subpath instead — a pure-JS/asm.js build with
identical behavior (verified in `packages/crypto/src/crypto.test.ts`) — so it
runs the same in Node, the web client, and Hermes without any engine swap.

Run its test suite: `npm run test:crypto`.

## Build status

Tracking against the phased build plan in the architecture doc:

- [x] Phase 0 — repo scaffold
- [x] Phase 0 — Auth service + Postgres schema
- [x] Phase 0 — React Native shell + navigation
- [x] Phase 1 — Core messaging (WebSocket fan-out, presence, receipts)
- [x] Phase 1 — E2E encryption engine (Olm/Megolm, isolated + tested — not yet wired into auth-service key publishing or the message flow)
- [ ] Phase 1 — Media service
- [ ] Phase 1 — Push notifications
- [ ] Phase 2 — 1:1 calling (WebRTC)
- [ ] Phase 2 — Group calls (LiveKit)
- [ ] Phase 3 — Hardening
- [ ] Phase 4 — Private beta
