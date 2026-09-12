import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import AuthNavigator from "./AuthNavigator";
import MainNavigator from "./MainNavigator";

// Switches between the signed-out flow (phone -> OTP) and the signed-in app
// (chat list -> chat) based on AuthContext, restoring a saved session first.
export default function RootNavigator() {
  const { isLoading, user } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return user ? <MainNavigator /> : <AuthNavigator />;
}
