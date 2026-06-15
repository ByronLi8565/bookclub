import { useCallback, useState } from "react";
import type { GroupSummary } from "./api.ts";
import { uploadCurrentSource } from "./sourceAccess.ts";
import { inspectSource, type SourceMetadata } from "../sources/admission.ts";
import type { SourceHealth } from "../../shared/types/sourceHealth.ts";
import type { SourceKind } from "../../shared/types/sources.ts";
import { spawnToast } from "../ui/shared/toast/store.ts";


export type UploadStatus = "idle" | "checking" | "ready" | "uploading";

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

  inspected: InspectedBook | null;


  error: string | null;

  canUpload: boolean;


  progress: number;

  select: (file: File) => Promise<void>;

  updateMetadata: (metadata: Partial<Pick<SourceMetadata, "title" | "author">>) => void;


  confirm: () => Promise<boolean>;

  reset: () => void;
}





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

  const updateMetadata = useCallback(
    (metadata: Partial<Pick<SourceMetadata, "title" | "author">>): void => {
      setInspected((current) =>
        current ? { ...current, metadata: { ...current.metadata, ...metadata } } : current,
      );
    },
    [],
  );

  const confirm = useCallback(async (): Promise<boolean> => {
    if (!group || !inspected || inspected.health.status === "error") return false;
    setStatus("uploading");
    const result = await uploadCurrentSource(
      group,
      inspected.file,
      inspected.health,
      inspected.metadata.title,
      inspected.metadata.author,
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
    updateMetadata,
    confirm,
    reset,
  };
}
