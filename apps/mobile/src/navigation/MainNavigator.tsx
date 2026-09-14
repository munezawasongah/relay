import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ChatListScreen from "../screens/main/ChatListScreen";
import ChatScreen from "../screens/main/ChatScreen";
import NewChatScreen from "../screens/main/NewChatScreen";

export type MainStackParamList = {
  ChatList: undefined;
  // peerId is required: encrypting to this conversation needs the other
  // member's id (to fetch their prekey bundle) — group conversations
  // (peer-less) aren't supported by ChatScreen yet, see useDirectConversation.
  Chat: { conversationId: string; peerId: string; name: string };
  NewChat: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export default function MainNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="ChatList" component={ChatListScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="NewChat" component={NewChatScreen} options={{ title: "New chat" }} />
    </Stack.Navigator>
  );
}
