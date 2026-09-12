import "dotenv/config";
import express from "express";

// Media Service — responsibility (architecture doc, section 3.1):
// Upload handling, transcoding/thumbnailing, writes to object storage (Cloudflare R2).

const app = express();
const PORT = process.env.MEDIA_SERVICE_PORT || 4003;

app.get("/health", (_req, res) => {
  res.json({ service: "media-service", status: "ok" });
});

// TODO(Phase 1): POST /media/upload   - accept compressed photo/video, write to R2
// TODO(Phase 1): thumbnail generation pipeline for images/video
// TODO(Phase 1): GET  /media/:id      - signed URL / CDN redirect for playback

app.listen(PORT, () => {
  console.log(`[media-service] listening on :${PORT}`);
});
