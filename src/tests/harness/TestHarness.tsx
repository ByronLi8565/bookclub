import { useHotkey } from "@tanstack/react-hotkeys";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { HighlightAnchor } from "../../client/logic/notes/highlights.ts";
import { setReaderPref, useReaderPrefs } from "../../client/logic/settings/userPrefs.ts";
import { Reader } from "../../client/ui/reader/Reader.tsx";
import { useSourceView, type SourceView } from "../../client/ui/reader/useSourceView.ts";
import { MobilePager, type Pane } from "../../client/ui/shared/MobilePager.tsx";
import {
  stepChromeVisibility,
  type ChromeVisibilityLevel,
} from "../../client/ui/workspace/chromeVisibility.ts";

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
  const params = new URLSearchParams(window.location.search);
  const mobile = params.get("mobile") === "1";
  const showTopbar = params.get("chrome") === "1";
  const [pane, setPane] = useState<Pane>("reader");
  const [chromeLevel, setChromeLevel] = useState<ChromeVisibilityLevel>(0);
  const chromeToggleFrameRef = useRef<number | null>(null);
  const viewRef = useRef<SourceView | null>(null);
  const highlightIdRef = useRef(0);
  const isPdf = file?.name.toLowerCase().endsWith(".pdf") ?? false;
  const { pdfPageLayout } = useReaderPrefs();
  const view = useSourceView(
    isPdf
      ? { id: "harness", kind: "pdf", contentType: "application/pdf" }
      : { id: "harness", kind: "epub", contentType: "application/epub+zip" },
    file,
    (anchor: HighlightAnchor) => {
      const id = `harness-highlight-${++highlightIdRef.current}`;
      viewRef.current?.drawHighlight(id, anchor, () => {});
    },
    (dir) => {
      if (dir === "left") setPane("notes");
      else if (dir === "right") setPane("reader");
      else setChromeLevel((level) => stepChromeVisibility(level, dir === "up" ? "hide" : "show"));
    },
  );
  viewRef.current = view;

  useEffect(
    () => () => {
      if (chromeToggleFrameRef.current !== null) cancelAnimationFrame(chromeToggleFrameRef.current);
    },
    [],
  );

  useHotkey("Mod+F", () => view.search.openSearch(), { enabled: view.ready, preventDefault: true });
  useHotkey("Escape", () => view.search.closeSearch(), {
    enabled: view.search.open,
    conflictBehavior: "allow",
  });
  useHotkey(
    "D",
    () => setReaderPref("pdfPageLayout", pdfPageLayout === "auto" ? "single" : "auto"),
    { enabled: view.ready, requireReset: true },
  );
  useHotkey("Shift+ArrowUp", () => setChromeLevel((level) => stepChromeVisibility(level, "hide")), {
    enabled: view.ready,
    preventDefault: true,
  });
  useHotkey(
    "Shift+ArrowDown",
    () => setChromeLevel((level) => stepChromeVisibility(level, "show")),
    { enabled: view.ready, preventDefault: true },
  );
  useHotkey(
    "Z",
    () => {
      if (chromeToggleFrameRef.current !== null) return;
      chromeToggleFrameRef.current = requestAnimationFrame(() => {
        chromeToggleFrameRef.current = null;
        setChromeLevel((level) => (level === 0 ? 2 : 0));
      });
    },
    { enabled: view.ready, preventDefault: true, requireReset: true },
  );

  const reader = (
    <Reader
      view={view}
      hasFile={file !== null}
      floatingNote={!mobile}
      chromeHidden={chromeLevel >= 2}
    />
  );

  return (
    <div className={chromeLevel >= 1 ? "app app--chrome-hidden" : "app"}>
      {showTopbar && <header className="topbar">Reader test harness</header>}
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
          onAddNote={() => view.commitSelection("note")}
          onHighlight={() => view.commitSelection("highlight")}
          onChromeHiddenChange={(hidden) =>
            setChromeLevel((level) => stepChromeVisibility(level, hidden ? "hide" : "show"))
          }
        />
      ) : (
        reader
      )}
    </div>
  );
}
