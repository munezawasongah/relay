import sharp from "sharp";

const THUMBNAIL_WIDTH = 480;

/** Returns a JPEG thumbnail buffer for an image, or null for anything
 *  sharp can't read as an image (video included — video thumbnailing
 *  needs a frame extractor like ffmpeg, deliberately not built here; see
 *  README's media-service section for why that's an open follow-up rather
 *  than a silent gap). Null just means routes/media.ts skips
 *  thumbnail_key for that upload — never a failure of the upload itself. */
export async function generateThumbnail(buffer: Buffer, mimeType: string): Promise<Buffer | null> {
  if (!mimeType.startsWith("image/")) return null;
  try {
    return await sharp(buffer)
      .resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
  } catch (err) {
    console.warn("[media-service] thumbnail generation failed, continuing without one", err);
    return null;
  }
}
