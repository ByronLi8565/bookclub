import { useEffect, useRef, useState } from "react";
import { cachedSourceSize, refreshSource } from "../../groups/sourceAccess.ts";
import { setReaderPref, useReaderPrefs, type SmartArrows } from "../../settings/readerPrefs.ts";
import { Loading } from "../shared/Loading.tsx";
import { spawnToast } from "../shared/toast/store.ts";

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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const active = options.find((o) => o.value === value);

  return (
    <div className="book-menu settings-dropdown" ref={ref}>
      <button
        type="button"
        className="settings-action settings-dropdown-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{active?.label ?? value}</span>
        <span className="book-menu-arrow" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <ul className="book-menu-list" role="menu">
          {options.map((option) => (
            <li key={option.value} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={option.value === value}
                className={option.value === value ? "book-menu-item is-active" : "book-menu-item"}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface SettingsBook {
  sourceId: string;
  name: string;
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
  const { smartArrows } = useReaderPrefs();

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
    const result = await refreshSource(book.name, book.sourceId);
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
        <div className="modal-body settings-body">
          {category === "info" && (
            <section className="settings-item">
              <div className="settings-item-text">
                <h2 className="settings-item-head">Local book copy</h2>
                {loading ? (
                  <Loading className="loading--settings-detail" />
                ) : cachedSize === null ? (
                  <p className="settings-item-desc">Not stored.</p>
                ) : (
                  <p className="settings-item-desc">
                    Stored in browser storage · {formatBytes(cachedSize)}
                  </p>
                )}
              </div>
              <div className="settings-item-control">
                <button
                  type="button"
                  className="settings-action"
                  onClick={() => void onRedownload()}
                  disabled={busy || loading}
                >
                  {busy
                    ? "redownloading…"
                    : cachedSize === null
                      ? "download a copy"
                      : "delete local copy & redownload"}
                </button>
              </div>
            </section>
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
        <div className="pager-tabs settings-tabs">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={category === c.id}
              onClick={() => setCategory(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
