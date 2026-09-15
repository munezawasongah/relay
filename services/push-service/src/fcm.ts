import type { App } from "firebase-admin/app";
import { initializeApp, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

// One Firebase project's Cloud Messaging covers BOTH Android and iOS device
// tokens here, instead of the doc's literal "FCM (Android) + APNs (iOS)"
// being two separate integrations. When an iOS app is registered with
// Firebase and its APNs auth key is configured in the Firebase console
// (see .env.example's APNS_* comments), FCM forwards to APNs under the
// hood — same wire result, one SDK, one code path. Raw/direct APNs (no
// Firebase in the middle) is still the right call for Phase 2's VoIP call-
// wake push, which needs guarantees FCM's standard delivery doesn't make;
// that's untouched by this file.

let _app: App | undefined | null; // null = "checked, not configured"

function app(): App | null {
  if (_app !== undefined) return _app;

  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    console.warn(
      "[push-service] FCM_SERVICE_ACCOUNT_JSON not set — pushes will be logged, not delivered. " +
        "This is expected in local dev without a real Firebase project."
    );
    _app = null;
    return _app;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    _app = initializeApp({ credential: cert(serviceAccount) });
  } catch (err) {
    console.error("[push-service] FCM_SERVICE_ACCOUNT_JSON is set but invalid JSON — pushes will be logged, not delivered.", err);
    _app = null;
  }
  return _app;
}

export interface PushPayload {
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface SendResult {
  attempted: number;
  delivered: number;
  /** Tokens Firebase reported as dead (unregistered/invalid) — the caller
   *  should stop trying to push to these; see routes/push.ts. */
  deadTokens: string[];
}

/** Sends the same notification to every token. Never throws — a push
 *  failing is never a reason to fail the message send that triggered it
 *  (see routes/push.ts), so every failure mode here resolves to a result
 *  object instead. */
export async function sendPushToTokens(tokens: string[], payload: PushPayload): Promise<SendResult> {
  if (tokens.length === 0) {
    return { attempted: 0, delivered: 0, deadTokens: [] };
  }

  const firebaseApp = app();
  if (!firebaseApp) {
    console.log(`[push-service] (not configured) would push "${payload.title}: ${payload.body}" to ${tokens.length} device(s)`);
    return { attempted: tokens.length, delivered: 0, deadTokens: [] };
  }

  const messaging = getMessaging(firebaseApp);
  const response = await messaging.sendEachForMulticast({
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: payload.data,
  });

  const deadTokens: string[] = [];
  response.responses.forEach((r, i) => {
    if (!r.success && (r.error?.code === "messaging/registration-token-not-registered" || r.error?.code === "messaging/invalid-registration-token")) {
      deadTokens.push(tokens[i]);
    }
  });

  return { attempted: tokens.length, delivered: response.successCount, deadTokens };
}
