import { useEffect, useState } from "react";
import { fetchBook } from "../groups/api.ts";
import { deleteCachedBook, getCachedBook, putCachedBook } from "../groups/bookCache.ts";
import { spawnToast } from "./toast.tsx";

// Identifies the book a settings dialog can manage: its content-hash sourceId
// and the group URL name used to redownload it from R2.
export interface SettingsBook {
  sourceId: string;
  name: string;
}

// Human-readable byte size (e.g. "1.4 MB").
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

// Settings dialog. The first item manages the current book's local copy.
export function SettingsModal({
  book,
  onClose,
}: {
  book: SettingsBook;
  onClose: () => void;
}): React.ReactElement {
  // The cached file size in bytes, or null while loading / when not cached.
  const [cachedSize, setCachedSize] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getCachedBook(book.sourceId).then((file) => {
      if (cancelled) return;
      setCachedSize(file ? file.size : null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [book.sourceId]);

  async function onRedownload(): Promise<void> {
    setBusy(true);
    await deleteCachedBook(book.sourceId);
    const file = await fetchBook(book.name);
    if (file) {
      await putCachedBook(book.sourceId, file);
      setBusy(false);
      spawnToast("Book redownloaded", "The local copy was refreshed from storage.", {
        type: "info",
      });
      // Reload so the workspace re-reads the freshly cached bytes.
      location.reload();
    } else {
      setBusy(false);
      setCachedSize(null);
      spawnToast("Redownload failed", "Couldn't fetch the book from storage.", { type: "error" });
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <strong>settings</strong>
          <button type="button" onClick={onClose} aria-label="close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <section className="settings-item">
            <h2 className="settings-item-head">Local book copy</h2>
            {loading ? (
              <p className="settings-detail-status">checking…</p>
            ) : cachedSize === null ? (
              <p className="settings-detail-status">
                Not stored on this device — it's fetched from the cloud (R2) each time.
              </p>
            ) : (
              <dl className="settings-detail">
                <dt>Save location</dt>
                <dd>Browser storage</dd>
                <dt>Size</dt>
                <dd>{formatBytes(cachedSize)}</dd>
              </dl>
            )}
            <button
              type="button"
              className="settings-action"
              onClick={() => void onRedownload()}
              disabled={busy || loading}
            >
              {busy
                ? "redownloading…"
                : cachedSize === null
                  ? "download a local copy"
                  : "delete local copy & redownload"}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
