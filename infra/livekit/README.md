# LiveKit (SFU)

Used for group calls (4-8 participants) per the architecture doc — 1:1 calls
stay peer-to-peer WebRTC with TURN fallback and don't need the SFU.

Self-hosting: run LiveKit's official Docker image with a generated
`livekit.yaml` (API key/secret referenced by `call-signaling-service` via
`LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in `.env`). Like
coturn, this needs UDP port access that Railway doesn't provide well — plan to
run it on a dedicated VM, or use LiveKit Cloud for the MVP to avoid ops
overhead until call volume justifies self-hosting.

This step is called out explicitly in the doc's "Immediate Next Steps":
stand up an instance early, before the calling UI exists, to validate
self-hosting and cost.
