import crypto from "crypto";
import { Router } from "express";
import multer from "multer";
import type { MediaInfo } from "@relay/shared";
import { findMediaObjectById, insertMediaObject, userCanAccessMedia } from "../db";
import { requireAuth, type AuthedRequest } from "../middleware/requireAuth";
import { putObject, signedGetUrl } from "../r2";
import { generateThumbnail } from "../thumbnail";

export const mediaRouter = Router();

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB — an MVP placeholder, not from the architecture doc
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } });

async function toMediaInfo(row: {
  id: string;
  r2_key: string;
  mime_type: string;
  size_bytes: string;
  thumbnail_key: string | null;
}): Promise<MediaInfo> {
  const [downloadUrl, thumbnailUrl] = await Promise.all([
    signedGetUrl(row.r2_key),
    row.thumbnail_key ? signedGetUrl(row.thumbnail_key) : Promise.resolve(undefined),
  ]);
  return {
    id: row.id,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    downloadUrl,
    thumbnailUrl,
  };
}

mediaRouter.post("/media", requireAuth, upload.single("file"), async (req: AuthedRequest, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "no_file" });
  }

  const mediaId = crypto.randomUUID();
  const extension = (req.file.originalname.split(".").pop() || "bin").toLowerCase();
  const r2Key = `media/${mediaId}/original.${extension}`;

  try {
    await putObject(r2Key, req.file.buffer, req.file.mimetype);

    let thumbnailKey: string | undefined;
    const thumbnail = await generateThumbnail(req.file.buffer, req.file.mimetype);
    if (thumbnail) {
      thumbnailKey = `media/${mediaId}/thumb.jpg`;
      await putObject(thumbnailKey, thumbnail, "image/jpeg");
    }

    const row = await insertMediaObject({
      r2Key,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      thumbnailKey,
      uploaderId: req.userId!,
    });

    res.json(await toMediaInfo(row));
  } catch (err) {
    console.error("[media-service] upload failed", err);
    res.status(500).json({ error: "upload_failed" });
  }
});

mediaRouter.get("/media/:id", requireAuth, async (req: AuthedRequest, res) => {
  const row = await findMediaObjectById(req.params.id);
  if (!row) {
    return res.status(404).json({ error: "not_found" });
  }
  const allowed = await userCanAccessMedia(req.params.id, req.userId!);
  if (!allowed) {
    return res.status(403).json({ error: "not_a_member" });
  }
  res.json(await toMediaInfo(row));
});
