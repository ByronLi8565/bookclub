import { useState } from "react";
import type { GroupSummary } from "./api.ts";
import { uploadCurrentSource } from "./sourceAccess.ts";
import { inspectSource } from "../sources/admission.ts";
import { spawnToast } from "../ui/shared/toast/store.ts";

export type UploadStatus = "idle" | "checking" | "uploading";

export interface BookUpload {
  status: UploadStatus;
  busy: boolean;
  // Health-check a picked file, confirm any warnings, upload it, and on success
  // invoke `onUploaded` with the new source's content hash.
  pick: (file: File) => Promise<void>;
}

// Owner-only book admission: inspect a picked file (source admission), refuse
// errors, confirm warnings, then upload and bind it. Shared by the empty-library
// upload affordance and the in-reader "add a book" action so the gating copy and
// flow stay identical.
export function useBookUpload(
  group: GroupSummary | null,
  onUploaded: (sourceId: string) => void,
): BookUpload {
  const [status, setStatus] = useState<UploadStatus>("idle");

  async function pick(file: File): Promise<void> {
    if (!group) return;
    setStatus("checking");
    const inspection = await inspectSource(file);
    if (!inspection.ok) {
      setStatus("idle");
      spawnToast(
        "Unsupported file",
        inspection.reason === "unsupported_type"
          ? "Choose an EPUB or PDF file."
          : "That file couldn't be read.",
        { type: "error" },
      );
      return;
    }
    const { health, title } = inspection;
    if (health.status === "error") {
      setStatus("idle");
      spawnToast(
        "Can't use this file",
        health.errors[0]?.message ?? "This file can't host anchored notes.",
        { type: "error" },
      );
      return;
    }
    if (health.status === "warn") {
      const summary = health.warnings.map((w) => `• ${w.message}`).join("\n");
      if (!window.confirm(`This file may have issues:\n\n${summary}\n\nUse it anyway?`)) {
        setStatus("idle");
        return;
      }
    }
    setStatus("uploading");
    const result = await uploadCurrentSource(group, file, health, title);
    setStatus("idle");
    if (result.ok) onUploaded(result.value.source.id);
    else spawnToast("Upload failed", "Couldn't store that file. Try again.", { type: "error" });
  }

  return { status, busy: status !== "idle", pick };
}
