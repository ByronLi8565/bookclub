import { useHotkey } from "@tanstack/react-hotkeys";
import { useEffect, useState } from "react";
import { Reader } from "../../client/ui/reader/Reader.tsx";
import { useSourceView } from "../../client/ui/reader/useSourceView.ts";
import { MobilePager, type Pane } from "../../client/ui/shared/MobilePager.tsx";

export function ReaderHarness() {
  const [file, setFile] = useState<File | null>(null);
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
  useHotkey("Escape", () => view.search.closeSearch(), { enabled: view.search.open });

  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get("book");
    if (!url) return;
    let cancelled = false;
    void fetch(url)
      .then((r) => r.blob())
      .then((b) => {
        if (!cancelled) setFile(new File([b], url.split("/").pop()?.split("?")[0] ?? "book.epub"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reader = <Reader view={view} hasFile={file !== null} floatingNote={!mobile} />;

  return (
    <div className="app">
      <button
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
