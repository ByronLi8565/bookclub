import { useCallback, useState } from "react";
import type { GroupSummary } from "./api.ts";
import { uploadCurrentSource } from "./sourceAccess.ts";
import { inspectSource, type SourceMetadata } from "../sources/admission.ts";
import type { SourceHealth } from "../../shared/types/sourceHealth.ts";
import type { SourceKind } from "../../shared/types/sources.ts";
import { spawnToast } from "../ui/shared/toast/store.ts";

// idle: no file chosen. checking: inspecting a picked file. ready: inspection
// finished (the file may still be unusable — see health). uploading: storing it.
export type UploadStatus = "idle" | "checking" | "ready" | "uploading";

// A file that has been picked and inspected, ready to preview in the modal.
export interface InspectedBook {
  file: File;
  kind: SourceKind;
  contentType: string;
  health: SourceHealth;
  metadata: SourceMetadata;
}

export interface BookUpload {
  status: UploadStatus;
  busy: boolean;
  // The inspected file awaiting confirmation, or null before one is picked.
  inspected: InspectedBook | null;
  // Why the picked file couldn't be inspected at all (unsupported / unreadable),
  // shown inline in the modal; null once a file inspects successfully.
  error: string | null;
  // Whether the inspected file can actually be uploaded (health isn't an error).
  canUpload: boolean;
  // Inspection progress (0–100) while `status === "checking"`, else 0. Drives
  // the modal's progress bar as the whole file is scanned.
  progress: number;
  // Inspect a picked file and hold the result for preview. Does not upload.
  select: (file: File) => Promise<void>;
  // Upload the currently-inspected file; resolves true on success (caller closes
  // the modal). A no-op when there's nothing inspected or health is an error.
  confirm: () => Promise<boolean>;
  // Clear the picked file and any error (e.g. when the modal closes).
  reset: () => void;
}

// Book admission, split into inspect (`select`) and upload (`confirm`) so the
// upload modal can preview a file's metadata and health before committing it.
// Admission refuses unreadable/unsupported files and files whose health is an
// error; warnings are surfaced for the user to acknowledge by uploading anyway.
// On success `onUploaded` fires with the new source's content hash.
export function useBookUpload(
  group: GroupSummary | null,
  onUploaded: (sourceId: string) => void,
): BookUpload {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [inspected, setInspected] = useState<InspectedBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  const reset = useCallback(() => {
    setStatus("idle");
    setInspected(null);
    setError(null);
    setProgress(0);
  }, []);

  const select = useCallback(async (file: File): Promise<void> => {
    setInspected(null);
    setError(null);
    setProgress(0);
    setStatus("checking");
    const inspection = await inspectSource(file, (fraction) =>
      setProgress(Math.round(fraction * 100)),
    );
    if (!inspection.ok) {
      setStatus("idle");
      setError(
        inspection.reason === "unsupported_type"
          ? "Unsupported file — choose an EPUB or PDF."
          : "That file couldn't be read.",
      );
      return;
    }
    setInspected({
      file,
      kind: inspection.kind,
      contentType: inspection.contentType,
      health: inspection.health,
      metadata: inspection.metadata,
    });
    setStatus("ready");
  }, []);

  const confirm = useCallback(async (): Promise<boolean> => {
    if (!group || !inspected || inspected.health.status === "error") return false;
    setStatus("uploading");
    const result = await uploadCurrentSource(
      group,
      inspected.file,
      inspected.health,
      inspected.metadata.title,
    );
    if (result.ok) {
      onUploaded(result.value.source.id);
      reset();
      return true;
    }
    setStatus("ready");
    spawnToast("Upload failed", "Couldn't store that file. Try again.", { type: "error" });
    return false;
  }, [group, inspected, onUploaded, reset]);

  return {
    status,
    busy: status === "checking" || status === "uploading",
    inspected,
    error,
    canUpload: inspected !== null && inspected.health.status !== "error",
    progress,
    select,
    confirm,
    reset,
  };
}
