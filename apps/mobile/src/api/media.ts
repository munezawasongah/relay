import type { MediaInfo } from "@relay/shared";
import { MEDIA_BASE_URL } from "../config";
import { ApiError } from "./client";

/** Uploads a picked file to media-service. RN's FormData accepts a plain
 *  {uri, name, type} object in place of a Blob — fetch's polyfill in RN
 *  reads directly from the file:// / ph:// / content:// uri, no manual
 *  base64 step needed. */
export async function uploadMedia(
  token: string,
  file: { uri: string; name: string; mimeType: string }
): Promise<MediaInfo> {
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);

  const res = await fetch(`${MEDIA_BASE_URL}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as MediaInfo;
}

export async function fetchMediaInfo(token: string, mediaId: string): Promise<MediaInfo> {
  const res = await fetch(`${MEDIA_BASE_URL}/media/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new ApiError(res.status, data);
  }
  return data as MediaInfo;
}
