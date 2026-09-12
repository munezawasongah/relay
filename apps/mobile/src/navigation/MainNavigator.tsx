import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ChatListScreen from "../screens/main/ChatListScreen";
import ChatScreen from "../screens/main/ChatScreen";

export type MainStackParamList = {
  ChatList: undefined;
  Chat: { conversationId: string; name: string };
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export default function MainNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="ChatList" component={ChatListScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Chat" component={ChatScreen} />
    </Stack.Navigator>
  );
}
