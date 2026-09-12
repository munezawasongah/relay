import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

// Mobile app shell. Navigation stack (auth -> chat list -> chat) lands with the
// "Phase 0: React Native shell + navigation" build step.

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Relay</Text>
      <Text>Mobile shell scaffold — navigation lands next.</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
  },
});
