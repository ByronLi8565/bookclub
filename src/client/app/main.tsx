import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import { spawnToast } from "../ui/shared/toast/toastStore.ts";
import "../index.css";

const updateSW = registerSW({
  onNeedRefresh() {
    // A new app shell is cached and waiting; let the user choose when to take it.
    spawnToast("Update available", "Reload to get the latest version.", {
      type: "info",
      durationMs: 8000,
    });
  },
  onOfflineReady() {
    spawnToast("Offline ready", "Bookclub will work without a connection.", { type: "info" });
  },
});
void updateSW;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
