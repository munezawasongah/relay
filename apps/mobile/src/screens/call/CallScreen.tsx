import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import { useCall } from "../../calling/CallContext";
import type { MainStackParamList } from "../../navigation/MainNavigator";

type Props = NativeStackScreenProps<MainStackParamList, "Call">;

const END_REASON_LABEL: Record<string, string> = {
  hangup: "Call ended",
  declined: "Call declined",
  missed: "No answer",
};

/** The one screen for every call phase — ringing (both directions),
 *  connecting, active, and the brief "ended" state before CallContext
 *  resets and this screen pops itself. Reads everything from useCall()
 *  rather than route params (see MainNavigator's Call route comment for
 *  why: an incoming call can push this screen from outside any specific
 *  screen's tree). */
export default function CallScreen({ navigation }: Props) {
  const { phase, call, localStream, remoteStream, endReason, isMuted, isCameraOff, acceptCall, declineCall, hangUp, toggleMute, toggleCamera } =
    useCall();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const activeSinceRef = useRef<number | null>(null);

  // Pop back to wherever the user was once CallContext has fully reset —
  // by then "ended" has already been shown for a couple of seconds (see
  // CallContext's endLocally), so this is just cleanup, not a jarring cut.
  useEffect(() => {
    if (phase === "idle" && navigation.isFocused()) {
      navigation.goBack();
    }
  }, [phase, navigation]);

  useEffect(() => {
    if (phase === "active" && activeSinceRef.current === null) {
      activeSinceRef.current = Date.now();
    }
    if (phase !== "active") {
      activeSinceRef.current = null;
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      if (activeSinceRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - activeSinceRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [phase]);

  if (!call) {
    // Between "idle" and the goBack() above actually landing — render
    // nothing rather than a flash of empty call UI.
    return <View style={styles.container} />;
  }

  const isVideo = call.type === "video";
  const showRemoteVideo = isVideo && remoteStream && (phase === "active" || phase === "connecting");
  const showLocalVideo = isVideo && localStream && !isCameraOff && phase !== "ended";

  return (
    <View style={styles.container}>
      {showRemoteVideo ? (
        <RTCView streamURL={remoteStream!.toURL()} style={styles.remoteVideo} objectFit="cover" />
      ) : (
        <View style={styles.avatarBackground}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{call.peerDisplayName.charAt(0).toUpperCase()}</Text>
          </View>
        </View>
      )}

      {showLocalVideo && (
        <RTCView streamURL={localStream!.toURL()} style={styles.localVideo} objectFit="cover" mirror zOrder={1} />
      )}

      <View style={styles.topInfo}>
        <Text style={styles.peerName}>{call.peerDisplayName}</Text>
        <Text style={styles.statusText}>{statusLine(phase, endReason, elapsedSeconds)}</Text>
      </View>

      <View style={styles.controls}>
        {phase === "incoming-ringing" ? (
          <View style={styles.incomingRow}>
            <CallButton label="Decline" color="#d33" onPress={declineCall} />
            <CallButton label="Accept" color="#2ea043" onPress={acceptCall} />
          </View>
        ) : phase === "ended" ? null : (
          <View style={styles.activeRow}>
            <CallButton label={isMuted ? "Unmute" : "Mute"} color="#444" onPress={toggleMute} small />
            {isVideo && <CallButton label={isCameraOff ? "Camera on" : "Camera off"} color="#444" onPress={toggleCamera} small />}
            <CallButton label="End" color="#d33" onPress={hangUp} />
          </View>
        )}
      </View>
    </View>
  );
}

function statusLine(phase: string, endReason: string | null, elapsedSeconds: number): string {
  switch (phase) {
    case "outgoing-ringing":
      return "Calling…";
    case "incoming-ringing":
      return "Incoming call";
    case "connecting":
      return "Connecting…";
    case "active":
      return formatDuration(elapsedSeconds);
    case "ended":
      return (endReason && END_REASON_LABEL[endReason]) || "Call ended";
    default:
      return "";
  }
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function CallButton({ label, color, onPress, small }: { label: string; color: string; onPress: () => void; small?: boolean }) {
  return (
    <Pressable style={[styles.button, { backgroundColor: color }, small && styles.buttonSmall]} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#111" },
  remoteVideo: { flex: 1 },
  avatarBackground: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#1a1a1a" },
  avatarCircle: { width: 120, height: 120, borderRadius: 60, backgroundColor: "#0a7ea4", justifyContent: "center", alignItems: "center" },
  avatarInitial: { fontSize: 48, color: "#fff", fontWeight: "600" },
  localVideo: { position: "absolute", top: 60, right: 16, width: 100, height: 140, borderRadius: 12, backgroundColor: "#000" },
  topInfo: { position: "absolute", top: 80, left: 0, right: 0, alignItems: "center" },
  peerName: { color: "#fff", fontSize: 24, fontWeight: "600" },
  statusText: { color: "#ccc", fontSize: 15, marginTop: 6 },
  controls: { position: "absolute", bottom: 60, left: 0, right: 0, alignItems: "center" },
  incomingRow: { flexDirection: "row", gap: 24 },
  activeRow: { flexDirection: "row", gap: 16, alignItems: "center" },
  button: { paddingHorizontal: 28, paddingVertical: 16, borderRadius: 36 },
  buttonSmall: { paddingHorizontal: 18, paddingVertical: 12 },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
