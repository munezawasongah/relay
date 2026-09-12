import { createNativeStackNavigator } from "@react-navigation/native-stack";
import OtpVerifyScreen from "../screens/auth/OtpVerifyScreen";
import PhoneEntryScreen from "../screens/auth/PhoneEntryScreen";

export type AuthStackParamList = {
  PhoneEntry: undefined;
  OtpVerify: { phoneNumber: string; devCode?: string };
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

export default function AuthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PhoneEntry" component={PhoneEntryScreen} />
      <Stack.Screen
        name="OtpVerify"
        component={OtpVerifyScreen}
        options={{ headerShown: true, title: "Verify" }}
      />
    </Stack.Navigator>
  );
}
