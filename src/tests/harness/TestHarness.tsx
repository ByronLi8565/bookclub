import { useHotkey } from "@tanstack/react-hotkeys";
import { useState, useSyncExternalStore } from "react";
import { Reader } from "../../client/ui/reader/Reader.tsx";
import { useSourceView } from "../../client/ui/reader/useSourceView.ts";
import { MobilePager, type Pane } from "../../client/ui/shared/MobilePager.tsx";

let harnessBook: File | null = null;
let harnessBookUrl: string | null = null;
const harnessBookListeners = new Set<() => void>();

function setHarnessBook(file: File | null): void {
  harnessBook = file;
  for (const listener of harnessBookListeners) listener();
}

function ensureHarnessBookLoaded(): void {
  const url = new URLSearchParams(window.location.search).get("book");
  if (!url || harnessBookUrl === url) return;
  harnessBookUrl = url;
  void fetch(url)
    .then((r) => r.blob())
    .then((blob) =>
      setHarnessBook(new File([blob], url.split("/").pop()?.split("?")[0] ?? "book.epub")),
    )
    .catch(() => setHarnessBook(null));
}

function subscribeHarnessBook(listener: () => void): () => void {
  harnessBookListeners.add(listener);
  ensureHarnessBookLoaded();
  return () => harnessBookListeners.delete(listener);
}

export function ReaderHarness() {
  const file = useSyncExternalStore(
    subscribeHarnessBook,
    () => harnessBook,
    () => harnessBook,
  );
  // `?mobile=1` renders the reader inside the real mobile shell (MobilePager:
  // react-swipeable + a translateX pane track) so the harness matches what
  // ships on phones, instead of mounting <Reader> bare.
  const mobile = new URLSearchParams(window.location.search).get("mobile") === "1";
  const [pane, setPane] = useState<Pane>("reader");
  const isPdf = file?.name.toLowerCase().endsWith(".pdf") ?? false;
  const view = useSourceView(
    isPdf
      ? { id: "harness", kind: "pdf", contentType: "application/pdf" }
      : { id: "harness", kind: "epub", contentType: "application/epub+zip" },
    file,
    () => {},
    (dir) => setPane(dir === "left" ? "notes" : "reader"),
  );

  useHotkey("Mod+F", () => view.search.openSearch(), { enabled: view.ready, preventDefault: true });
  useHotkey("Escape", () => view.search.closeSearch(), {
    enabled: view.search.open,
    conflictBehavior: "allow",
  });

  const reader = <Reader view={view} hasFile={file !== null} floatingNote={!mobile} />;

  return (
    <div className="app">
      <button
        type="button"
        className="harness-open-search"
        onClick={() => view.search.openSearch()}
        disabled={!view.ready}
      >
        search
      </button>
      {mobile ? (
        <MobilePager
          pane={pane}
          onPane={setPane}
          reader={reader}
          notes={<div className="harness-notes">notes</div>}
          selecting={view.selection !== null}
          onAddNote={view.commitSelection}
        />
      ) : (
        reader
      )}
    </div>
  );
}
