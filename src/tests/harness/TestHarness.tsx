import { useHotkey } from "@tanstack/react-hotkeys";
import { useEffect, useState } from "react";
import { Reader } from "../../client/ui/reader/Reader.tsx";
import { useSourceView } from "../../client/ui/reader/useSourceView.ts";

export function ReaderHarness() {
  const [file, setFile] = useState<File | null>(null);
  const view = useSourceView(
    { id: "harness", kind: "epub", contentType: "application/epub+zip" },
    file,
    () => {},
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
        if (!cancelled) setFile(new File([b], url.split("/").pop() ?? "book.epub"));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <button
        className="harness-open-search"
        onClick={() => view.search.openSearch()}
        disabled={!view.ready}
      >
        search
      </button>
      <Reader view={view} hasFile={file !== null} floatingNote={false} />
    </div>
  );
}
