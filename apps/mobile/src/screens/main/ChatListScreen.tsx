import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../auth/AuthContext";
import type { MainStackParamList } from "../../navigation/MainNavigator";

type Props = NativeStackScreenProps<MainStackParamList, "ChatList">;

// Placeholder data — replaced by a real conversations list once the
// messaging service (Phase 1) is wired up over WebSocket.
const PLACEHOLDER_CONVERSATIONS = [
  { id: "1", name: "Design team", lastMessage: "Sounds good, see you then." },
  { id: "2", name: "Mom", lastMessage: "Umefika salama?" },
];

export default function ChatListScreen({ navigation }: Props) {
  const { user, signOut } = useAuth();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Chats</Text>
        <Pressable onPress={signOut}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>
      <Text style={styles.subtitle}>Signed in as {user?.displayName ?? user?.phoneNumber}</Text>

      <FlatList
        data={PLACEHOLDER_CONVERSATIONS}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => navigation.navigate("Chat", { conversationId: item.id, name: item.name })}
          >
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={styles.rowSubtitle}>{item.lastMessage}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", paddingTop: 60, paddingHorizontal: 20 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 28, fontWeight: "700" },
  signOut: { color: "#c0392b" },
  subtitle: { color: "#888", marginTop: 4, marginBottom: 16 },
  row: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#eee" },
  rowTitle: { fontSize: 17, fontWeight: "600" },
  rowSubtitle: { color: "#666", marginTop: 2 },
});
