import type { IceServerConfig } from "@relay/shared";
import { mediaDevices, MediaStream, RTCPeerConnection } from "react-native-webrtc";
import type { CallType } from "@relay/shared";

/** Asks for mic (audio calls) or mic+camera (video calls) and returns the
 *  local MediaStream to attach to the peer connection and render locally.
 *  Permission prompts are handled by the OS/react-native-webrtc itself —
 *  there's no separate expo-permissions step the way expo-image-picker or
 *  expo-notifications need. */
export async function getLocalStream(type: CallType): Promise<MediaStream> {
  return mediaDevices.getUserMedia({
    audio: true,
    video: type === "video" ? { facingMode: "user" } : false,
  });
}

/** react-native-webrtc's RTCPeerConnection constructor takes an
 *  `{iceServers}` config whose entries are the same {urls, username,
 *  credential} shape @relay/shared's IceServerConfig already uses (see
 *  that type's doc comment) — structurally compatible, so no translation
 *  needed. (RTCConfiguration/RTCIceServer aren't exported from
 *  react-native-webrtc's public types, so this relies on structural
 *  typing rather than naming them directly.) */
export function createPeerConnection(iceServers: IceServerConfig[]): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers });
}
