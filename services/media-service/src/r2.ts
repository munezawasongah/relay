import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Cloudflare R2 is S3-compatible (architecture doc section 4), so the
// regular AWS SDK works against it unmodified — just point it at R2's
// endpoint instead of AWS's. R2_ENDPOINT_OVERRIDE exists only so local dev
// (and this file's own smoke-testing) can point the same client at a fake
// S3 server instead of real R2 — never set it in production.
let _client: S3Client | undefined;
function client(): S3Client {
  if (!_client) {
    const endpoint =
      process.env.R2_ENDPOINT_OVERRIDE || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    _client = new S3Client({
      region: "auto",
      endpoint,
      forcePathStyle: !!process.env.R2_ENDPOINT_OVERRIDE,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return _client;
}

function bucket(): string {
  return process.env.R2_BUCKET || "relay-media";
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await client().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType })
  );
}

/** Time-limited GET URL — R2 objects here aren't public (architecture doc's
 *  Cloudflare-CDN-in-front-of-R2 delivery path is a production optimization
 *  for later; this MVP gates access at request time via routes/media.ts's
 *  membership check instead, so a plain public bucket would bypass that
 *  entirely). */
export function signedGetUrl(key: string, expiresInSeconds = 300): Promise<string> {
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
    expiresIn: expiresInSeconds,
  });
}
