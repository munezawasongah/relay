import { createNavigationContainerRef } from "@react-navigation/native";
import type { MainStackParamList } from "./MainNavigator";

// CallContext needs to push the Call screen from OUTSIDE any specific
// screen's component tree — an incoming call can land while the user is on
// the chat list, a chat, anywhere. That rules out the normal `navigation`
// prop (only available inside a screen), so this is the standard React
// Navigation workaround: a ref attached to NavigationContainer in App.tsx,
// read from here instead.
export const navigationRef = createNavigationContainerRef<MainStackParamList>();

export function navigate<RouteName extends keyof MainStackParamList>(
  name: RouteName,
  params: MainStackParamList[RouteName]
) {
  if (navigationRef.isReady()) {
    // @ts-expect-error — the overload React Navigation expects here doesn't
    // distribute over the union the way a generic wrapper produces it;
    // the call itself is type-checked by MainStackParamList[RouteName] above.
    navigationRef.navigate(name, params);
  }
}
