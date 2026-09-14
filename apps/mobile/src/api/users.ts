import type { PublicUser } from "@relay/shared";
import { apiRequest } from "./client";

/** Stand-in for real contacts sync (architecture doc's "Contacts: sync from
 *  device contact list" — a separate, not-yet-built Phase 1 item). Throws
 *  ApiError(404) if no registered user has that phone number. */
export function lookupUserByPhone(token: string, phoneNumber: string): Promise<PublicUser> {
  return apiRequest(`/users/by-phone/${encodeURIComponent(phoneNumber)}`, { token });
}
