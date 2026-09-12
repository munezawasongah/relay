import type {
  KeyBundleResponse,
  OneTimeKeyCountResponse,
  PublishOneTimeKeysResponse,
} from "@relay/shared";
import { apiRequest } from "./client";

export function publishIdentityKey(token: string, identityKey: string): Promise<{ ok: true }> {
  return apiRequest("/keys/identity", { method: "POST", token, body: { identityKey } });
}

export function publishOneTimeKeys(
  token: string,
  oneTimeKeys: Record<string, string>
): Promise<PublishOneTimeKeysResponse> {
  return apiRequest("/keys/one-time", { method: "POST", token, body: { oneTimeKeys } });
}

export function fetchOneTimeKeyCount(token: string): Promise<OneTimeKeyCountResponse> {
  return apiRequest("/keys/one-time/count", { token });
}

/** Throws ApiError(409) if the peer is temporarily out of one-time keys —
 *  callers should surface "can't start this chat right now, try again
 *  shortly" rather than silently sending unencrypted or failing weirdly. */
export function fetchKeyBundle(token: string, userId: string): Promise<KeyBundleResponse> {
  return apiRequest(`/keys/bundle/${userId}`, { token });
}
