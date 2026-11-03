import { createRoot } from "react-dom/client";

// Bundled terminal fonts (works offline, no system install needed).
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/cascadia-code/400.css";
import "@fontsource/cascadia-code/700.css";
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/700.css";
// Additional fonts: Latin subset only to keep the bundle small (Korean falls back to the system font).
import "@fontsource/source-code-pro/latin-400.css";
import "@fontsource/source-code-pro/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-700.css";
import "@fontsource/roboto-mono/latin-400.css";
import "@fontsource/roboto-mono/latin-700.css";
import "@fontsource/ubuntu-mono/latin-400.css";
import "@fontsource/ubuntu-mono/latin-700.css";
import "@fontsource/inconsolata/latin-400.css";
import "@fontsource/inconsolata/latin-700.css";
import "@fontsource/victor-mono/latin-400.css";
import "@fontsource/victor-mono/latin-700.css";
import "./index.css";

import App from "./App";

// All terminal fonts are bundled, so the Local Font Access API is never needed.
// Removing it keeps @xterm/addon-ligatures on its built-in ligature set instead
// of popping a WebView2 "use your computer's fonts" permission prompt.
// (Window is a [Global] interface, so the method lives on the instance itself.)
for (const target of [window, Window.prototype]) {
  delete (target as { queryLocalFonts?: unknown }).queryLocalFonts;
}

// No <StrictMode>: its dev-only double mount would spawn and immediately kill
// a PTY / SSH connection for every tab.
createRoot(document.getElementById("root")!).render(<App />);
