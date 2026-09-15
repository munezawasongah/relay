import { NavigationContainer } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "./src/auth/AuthContext";
import { CallProvider } from "./src/calling/CallContext";
import { MessagingProvider } from "./src/messaging/MessagingContext";
import { navigationRef } from "./src/navigation/navigationRef";
import RootNavigator from "./src/navigation/RootNavigator";

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <MessagingProvider>
          <CallProvider>
            <NavigationContainer ref={navigationRef}>
              <RootNavigator />
            </NavigationContainer>
            <StatusBar style="auto" />
          </CallProvider>
        </MessagingProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
