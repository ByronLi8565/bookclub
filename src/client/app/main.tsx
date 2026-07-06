import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import { spawnToast } from "../ui/shared/toast/toastStore.ts";
import "../index.css";

registerSW({
  // `autoUpdate` mode: when a new version activates, the plugin reloads every
  // open tab automatically. `immediate` registers the worker on first load.
  immediate: true,
  onOfflineReady() {
    spawnToast("Offline ready", "Bookclub will work without a connection.", { type: "info" });
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
