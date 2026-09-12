// Custom entry point (instead of the default node_modules/expo/AppEntry.js)
// because that file uses a relative import ("../../App") that assumes
// node_modules lives next to it — which breaks once npm workspaces hoist
// expo's node_modules up to the monorepo root. See package.json's "main" field.
import { registerRootComponent } from "expo";

import App from "./App";

registerRootComponent(App);
