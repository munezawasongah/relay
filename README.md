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

### Key publishing (auth-service)

X3DH-style prekey bundles now have somewhere to live: `db/migrations/0002_prekeys.sql`
adds a `one_time_prekeys` table (the long-term identity key reuses the existing
`users.public_key` column — one identity key per user, not per device, matching
`packages/crypto`'s deliberate MVP simplification of deferring multi-device
fan-out). `services/auth-service/src/routes/keys.ts` exposes:

- `POST /keys/identity` — publish/replace this user's identity key
- `POST /keys/one-time` — top up the one-time-key pool (idempotent — republishing an
  already-stored key id is a no-op)
- `GET /keys/one-time/count` — so a client knows when to top up
- `GET /keys/bundle/:userId` — the piece a client needs before starting a new 1:1
  session with `userId`: their identity key plus one atomically-claimed one-time key
  (`FOR UPDATE SKIP LOCKED`, so it's handed out exactly once even under concurrent
  requests). Responds `404 identity_key_not_published` if that user hasn't published
  an identity key yet, or `409 no_one_time_keys_available` if their pool is
  temporarily empty — both real, expected states a caller needs to handle, not bugs.

`apps/mobile/src/crypto/` wires the client side of this in: `bootstrap.ts` generates
a per-device pickle key (native CSPRNG, stored in `expo-secure-store`, never sent to
the server), initializes `RelayCrypto`, and calls `ensureKeysPublished()` on sign-in
and on session restore — idempotent and best-effort, so a flaky network doesn't block
login. `store.ts` is the `CryptoStore` implementation backed by `expo-secure-store`
(see its file comment for a real known limitation: iOS caps individual values at
2048 bytes, and the account pickle grows with the one-time-key pool).

Still open: the live message send/receive path (mobile has no chat UI or
messaging-service WebSocket client yet — `ChatScreen` is still a placeholder) doesn't
call `encryptToUser`/`decryptFromUser` yet. That's the next piece of "wire it into
the message flow."

## Build status

Tracking against the phased build plan in the architecture doc:

- [x] Phase 0 — repo scaffold
- [x] Phase 0 — Auth service + Postgres schema
- [x] Phase 0 — React Native shell + navigation
- [x] Phase 1 — Core messaging (WebSocket fan-out, presence, receipts)
- [x] Phase 1 — E2E encryption engine (Olm/Megolm, isolated + tested) — wired into auth-service key publishing; not yet wired into the live message flow (no chat UI/WebSocket client in the mobile app yet)
- [ ] Phase 1 — Media service
- [ ] Phase 1 — Push notifications
- [ ] Phase 2 — 1:1 calling (WebRTC)
- [ ] Phase 2 — Group calls (LiveKit)
- [ ] Phase 3 — Hardening
- [ ] Phase 4 — Private beta
