import type { User } from "@relay/shared";
import { apiRequest } from "./client";

export interface OtpRequestResponse {
  ok: true;
  devCode?: string; // present only when the auth-service is running outside production
}

export function requestOtp(phoneNumber: string): Promise<OtpRequestResponse> {
  return apiRequest("/otp/request", { method: "POST", body: { phoneNumber } });
}

export interface OtpVerifyResponse {
  token: string;
  user: User;
}

export function verifyOtp(
  phoneNumber: string,
  code: string,
  displayName?: string
): Promise<OtpVerifyResponse> {
  return apiRequest("/otp/verify", { method: "POST", body: { phoneNumber, code, displayName } });
}

export function fetchMe(token: string): Promise<User> {
  return apiRequest("/users/me", { token });
}

export function registerDevice(
  token: string,
  platform: "ios" | "android" | "web",
  pushToken?: string
): Promise<{ ok: true }> {
  return apiRequest("/devices/register", { method: "POST", token, body: { platform, pushToken } });
}
