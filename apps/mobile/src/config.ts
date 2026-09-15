import Constants from "expo-constants";

// Set in app.json under expo.extra.apiBaseUrl. The default (localhost) only
// works in the iOS simulator or web; a physical device running Expo Go needs
// your machine's LAN IP instead (e.g. http://192.168.1.42:4001) since
// "localhost" on the phone means the phone itself.
export const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) || "http://localhost:4001";

// Same physical-device caveat as API_BASE_URL above — set
// expo.extra.messagingBaseUrl in app.json to your machine's LAN IP for
// Expo Go on a real device.
export const MESSAGING_BASE_URL: string =
  (Constants.expoConfig?.extra?.messagingBaseUrl as string | undefined) || "http://localhost:4002";

export const MEDIA_BASE_URL: string =
  (Constants.expoConfig?.extra?.mediaBaseUrl as string | undefined) || "http://localhost:4003";
