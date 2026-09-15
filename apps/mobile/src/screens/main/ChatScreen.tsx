import type { MediaInfo } from "@relay/shared";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { fetchMediaInfo, uploadMedia } from "../../api/media";
import { useAuth } from "../../auth/AuthContext";
import { useCall } from "../../calling/CallContext";
import { useMessaging } from "../../messaging/MessagingContext";
import { type ChatMessage, useDirectConversation } from "../../messaging/useDirectConversation";
import type { MainStackParamList } from "../../navigation/MainNavigator";

type Props = NativeStackScreenProps<MainStackParamList, "Chat">;

export default function ChatScreen({ route, navigation }: Props) {
  const { conversationId, peerId, name } = route.params;
  const { user, token } = useAuth();
  const { isConnected } = useMessaging();
  const { startCall, phase: callPhase } = useCall();
  const { messages, isLoadingHistory, peerTyping, sendText, notifyTyping } = useDirectConversation(
    conversationId,
    peerId
  );
  const [draft, setDraft] = useState("");
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);

  async function handleStartCall(type: "audio" | "video") {
    if (callPhase !== "idle") {
      Alert.alert("Already on a call", "Finish your current call before starting a new one.");
      return;
    }
    const error = await startCall({ conversationId, peerId, peerDisplayName: name, type });
    if (error === "callee_unreachable") {
      Alert.alert(
        `Can't reach ${name}`,
        `${name} isn't online right now — calling needs both people to have the app open (no call-ringing notification yet).`
      );
    } else if (error === "media_permission_denied") {
      Alert.alert("Permission needed", `Relay needs microphone${type === "video" ? "/camera" : ""} access to make a call.`);
    } else if (error) {
      Alert.alert("Couldn't start call", "Please try again.");
    }
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      title: name,
      headerRight: () => (
        <View style={styles.headerButtons}>
          <Pressable style={styles.headerButton} onPress={() => handleStartCall("audio")}>
            <Text style={styles.headerButtonText}>📞</Text>
          </Pressable>
          <Pressable style={styles.headerButton} onPress={() => handleStartCall("video")}>
            <Text style={styles.headerButtonText}>🎥</Text>
          </Pressable>
        </View>
      ),
    });
    // handleStartCall is intentionally omitted: it's recreated every render
    // (it closes over callPhase) but doesn't need to be a stable identity
    // for setOptions's headerRight to keep working correctly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, name]);

  function handleChangeDraft(text: string) {
    setDraft(text);
    notifyTyping(text.length > 0);
  }

  async function handleSend() {
    const text = draft;
    setDraft("");
    notifyTyping(false);
    await sendText(text);
  }

  // Media is picked, uploaded to media-service (which is NOT E2E encrypted —
  // see MediaInfo's doc comment in @relay/shared), and then sent as a
  // caption-less message carrying just the mediaRef. sendText() itself
  // handles the "zero-length ciphertext is fine" case.
  async function handlePickMedia() {
    if (!token || isUploadingMedia) return;

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photo access needed", "Relay needs permission to your photos to share one in this chat.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setIsUploadingMedia(true);
    try {
      const media = await uploadMedia(token, {
        uri: asset.uri,
        name: asset.fileName || `photo-${Date.now()}.jpg`,
        mimeType: asset.mimeType || "image/jpeg",
      });
      await sendText("", media.id);
    } catch (err) {
      console.error("[chat] media upload failed", err);
      Alert.alert("Couldn't send photo", "Something went wrong uploading that photo. Please try again.");
    } finally {
      setIsUploadingMedia(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {!isConnected && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>Reconnecting…</Text>
        </View>
      )}

      {isLoadingHistory ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MessageBubble message={item} isOwn={item.senderId === user?.id} />}
          inverted={false}
        />
      )}

      {peerTyping && <Text style={styles.typing}>{name} is typing…</Text>}

      <View style={styles.composer}>
        <Pressable style={styles.attachButton} onPress={handlePickMedia} disabled={isUploadingMedia}>
          {isUploadingMedia ? <ActivityIndicator size="small" color="#0a7ea4" /> : <Text style={styles.attachButtonText}>＋</Text>}
        </Pressable>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={handleChangeDraft}
          placeholder="Message"
          multiline
        />
        <Pressable style={[styles.sendButton, !draft.trim() && styles.sendButtonDisabled]} onPress={handleSend} disabled={!draft.trim()}>
          <Text style={styles.sendButtonText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message, isOwn }: { message: ChatMessage; isOwn: boolean }) {
  return (
    <View style={[styles.bubbleRow, isOwn && styles.bubbleRowOwn]}>
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubblePeer, message.unavailable && styles.bubbleUnavailable]}>
        {message.mediaRef && <MediaThumbnail mediaId={message.mediaRef} />}
        {message.text.length > 0 && (
          <Text
            style={[
              styles.bubbleText,
              isOwn && styles.bubbleTextOwn,
              message.unavailable && styles.bubbleTextUnavailable,
              !!message.mediaRef && styles.bubbleTextWithMedia,
            ]}
          >
            {message.text}
          </Text>
        )}
        {message.pending && <Text style={styles.status}>Sending…</Text>}
      </View>
    </View>
  );
}

/** Looks up a media object's (short-lived, 5-minute) URLs by id and renders
 *  its thumbnail. Deliberately re-fetches per-bubble rather than threading
 *  MediaInfo through useDirectConversation/ChatMessage — that keeps the
 *  message hook ignorant of media-service entirely, at the cost of one
 *  extra request per bubble per screen mount. If a chat is left open long
 *  enough for the presigned URL to expire mid-view, this doesn't currently
 *  refresh it — a known limitation, same as media-service's other presigned
 *  URLs. */
function MediaThumbnail({ mediaId }: { mediaId: string }) {
  const { token } = useAuth();
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetchMediaInfo(token, mediaId)
      .then((result) => {
        if (!cancelled) setInfo(result);
      })
      .catch((err) => {
        console.warn("[chat] failed to load media", mediaId, err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token, mediaId]);

  if (failed) {
    return <Text style={styles.mediaError}>Couldn't load photo</Text>;
  }
  if (!info) {
    return (
      <View style={styles.mediaPlaceholder}>
        <ActivityIndicator size="small" />
      </View>
    );
  }
  return <Image source={{ uri: info.thumbnailUrl || info.downloadUrl }} style={styles.mediaImage} resizeMode="cover" />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  loading: { flex: 1, justifyContent: "center", alignItems: "center" },
  banner: { backgroundColor: "#fff3cd", paddingVertical: 4, alignItems: "center" },
  bannerText: { color: "#856404", fontSize: 12 },
  list: { flex: 1, paddingHorizontal: 12 },
  bubbleRow: { flexDirection: "row", marginVertical: 3 },
  bubbleRowOwn: { justifyContent: "flex-end" },
  bubble: { maxWidth: "78%", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 9 },
  bubblePeer: { backgroundColor: "#eee", alignSelf: "flex-start" },
  bubbleOwn: { backgroundColor: "#0a7ea4", alignSelf: "flex-end" },
  bubbleUnavailable: { opacity: 0.6 },
  bubbleText: { fontSize: 15.5, color: "#111" },
  bubbleTextOwn: { color: "#fff" },
  bubbleTextUnavailable: { fontStyle: "italic" },
  bubbleTextWithMedia: { marginTop: 6 },
  mediaImage: { width: 220, height: 220, borderRadius: 12, backgroundColor: "#ddd" },
  mediaPlaceholder: { width: 220, height: 220, borderRadius: 12, backgroundColor: "#ddd", justifyContent: "center", alignItems: "center" },
  mediaError: { fontSize: 13, fontStyle: "italic", color: "#c00" },
  status: { fontSize: 11, color: "#eaf6fb", marginTop: 2 },
  typing: { color: "#888", fontSize: 12, paddingHorizontal: 16, paddingBottom: 4 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 10,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#eee",
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#ddd",
    justifyContent: "center",
    alignItems: "center",
  },
  attachButtonText: { fontSize: 20, color: "#0a7ea4", lineHeight: 22 },
  headerButtons: { flexDirection: "row", gap: 14, marginRight: 4 },
  headerButton: { padding: 4 },
  headerButtonText: { fontSize: 20 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    maxHeight: 120,
    fontSize: 15.5,
  },
  sendButton: { backgroundColor: "#0a7ea4", borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10 },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonText: { color: "#fff", fontWeight: "600" },
});
