import { useEffect, useState } from "react";
import { cachedSourceSize, refreshSource } from "../../groups/sourceAccess.ts";
import {
  setReaderPref,
  useReaderPrefs,
  type ReadingPositionOpenPolicy,
  type SmartArrows,
} from "../../settings/userPrefs.ts";
import { Loading } from "../shared/Loading.tsx";
import { DropdownMenu } from "../shared/DropdownMenu.tsx";
import { Modal, ModalPagerTabs } from "../shared/Modal.tsx";
import { spawnToast } from "../shared/toast/toastStore.ts";

function SettingDropdown<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}): React.ReactElement {
  const active = options.find((o) => o.value === value);

  return (
    <DropdownMenu
      className="book-menu settings-dropdown"
      items={options.map((option) => ({
        key: option.value,
        label: option.label,
        title: option.label,
        checked: option.value === value,
        className: option.value === value ? "book-menu-item is-active" : "book-menu-item",
        onSelect: () => onChange(option.value),
      }))}
      renderTrigger={({ open, toggle }) => (
        <button
          type="button"
          className="settings-action settings-dropdown-trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={ariaLabel}
          title={ariaLabel}
          onClick={toggle}
        >
          <span>{active?.label ?? value}</span>
          <span className="book-menu-arrow" aria-hidden="true">
            ▾
          </span>
        </button>
      )}
    />
  );
}

export interface SettingsBook {
  sourceId: string;
  groupRef: string;
}

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

type Category = "info" | "pdf";
const CATEGORIES: { id: Category; label: string }[] = [
  { id: "info", label: "Info" },
  { id: "pdf", label: "PDF" },
];

export function SettingsModal({
  book,
  onClose,
}: {
  book: SettingsBook;
  onClose: () => void;
}): React.ReactElement {
  const [category, setCategory] = useState<Category>("info");

  const [cachedSize, setCachedSize] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { readingPositionOpenPolicy, smartArrows } = useReaderPrefs();

  useEffect(() => {
    let cancelled = false;
    void cachedSourceSize(book.sourceId).then((size) => {
      if (cancelled) return;
      setCachedSize(size);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [book.sourceId]);

  async function onRedownload(): Promise<void> {
    setBusy(true);
    const result = await refreshSource(book.groupRef, book.sourceId);
    setBusy(false);
    if (result.ok) {
      spawnToast("Book redownloaded", "The local copy was refreshed from storage.", {
        type: "info",
      });

      location.reload();
    } else {
      setCachedSize(null);
      spawnToast("Redownload failed", "Couldn't fetch the book from storage.", { type: "error" });
    }
  }

  return (
    <Modal title="settings" onClose={onClose}>
      <div className="modal-body settings-body">
        {category === "info" && (
          <>
            <section className="settings-item">
              <div className="settings-item-text">
                <h2 className="settings-item-head">Local book copy</h2>
                {loading ? (
                  <Loading className="loading--settings-detail" />
                ) : cachedSize === null ? (
                  <p className="settings-item-desc">Not stored.</p>
                ) : (
                  <p className="settings-item-desc">Browser storage · {formatBytes(cachedSize)}</p>
                )}
              </div>
              <div className="settings-item-control">
                <button
                  type="button"
                  className="settings-action"
                  onClick={() => void onRedownload()}
                  disabled={busy || loading}
                  title="Refresh the local book copy from storage"
                >
                  {busy
                    ? "redownloading…"
                    : cachedSize === null
                      ? "Download a copy"
                      : "delete local & redownload"}
                </button>
              </div>
            </section>
            <section className="settings-item">
              <div className="settings-item-text">
                <h2 className="settings-item-head">Opening position</h2>
                <p className="settings-item-desc">
                  Whether to sync reading position across browsers
                </p>
              </div>
              <div className="settings-item-control">
                <SettingDropdown<ReadingPositionOpenPolicy>
                  value={readingPositionOpenPolicy}
                  onChange={(v) => setReaderPref("readingPositionOpenPolicy", v)}
                  ariaLabel="Opening reading position"
                  options={[
                    { value: "prefer-sync", label: "Sync" },
                    { value: "prefer-local", label: "Local" },
                  ]}
                />
              </div>
            </section>
          </>
        )}
        {category === "pdf" && (
          <section className="settings-item">
            <div className="settings-item-text">
              <h2 className="settings-item-head">Smart arrow keys</h2>
              <p className="settings-item-desc">Arrow keys try to scroll before turning page.</p>
            </div>
            <div className="settings-item-control">
              <SettingDropdown<SmartArrows>
                value={smartArrows}
                onChange={(v) => setReaderPref("smartArrows", v)}
                ariaLabel="PDF smart arrow keys"
                options={[
                  { value: "off", label: "Off" },
                  { value: "smooth", label: "Smooth" },
                  { value: "instant", label: "Instant" },
                ]}
              />
            </div>
          </section>
        )}
      </div>
      <ModalPagerTabs
        tabs={CATEGORIES.map((c) => ({ ...c, title: `${c.label} settings` }))}
        active={category}
        onChange={setCategory}
        className="settings-tabs"
      />
    </Modal>
  );
}
