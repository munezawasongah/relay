import crypto from "crypto";
import { redis } from "./redis";

const MAX_ATTEMPTS = 5;

// Read lazily (not as a top-level const) for the same reason db.ts's pool()
// and redis.ts's redis() are lazy: avoid reading env before dotenv.config() runs.
function ttlSeconds(): number {
  return Number(process.env.OTP_TTL_SECONDS || 300);
}

function keyFor(phoneNumber: string): string {
  return `otp:${phoneNumber}`;
}

function attemptsKeyFor(phoneNumber: string): string {
  return `otp:attempts:${phoneNumber}`;
}

function hash(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/** Generates a 6-digit code, stores its hash in Redis with a TTL, and returns the plaintext
 *  code so the caller can hand it to the SMS provider (or, in dev, log/return it directly). */
export async function issueOtp(phoneNumber: string): Promise<string> {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  await redis().set(keyFor(phoneNumber), hash(code), "EX", ttlSeconds());
  await redis().del(attemptsKeyFor(phoneNumber));
  return code;
}

export type VerifyResult = "ok" | "expired_or_missing" | "mismatch" | "too_many_attempts";

export async function verifyOtp(phoneNumber: string, code: string): Promise<VerifyResult> {
  const attempts = await redis().incr(attemptsKeyFor(phoneNumber));
  if (attempts === 1) {
    await redis().expire(attemptsKeyFor(phoneNumber), ttlSeconds());
  }
  if (attempts > MAX_ATTEMPTS) {
    return "too_many_attempts";
  }

  const storedHash = await redis().get(keyFor(phoneNumber));
  if (!storedHash) {
    return "expired_or_missing";
  }
  if (storedHash !== hash(code)) {
    return "mismatch";
  }

  await redis().del(keyFor(phoneNumber));
  await redis().del(attemptsKeyFor(phoneNumber));
  return "ok";
}

/** Placeholder SMS delivery. Wire up a real provider (e.g. Africa's Talking, Twilio)
 *  via SMS_PROVIDER_API_KEY before this leaves development. */
export async function sendSms(phoneNumber: string, code: string): Promise<void> {
  if (!process.env.SMS_PROVIDER_API_KEY) {
    console.log(`[auth-service] (dev) OTP for ${phoneNumber}: ${code}`);
    return;
  }
  // TODO: call the real SMS provider here.
  console.log(`[auth-service] SMS provider configured but not yet implemented; OTP for ${phoneNumber}: ${code}`);
}
