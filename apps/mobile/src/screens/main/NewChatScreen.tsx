import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { createDirectConversation } from "../../api/conversations";
import { lookupUserByPhone } from "../../api/users";
import { ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import type { MainStackParamList } from "../../navigation/MainNavigator";

type Props = NativeStackScreenProps<MainStackParamList, "NewChat">;

// Stand-in for the architecture doc's device-contacts sync (a separate,
// not-yet-built Phase 1 item) — good enough to actually reach ChatScreen
// with a real conversation while that's still pending.
export default function NewChatScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStartChat() {
    if (!token) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const peer = await lookupUserByPhone(token, phoneNumber.trim());
      const { conversationId } = await createDirectConversation(token, peer.id);
      navigation.replace("Chat", { conversationId, peerId: peer.id, name: peer.displayName || phoneNumber.trim() });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError("No one with that number is on Relay yet.");
      } else {
        setError("Couldn't start that chat. Try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Phone number</Text>
      <TextInput
        style={styles.input}
        value={phoneNumber}
        onChangeText={setPhoneNumber}
        keyboardType="phone-pad"
        autoFocus
        placeholder="+2547..."
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.button, (isSubmitting || !phoneNumber.trim()) && styles.buttonDisabled]}
        onPress={handleStartChat}
        disabled={isSubmitting || !phoneNumber.trim()}
      >
        {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Start chat</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 24, gap: 12 },
  label: { fontSize: 13, color: "#666", marginBottom: -4 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
  },
  button: { backgroundColor: "#0a7ea4", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#c0392b" },
});
