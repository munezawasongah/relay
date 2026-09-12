import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { verifyOtp } from "../../api/auth";
import { useAuth } from "../../auth/AuthContext";
import type { AuthStackParamList } from "../../navigation/AuthNavigator";

type Props = NativeStackScreenProps<AuthStackParamList, "OtpVerify">;

export default function OtpVerifyScreen({ route }: Props) {
  const { phoneNumber, devCode } = route.params;
  const { signIn } = useAuth();

  const [code, setCode] = useState(devCode ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVerify() {
    setError(null);
    setIsSubmitting(true);
    try {
      const { token, user } = await verifyOtp(phoneNumber, code.trim());
      await signIn(token, user);
      // No manual navigation needed: RootNavigator swaps to the main stack
      // automatically once AuthContext reports a signed-in user.
    } catch {
      setError("That code didn't work. Check it and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enter the code</Text>
      <Text style={styles.subtitle}>We sent a 6-digit code to {phoneNumber}</Text>

      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
        placeholder="123456"
      />

      {devCode && <Text style={styles.hint}>Dev mode: code pre-filled ({devCode})</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.button, isSubmitting && styles.buttonDisabled]}
        onPress={handleVerify}
        disabled={isSubmitting || code.trim().length !== 6}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Verify</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: "700" },
  subtitle: { fontSize: 15, color: "#666", marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 20,
    letterSpacing: 4,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#0a7ea4",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#c0392b" },
  hint: { color: "#888", fontSize: 13 },
});
