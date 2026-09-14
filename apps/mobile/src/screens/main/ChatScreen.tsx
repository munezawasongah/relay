import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useLayoutEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "../../auth/AuthContext";
import { useMessaging } from "../../messaging/MessagingContext";
import { type ChatMessage, useDirectConversation } from "../../messaging/useDirectConversation";
import type { MainStackParamList } from "../../navigation/MainNavigator";

type Props = NativeStackScreenProps<MainStackParamList, "Chat">;

export default function ChatScreen({ route, navigation }: Props) {
  const { conversationId, peerId, name } = route.params;
  const { user } = useAuth();
  const { isConnected } = useMessaging();
  const { messages, isLoadingHistory, peerTyping, sendText, notifyTyping } = useDirectConversation(
    conversationId,
    peerId
  );
  const [draft, setDraft] = useState("");

  useLayoutEffect(() => {
    navigation.setOptions({ title: name });
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
        <Text
          style={[
            styles.bubbleText,
            isOwn && styles.bubbleTextOwn,
            message.unavailable && styles.bubbleTextUnavailable,
          ]}
        >
          {message.text}
        </Text>
        {message.pending && <Text style={styles.status}>Sending…</Text>}
      </View>
    </View>
  );
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
