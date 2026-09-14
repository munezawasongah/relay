import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { ConversationSummary } from "@relay/shared";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { fetchConversations } from "../../api/conversations";
import { useAuth } from "../../auth/AuthContext";
import { useMessaging } from "../../messaging/MessagingContext";
import type { MainStackParamList } from "../../navigation/MainNavigator";

type Props = NativeStackScreenProps<MainStackParamList, "ChatList">;

// No message preview text here, deliberately: previewing the last message
// would mean decrypting it just to render this list, and a given Olm
// ratchet message can only ever be decrypted once (see
// messaging/messageCache.ts). That one legitimate decrypt has to happen in
// ChatScreen, where the result gets cached — not here, speculatively, for
// every conversation every time this list renders. A real fix (show the
// last message here too) needs the local plaintext cache to be populated
// independently of opening the chat, e.g. by decrypting new messages as
// they arrive over the socket at the app root instead of only inside an
// open ChatScreen — not built yet.
function timeAgo(iso?: string): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export default function ChatListScreen({ navigation }: Props) {
  const { token, user, signOut } = useAuth();
  const { socket } = useMessaging();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      const { conversations: list } = await fetchConversations(token);
      setConversations(list);
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  // Refresh whenever this screen comes back into focus (e.g. returning from
  // NewChat or from a Chat screen after sending the conversation's first
  // message) — conversations aren't pushed over the socket, only messages
  // within one are, so there's no live event to key a refresh off of here.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  // Bump ordering (most-recently-active conversation first) when a message
  // arrives for a conversation not currently open. Doesn't touch content —
  // see the file comment above.
  useEffect(() => {
    if (!socket) return;
    const onNew = () => reload();
    socket.on("message:new", onNew);
    return () => {
      socket.off("message:new", onNew);
    };
  }, [socket, reload]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Chats</Text>
        <View style={styles.headerActions}>
          <Pressable onPress={() => navigation.navigate("NewChat")}>
            <Text style={styles.newChat}>New</Text>
          </Pressable>
          <Pressable onPress={signOut}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.subtitle}>Signed in as {user?.displayName ?? user?.phoneNumber}</Text>

      {!isLoading && conversations.length === 0 && (
        <Text style={styles.empty}>No chats yet — tap "New" to message someone by phone number.</Text>
      )}

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const name = item.type === "direct" ? item.peer?.displayName || "Unknown" : item.name || "Group";
          return (
            <Pressable
              style={styles.row}
              onPress={() =>
                item.peer &&
                navigation.navigate("Chat", { conversationId: item.id, peerId: item.peer.id, name })
              }
            >
              <Text style={styles.rowTitle}>{name}</Text>
              <Text style={styles.rowSubtitle}>{timeAgo(item.lastMessage?.sentAt)}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", paddingTop: 60, paddingHorizontal: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerActions: { flexDirection: "row", gap: 16 },
  title: { fontSize: 28, fontWeight: "700" },
  newChat: { color: "#0a7ea4", fontWeight: "600" },
  signOut: { color: "#c0392b" },
  subtitle: { color: "#888", marginTop: 4, marginBottom: 16 },
  empty: { color: "#888", marginTop: 24, textAlign: "center" },
  row: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: "#eee",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  rowTitle: { fontSize: 17, fontWeight: "600" },
  rowSubtitle: { color: "#999", fontSize: 13 },
});
