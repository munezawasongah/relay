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

### Live message flow (ChatScreen)

The other half is wired in now. `services/messaging-service` grew a small REST
surface alongside its socket.io server (same `app`, same port) — the WebSocket side
was already server-blind (content only ever travels as opaque `ciphertext`); this is
what a client needs before it can use that live path at all:

- `GET /conversations` — the caller's conversations, with (for direct conversations)
  the other member's public info and last-message *metadata* (id/sender/timestamp,
  never content — see ChatListScreen's file comment for why not)
- `GET /conversations/:conversationId/messages` — history, membership-checked
- `POST /conversations/direct` — find-or-create a direct conversation with another
  user by id (guarded by a Postgres advisory lock keyed to the pair, so two people
  starting a chat with each other at the same instant can't end up with two separate
  conversations)

`auth-service` grew one matching endpoint, `GET /users/by-phone/:phoneNumber` — a
stand-in for real contacts sync (still not built) just so a chat can be started at
all; `apps/mobile/src/screens/main/NewChatScreen.tsx` is the (minimal) UI for it.

`apps/mobile/src/messaging/` is the client wiring: `MessagingContext` owns one
socket.io connection per signed-in session; `useDirectConversation` is what
`ChatScreen` now actually runs on — it loads history, decrypts, sends, and receives,
live, for one 1:1 conversation. The one subtlety worth knowing before touching it:
**a device can't decrypt its own sent messages** (Double Ratchet sessions have
separate send/receive chains — this isn't a bug to fix, it's how the protocol
works), and **an ordinary ratchet message can only be decrypted once, ever**
(decrypting advances the ratchet). `messaging/messageCache.ts` is the fix for both:
every message's plaintext is cached (via `AsyncStorage`) the moment it's known —
at send time for your own messages, immediately after the one legitimate decrypt for
the peer's — and both history load and live receive check that cache before ever
touching `decryptFromUser` again. Verified against the real running services (two
real users, real Olm sessions, real socket.io connections, key-bundle-fetch-on-first-
contact and all) before committing — not just typechecked.

Deliberately out of scope here: group conversations (Megolm session creation +
key distribution is real additional work — `useDirectConversation` only handles
`type: 'direct'`), and showing a decrypted last-message preview in `ChatListScreen`
(would mean decrypting speculatively outside of an open chat, which the "only once"
rule above makes unsafe the way this is currently built).

### Media service

Deliberately **not** end-to-end encrypted — the architecture doc's feature table
lists "E2E encryption" as covering message *content* specifically, and lists
"Media messages" as its own separate line with client-side compression, not
encryption; the schema backs that up too (`media_objects` has no key-material
column). So `media-service` sees plaintext bytes, which is exactly what lets it
generate thumbnails server-side. Only the message `text` field (the caption) goes
through Olm like everything else in the chat.

`db/migrations/0003_media_uploader.sql` adds `media_objects.uploader_id`. Storage
is Cloudflare R2 (S3-compatible, via `@aws-sdk/client-s3` — `R2_ENDPOINT_OVERRIDE`
exists purely so local dev/tests can point at a fake S3 server instead of a real
R2 bucket). `services/media-service/src/routes/media.ts` exposes:

- `POST /media` — multipart upload (25MB cap). Generates a JPEG thumbnail
  server-side for images (via `sharp`); video thumbnailing/transcoding is
  deliberately not built yet — it needs ffmpeg, which is real added
  infrastructure, not a code change. Returns a `MediaInfo` with presigned URLs.
- `GET /media/:id` — same `MediaInfo` shape, access-controlled: a media object is
  visible to whoever uploaded it, or to anyone in a conversation where some
  message's `mediaRef` now points at it. That "uploaded but not yet attached to a
  message" gap (the moment between finishing the upload and the client sending
  `message:send` with the resulting id) is exactly why `uploader_id` exists —
  without it there'd be a window where even the uploader gets a 403 on their own
  just-uploaded file.

Known limitation: presigned URLs expire after 5 minutes. A chat screen left open
longer than that won't currently refresh an already-loaded image's URL.

`apps/mobile/src/api/media.ts` (`uploadMedia`, `fetchMediaInfo`) and
`ChatScreen.tsx`'s new attachment button (`expo-image-picker`) are the client
side: pick a photo, upload it, then send a normal message whose `text` is empty
and whose `mediaRef` is the upload's id — `useDirectConversation`'s `sendText`
already handles a media-only send (an empty string still encrypts fine through
Olm, it's just zero-length plaintext, and the DB's `ciphertext` column stays
`NOT NULL` either way). Each message bubble with a `mediaRef` fetches that
object's URLs independently and renders the thumbnail (falling back to the full
image if none exists) — a deliberate choice to keep the messaging hook itself
completely unaware that media-service exists.

Verified against the real running services before committing: real Postgres, a
local fake-S3 server, and all three services live — upload, thumbnail
generation, download-URL round-trip to byte-identical bytes, the
uploader-vs-stranger-vs-post-message access transitions, and the exact
multipart shape the mobile client sends, end to end through a real socket.io
connection.

## Build status

Tracking against the phased build plan in the architecture doc:

- [x] Phase 0 — repo scaffold
- [x] Phase 0 — Auth service + Postgres schema
- [x] Phase 0 — React Native shell + navigation
- [x] Phase 1 — Core messaging (WebSocket fan-out, presence, receipts)
- [x] Phase 1 — E2E encryption engine (Olm/Megolm) — wired into auth-service key publishing and the live 1:1 message flow (ChatScreen); group-chat encryption still open
- [x] Phase 1 — Media service — upload/thumbnail/access-controlled retrieval, wired into ChatScreen; not E2E encrypted (by design, see above), video thumbnailing/transcoding still open
- [ ] Phase 1 — Push notifications
- [ ] Phase 2 — 1:1 calling (WebRTC)
- [ ] Phase 2 — Group calls (LiveKit)
- [ ] Phase 3 — Hardening
- [ ] Phase 4 — Private beta
