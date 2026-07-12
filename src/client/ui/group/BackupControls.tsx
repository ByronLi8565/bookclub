import { useRef, useState } from "react";
import {
  BOOKCLUB_ARCHIVE_CONTENT_TYPE,
  BOOKCLUB_ARCHIVE_EXTENSION,
  type BookclubArchiveManifest,
} from "../../../shared/backups/bookclubArchive.ts";
import { formatBytes } from "../../../shared/format.ts";
import { previewGroupBackup, saveGroupBackup } from "../../logic/groups/backupAccess.ts";
import { fetchGroupBackup, restoreGroupBackup } from "../../logic/groups/groupClient.ts";
import { isNative } from "../../logic/net/api.ts";
import { spawnToast } from "../shared/toast/toastStore.ts";

interface RestorePreview {
  file: File;
  manifest: BookclubArchiveManifest;
}

export function BackupControls({
  groupRef,
  groupId,
}: {
  groupRef: string;
  groupId: string;
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<"download" | "restore" | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [pendingDownload, setPendingDownload] = useState<File | null>(null);

  async function prepareDownload(): Promise<void> {
    setBusy("download");
    const result = await fetchGroupBackup(groupRef);
    setBusy(null);
    if (!result.ok) {
      spawnToast("Backup failed", "Couldn't create the notes backup.", { type: "error" });
      return;
    }
    setPendingDownload(result.value);
  }

  async function confirmDownload(): Promise<void> {
    if (!pendingDownload) return;
    setBusy("download");
    const result = await saveGroupBackup(pendingDownload);
    setBusy(null);
    if (!result.ok) {
      spawnToast("Backup failed", "Couldn't save the notes backup.", { type: "error" });
      return;
    }
    setPendingDownload(null);
    spawnToast(
      "Backup created",
      isNative
        ? `${result.value.name} was saved to Documents.`
        : `${result.value.name} downloaded.`,
      { type: "info" },
    );
  }

  async function select(file: File): Promise<void> {
    const result = await previewGroupBackup(file);
    if (!result.ok) {
      spawnToast("Invalid backup", "This file isn't a supported Bookclub backup.", {
        type: "error",
      });
      return;
    }
    if (result.value.manifest.club.id !== groupId) {
      spawnToast("Different club", "This backup belongs to a different club.", { type: "error" });
      return;
    }
    setPreview({ file, manifest: result.value.manifest });
  }

  async function restore(): Promise<void> {
    if (!preview) return;
    setBusy("restore");
    const result = await restoreGroupBackup(groupRef, preview.file);
    setBusy(null);
    if (!result.ok) {
      spawnToast("Restore failed", "No notes were replaced.", { type: "error" });
      return;
    }
    setPreview(null);
    spawnToast(
      "Notes restored",
      `Restored ${result.value.notes} notes and ${result.value.images} images.`,
      { type: "info" },
    );
  }

  return (
    <div className="group-backup-controls">
      <div className="settings-backup-actions">
        <button
          type="button"
          className="settings-action"
          disabled={busy !== null || pendingDownload !== null}
          onClick={() => void prepareDownload()}
        >
          {busy === "download" ? "creating…" : "Backup notes"}
        </button>
        <input
          ref={inputRef}
          hidden
          type="file"
          accept={`${BOOKCLUB_ARCHIVE_EXTENSION},${BOOKCLUB_ARCHIVE_CONTENT_TYPE}`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void select(file);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          className="settings-action"
          disabled={busy !== null || pendingDownload !== null}
          onClick={() => inputRef.current?.click()}
        >
          Restore notes
        </button>
      </div>
      {pendingDownload && (
        <dialog className="backup-download-confirm" open aria-label="Confirm notes backup">
          <p>
            This will download note data into a zip file of {formatBytes(pendingDownload.size)}.
          </p>
          <div className="settings-backup-actions">
            <button
              type="button"
              className="settings-action"
              disabled={busy !== null}
              onClick={() => setPendingDownload(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="settings-action settings-backup-restore"
              disabled={busy !== null}
              onClick={() => void confirmDownload()}
            >
              {busy === "download" ? "downloading…" : "Download"}
            </button>
          </div>
        </dialog>
      )}
      {preview && (
        <div className="settings-backup-preview" role="status">
          <strong>Replace all current notes?</strong>
          <span>
            {preview.manifest.club.name} · {preview.manifest.notes.length} notes ·{" "}
            {preview.manifest.images.length} images ·{" "}
            {new Date(preview.manifest.createdAt).toLocaleString()}
          </span>
          <p>
            The restore process will replace ALL current notes and cannot be undone. Download a
            current backup first if needed.
          </p>
          <div className="settings-backup-actions">
            <button
              type="button"
              className="settings-action"
              disabled={busy !== null}
              onClick={() => setPreview(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="settings-action settings-backup-restore"
              disabled={busy !== null}
              onClick={() => void restore()}
            >
              {busy === "restore" ? "restoring…" : "Restore exactly"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
