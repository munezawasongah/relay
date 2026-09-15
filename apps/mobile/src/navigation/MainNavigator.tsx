import { createNativeStackNavigator } from "@react-navigation/native-stack";
import CallScreen from "../screens/call/CallScreen";
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
  // No params: CallScreen reads everything from useCall()'s live state
  // (see CallContext) rather than route params, since it can be reached
  // either from a ChatScreen button (outgoing) or from CallContext itself
  // reacting to an incoming call from anywhere in the app (see
  // navigation/navigationRef.ts).
  Call: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export default function MainNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="ChatList" component={ChatListScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="NewChat" component={NewChatScreen} options={{ title: "New chat" }} />
      <Stack.Screen name="Call" component={CallScreen} options={{ headerShown: false, presentation: "fullScreenModal" }} />
    </Stack.Navigator>
  );
}
