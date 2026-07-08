import { useEffect, useState } from "react";
import { cachedSourceSize, downloadSourceCopy } from "../../logic/groups/sourceAccess.ts";
import { isNative } from "../../logic/net/api.ts";
import {
  setReaderPref,
  useReaderPrefs,
  type PdfPageLayout,
  type ReadingPositionOpenPolicy,
  type SmartArrows,
} from "../../logic/settings/userPrefs.ts";
import { AccountSettings } from "../shared/AccountSettings.tsx";
import { Loading } from "../shared/Loading.tsx";
import { DropdownMenu, type DropdownTriggerProps } from "../shared/DropdownMenu.tsx";
import { Modal, ModalPagerTabs } from "../shared/Modal.tsx";
import { spawnToast } from "../shared/toast/toastStore.ts";
import { formatBytes } from "../../../shared/format.ts";

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
      Trigger={SettingDropdownTrigger}
      triggerProps={{ label: active?.label ?? value, ariaLabel }}
    />
  );
}

function SettingDropdownTrigger({
  open,
  toggle,
  label,
  ariaLabel,
}: DropdownTriggerProps & { label: string; ariaLabel: string }): React.ReactElement {
  return (
    <button
      type="button"
      className="settings-action settings-dropdown-trigger"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={toggle}
    >
      <span>{label}</span>
      <span className="book-menu-arrow" aria-hidden="true">
        ▾
      </span>
    </button>
  );
}

export interface SettingsBook {
  sourceId: string;
  groupRef: string;
}

type Category = "account" | "info" | "pdf";

// Categories are contextual. Account settings belong to the person, not a club,
// so they surface only from the homepage (no book) — the per-club settings a
// reader opens are strictly about the book (Info, PDF), never the account.
function categoriesFor(
  book: SettingsBook | undefined,
  signedIn: boolean,
): { id: Category; label: string }[] {
  if (book)
    return [
      { id: "info", label: "Info" },
      { id: "pdf", label: "PDF" },
    ];
  return signedIn ? [{ id: "account", label: "Account" }] : [];
}

export function SettingsModal({
  book,
  signedIn = false,
  onClose,
}: {
  book?: SettingsBook;
  signedIn?: boolean;
  onClose: () => void;
}): React.ReactElement {
  const categories = categoriesFor(book, signedIn);
  const [category, setCategory] = useState<Category>(categories[0]?.id ?? "account");

  const [cachedSize, setCachedSize] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { readingPositionOpenPolicy, smartArrows, pdfPageLayout } = useReaderPrefs();

  useEffect(() => {
    if (!book) return;
    let cancelled = false;
    void cachedSourceSize(book.sourceId).then((size) => {
      if (cancelled) return;
      setCachedSize(size);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [book]);

  async function onDownload(): Promise<void> {
    if (!book) return;
    setBusy(true);
    const result = await downloadSourceCopy(book.groupRef, book.sourceId);
    setBusy(false);
    if (result.ok) {
      if (isNative) {
        spawnToast("Saved for offline", "This book now reads without a connection.", {
          type: "info",
        });
        void cachedSourceSize(book.sourceId).then(setCachedSize);
      } else {
        spawnToast("Downloading book", "Saving a copy to your device.", { type: "info" });
      }
    } else {
      spawnToast("Download failed", "Couldn't fetch the book from storage.", { type: "error" });
    }
  }

  return (
    <Modal title={book ? "settings" : "account settings"} onClose={onClose}>
      <div className="modal-body settings-body">
        {category === "account" && <AccountSettings />}
        {category === "info" && book && (
          <>
            <section className="settings-item">
              <div className="settings-item-text">
                <h2 className="settings-item-head">
                  {isNative ? "Offline copy" : "Local book copy"}
                </h2>
                {loading ? (
                  <Loading className="loading--settings-detail" />
                ) : cachedSize === null ? (
                  <p className="settings-item-desc">
                    {isNative ? "Not downloaded yet." : "Not stored."}
                  </p>
                ) : (
                  <p className="settings-item-desc">
                    {isNative ? "Saved on this device" : "Browser storage"} ·{" "}
                    {formatBytes(cachedSize)}
                  </p>
                )}
              </div>
              <div className="settings-item-control">
                <button
                  type="button"
                  className="settings-action"
                  onClick={() => void onDownload()}
                  disabled={busy || loading || (isNative && cachedSize !== null)}
                  title={
                    isNative
                      ? "Save this book on your device for offline reading"
                      : "Download a copy of the book to your device"
                  }
                >
                  {busy
                    ? isNative
                      ? "saving…"
                      : "downloading…"
                    : isNative && cachedSize !== null
                      ? "Saved"
                      : isNative
                        ? "Save offline"
                        : "Download"}
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
          <>
            <section className="settings-item">
              <div className="settings-item-text">
                <h2 className="settings-item-head">Page layout</h2>
                <p className="settings-item-desc">
                  Show two pages side by side, book-style, when the screen is wide enough.
                </p>
              </div>
              <div className="settings-item-control">
                <SettingDropdown<PdfPageLayout>
                  value={pdfPageLayout}
                  onChange={(v) => setReaderPref("pdfPageLayout", v)}
                  ariaLabel="PDF page layout"
                  options={[
                    { value: "single", label: "Single page" },
                    { value: "auto", label: "Two pages" },
                  ]}
                />
              </div>
            </section>
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
          </>
        )}
      </div>
      {categories.length > 1 && (
        <ModalPagerTabs
          tabs={categories.map((c) => ({ ...c, title: `${c.label} settings` }))}
          active={category}
          onChange={setCategory}
          className="settings-tabs"
        />
      )}
    </Modal>
  );
}
