import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { registerDevice } from "../api/auth";

// A NOTE ON WHAT THIS ACTUALLY GETS: getDevicePushTokenAsync() returns the
// raw platform token (an FCM registration token on Android, an APNs device
// token on iOS) — NOT Expo's own abstracted "ExponentPushToken[...]" from
// getExpoPushTokenAsync(). The architecture doc specifies raw FCM/APNs
// delivery (see push-service's fcm.ts), so this is the one that matters
// here. The real, unavoidable catch: getting a genuine token back requires
// a physical device signed into push notifications AND this app built with
// its own Firebase project's config (google-services.json /
// GoogleService-Info.plist) baked in via EAS Build — Expo Go can't produce
// one, and there is no way to fully exercise this path in a sandbox with no
// device and no Firebase project. This file is written to be correct for
// that real build; it just can't be end-to-end verified here (see the
// README's "Push notifications" section).

// Foreground notifications still show a banner/sound instead of doing
// nothing — without this handler, expo-notifications defaults to silent.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function currentPlatform(): "ios" | "android" | "web" | null {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  if (Platform.OS === "web") return "web";
  return null;
}

/** Best-effort: requests permission, grabs the device's raw push token, and
 *  registers it with auth-service (POST /devices/register, already built
 *  in Phase 0 — see api/auth.ts's registerDevice). Every failure mode here
 *  (permission denied, simulator/emulator, no physical device, Expo Go
 *  without a dev build) is expected and silently skipped rather than
 *  thrown — same "best-effort, non-blocking" reasoning as
 *  ensureKeysPublished in crypto/bootstrap.ts, called the same way from
 *  AuthContext. */
export async function registerForPushNotifications(token: string): Promise<void> {
  const platform = currentPlatform();
  if (!platform) return;

  if (!Device.isDevice) {
    console.log("[push] skipping registration — simulator/emulator, not a physical device");
    return;
  }

  try {
    if (platform === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let status = existingStatus;
    if (status !== "granted") {
      const result = await Notifications.requestPermissionsAsync();
      status = result.status;
    }
    if (status !== "granted") {
      console.log("[push] permission not granted, skipping device registration");
      return;
    }

    const { data: pushToken } = await Notifications.getDevicePushTokenAsync();
    await registerDevice(token, platform, pushToken);
  } catch (err) {
    // Expected in Expo Go / without a real Firebase project baked into the
    // build — see the file comment above.
    console.warn("[push] registerForPushNotifications failed (expected without a real device build)", err);
  }
}
