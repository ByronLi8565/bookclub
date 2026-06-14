import { spawnToast } from "./toast.tsx";

// Surface the note-sync connection status as a toast, keyed off the book hash.
export function showSyncStatusToast(
  status: "syncing" | "online" | "offline",
  sourceId: string,
): void {
  if (status === "online") {
    spawnToast("Status: Online", `Synced to book with hash ${sourceId}.`, { type: "info" });
    return;
  }
  if (status === "syncing") {
    spawnToast("Status: Syncing", `Connecting to book with hash ${sourceId}.`, { type: "info" });
    return;
  }
  spawnToast("Status: Offline", `Offline for book with hash ${sourceId}.`, { type: "error" });
}
