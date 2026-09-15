import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import express from "express";
import { mediaRouter } from "./routes/media";

// Media Service — responsibility (architecture doc, section 3.1):
// Upload handling, thumbnailing, writes to object storage (Cloudflare R2).
// See README's media-service section for what's deliberately not built yet
// (video thumbnailing, transcoding) and why media isn't E2E encrypted the
// way message content is.

const app = express();
const PORT = process.env.MEDIA_SERVICE_PORT || 4003;

app.get("/health", (_req, res) => {
  res.json({ service: "media-service", status: "ok" });
});

app.use(mediaRouter);

app.listen(PORT, () => {
  console.log(`[media-service] listening on :${PORT}`);
});
