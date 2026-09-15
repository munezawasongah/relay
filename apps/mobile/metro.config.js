// react-native-webrtc depends on event-target-shim@6, but React Native
// itself ships event-target-shim@5 and Metro's default module resolution
// would hand react-native-webrtc the v5 copy (incompatible API) instead.
// This is react-native-webrtc's own documented fix for Expo SDK 50+ (see
// @config-plugins/react-native-webrtc's README) — not something specific
// to this project, just required wiring for that dependency to work at all.
const { getDefaultConfig } = require("expo/metro-config");
const resolveFrom = require("resolve-from");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith("event-target-shim") && context.originModulePath.includes("react-native-webrtc")) {
    const eventTargetShimPath = resolveFrom(context.originModulePath, moduleName);
    return { filePath: eventTargetShimPath, type: "sourceFile" };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
