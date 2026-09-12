import Constants from "expo-constants";

// Set in app.json under expo.extra.apiBaseUrl. The default (localhost) only
// works in the iOS simulator or web; a physical device running Expo Go needs
// your machine's LAN IP instead (e.g. http://192.168.1.42:4001) since
// "localhost" on the phone means the phone itself.
export const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) || "http://localhost:4001";
