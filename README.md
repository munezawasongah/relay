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

### Push notifications

Wires up the other half of the architecture doc's message flow (section 3.2):
"if offline, persists to PostgreSQL and **triggers a push notification**." The
device-registration endpoint this depends on (`POST /devices/register`) and
its `devices.push_token`/`platform` columns already existed from the Phase 0
scaffold — this phase is what actually calls it and acts on it.

**One simplification worth flagging**, the same way the Olm-vs-libsignal
choice is flagged above: the doc's tech-stack table lists two separate
delivery paths, "FCM (Android)" and "APNs (iOS)". `push-service` uses one —
Firebase Cloud Messaging — for both. A Firebase project configured with an
iOS app's APNs auth key (in the Firebase console, not this codebase — see
`.env.example`'s `APNS_*` comments) forwards FCM sends to APNs automatically,
so one `firebase-admin` integration covers both platforms with the same
wire-level result. Raw/direct APNs is still the right call for Phase 2's VoIP
call-wake push specifically (it needs delivery guarantees standard FCM
doesn't make) — that's untouched here and still open.

`services/messaging-service`'s `message:send` handler now figures out, per
send, which OTHER members of the conversation are currently connected
(tracked via each socket's own `data.userId`, not just "is anyone else in the
room" — the old proxy the `deliveredNow` flag used, which happens to give the
same answer for a 2-person conversation but wouldn't for a group). Whoever
isn't connected gets a fire-and-forget call to `push-service`'s
`POST /push/message`, made *after* the sender's own ack — a slow push call
should never delay the send confirmation, and a push failure should never
look like the message itself failed, since by that point it's already
persisted and fanned out to whoever IS online.

`services/push-service` looks up that recipient's registered devices
(`devices` table, one row per platform — a phone signed in on both a tablet
and a handset gets both) and sends through `firebase-admin`. The notification
body is deliberately generic — `"<sender display name>: Sent you a message"`
— because the server never has message plaintext to put there; that's the
whole point of the E2E encryption built earlier. It's called with a shared-
secret header (`x-internal-secret`, same MVP pattern as `JWT_SECRET`) since
it's the first service-to-service call in this codebase and has no per-user
JWT to check — there's no client-facing auth story here because no client
ever calls it directly. A token FCM reports as dead (uninstalled app, rotated
token) gets cleared from that device's row so it isn't retried forever; the
device re-registers a fresh one next time it opens the app.

`apps/mobile/src/notifications/push.ts` (wired into `AuthContext`, same
best-effort/non-blocking spot as `ensureKeysPublished`) requests notification
permission and fetches the **raw** platform push token via
`Notifications.getDevicePushTokenAsync()` — deliberately not Expo's own
abstracted `ExponentPushToken[...]` from `getExpoPushTokenAsync()`, since the
doc calls for raw FCM/APNs delivery and that's what `push-service` expects.

**Real, unavoidable limitation, not an oversight**: getting an actual token
back needs a physical device and a build with a real Firebase project's
config baked in (`google-services.json` / `GoogleService-Info.plist`) via EAS
Build — Expo Go can't produce one, and this sandbox has neither a physical
device nor a Firebase project to test against. What *was* verified live
before committing, with real running services and no mocks: sending a
message to a genuinely-offline recipient correctly skips `deliveredAt`,
correctly triggers exactly one call to `push-service` naming the right
recipient, `push-service` correctly finds that recipient's registered
device and logs what it would have sent; sending to a recipient who's
actually connected correctly sets `deliveredAt` and triggers no push at all;
and calling `push-service` without the shared secret (or with the wrong one)
is correctly rejected with 401. What's left unverified is the one piece
nothing in this sandbox could ever verify: an actual FCM/APNs delivery to a
real device.

## Calling (Phase 2, 1:1 only)

Starts Phase 2 with exactly what the doc scopes first: 1:1 voice/video via
peer-to-peer WebRTC with TURN fallback (section 3.3). Group calls (LiveKit
SFU, 4-8 participants) are their own separate slice of work — `livekit-server-sdk`
has sat unused in `call-signaling-service`'s dependencies since the Phase 0
scaffold, and stays unused until that slice happens.

**Also deliberately not built yet**: "Call notifications" — the doc's own
Phase 2 feature table lists this as its own bullet, distinct from "1:1
voice/video calls", and for good reason: it needs VoIP push (`PushKit` on
iOS specifically, not a normal notification) to wake an app that's fully
closed, which is a real native-module undertaking beyond what Expo's
managed workflow gives you for free — unlike the standard push notifications
built in the previous phase. Practical effect right now: calling only works
between two people who both already have the app open (connected to
`call-signaling-service`'s socket) — `call:invite` on a callee with no
active connection is rejected outright with `callee_unreachable` rather than
ringing into a void nothing would ever wake up. `ChatScreen`'s call buttons
surface that as a plain "isn't online right now" alert.

`services/call-signaling-service` is socket.io-based, same shape as
`messaging-service`: JWT-in-handshake auth, a room per signed-in user. REST
isn't used here at all — every part of a call (invite, accept, decline,
hangup, SDP offer/answer, ICE candidates) goes over the socket, mirroring
how `messaging-service`'s live path works, since call setup is exactly as
live/bidirectional as messaging is. `calls` (schema, Phase 0) already had
everywhere this needed to land — `status` transitions are guarded
(`transitionCall`'s `expectedCurrentStatus` check) the same way
`markMessageRead`'s `read_at` guard prevents acting twice on one row.

Three status outcomes worth being precise about, since the schema only
gives you `ended`/`missed`/`declined` to work with: **declined** is the
callee explicitly rejecting a still-ringing call; **missed** is a call that
ends while still `ringing` for any other reason (caller cancels before
answer, or — see below — a participant's connection just drops); **ended**
is a call that had actually gone `active` and then finished normally. A
participant's app crashing or losing connection mid-call is handled too:
`call-signaling-service`'s `disconnect` handler checks whether that was the
user's last connected socket, and if they had an in-progress call, ends it
and tells the other side — otherwise the other participant's screen would
just sit there forever with no signal anything went wrong.

TURN credentials are **static** (`relay:relay`, matching the docker-compose
dev coturn container) via `iceServers.ts`, not the per-session HMAC
credentials `infra/coturn/README.md`'s "Production needs" section calls
for. Same category of documented MVP simplification as this project's other
"good enough for now" calls, but a real one — a leaked static TURN password
is a standing relay-abuse risk in a way a credential that expires in an
hour isn't.

Mobile (`apps/mobile/src/calling/`): `CallContext` owns both the
call-signaling socket and the WebRTC `RTCPeerConnection` for the life of a
signed-in session, sitting above the navigator in `App.tsx` — an incoming
call can land while the user's on any screen, not just a chat, so it can't
live inside a single screen's component tree. It pushes `CallScreen`
through a navigation ref (`navigation/navigationRef.ts`, the standard React
Navigation pattern for navigating from outside a screen) rather than a
normal `navigation` prop. The signaling choreography (who creates the offer
and when, and why both the offer and ICE candidates need to be buffered
against arriving before there's a peer connection to hand them to yet) is
laid out in `CallContext`'s own file comment — worth reading before
touching it, same as `messageCache.ts`'s comment for the messaging side.

**Real, unavoidable limitation, not an oversight, same category as push
notifications' real-device requirement**: `react-native-webrtc` needs
native code Expo Go can't provide — a real build (EAS Build or
`expo prebuild`) is required, which this sandbox can't produce or run, and
there's no physical device or second peer to actually place a call between
here either. What *was* verified live before committing, against the real
running stack (Postgres + all four other services, no mocks, using
`socket.io-client` to script two real signed-up users through the whole
protocol): a callee with no active connection is correctly turned away with
`callee_unreachable`; a full call — invite, `call:incoming` delivered with
the caller's real display name and ICE servers, accept, SDP offer relayed,
SDP answer relayed, an ICE candidate relayed, and a clean hangup — round-
trips correctly end to end with the right `call:ended` reason; a decline
produces `reason: "declined"` and the initiator is correctly blocked from
declining their own call; a caller cancelling before answer produces
`reason: "missed"`; inviting to a real group conversation (inserted
directly for the test, since there's no group-chat UI to create one through)
is correctly rejected as unsupported; inviting to a conversation the caller
isn't a member of is correctly rejected; and a participant's socket
disconnecting abruptly mid-call (simulating a crash) correctly ends the call
and notifies the other side. What's left unverified is the same shape of gap
as calling's mobile build in general: actual audio/video flowing between two
real devices.

## Build status

Tracking against the phased build plan in the architecture doc:

- [x] Phase 0 — repo scaffold
- [x] Phase 0 — Auth service + Postgres schema
- [x] Phase 0 — React Native shell + navigation
- [x] Phase 1 — Core messaging (WebSocket fan-out, presence, receipts)
- [x] Phase 1 — E2E encryption engine (Olm/Megolm) — wired into auth-service key publishing and the live 1:1 message flow (ChatScreen); group-chat encryption still open
- [x] Phase 1 — Media service — upload/thumbnail/access-controlled retrieval, wired into ChatScreen; not E2E encrypted (by design, see above), video thumbnailing/transcoding still open
- [x] Phase 1 — Push notifications — offline-message push pipeline (messaging-service -> push-service -> FCM) end to end; actual FCM/APNs delivery to a real device unverifiable without a real Firebase project (see above)
- [x] Phase 2 — 1:1 calling (WebRTC) — signaling + peer-to-peer media fully built and wired into ChatScreen; VoIP call-notification push and an actual on-device test both still open (see above)
- [ ] Phase 2 — Group calls (LiveKit)
- [ ] Phase 3 — Hardening
- [ ] Phase 4 — Private beta
