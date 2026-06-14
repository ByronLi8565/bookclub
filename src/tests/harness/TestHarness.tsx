import { useHotkey } from "@tanstack/react-hotkeys";
import { useEffect, useState } from "react";
import { Reader } from "../../client/ui/reader/Reader.tsx";
import { useSourceView } from "../../client/ui/reader/useSourceView.ts";

// A minimal standalone mount of the reader, free of auth/groups, used by tests
// and manual repro. It loads an epub from `?book=<url>` (e.g. the dorian fixture
// served at /fixtures/dorian.epub) and renders the real Reader + useSourceView,
// so the search/highlight code is exercised exactly as it is in production.
//
// This deliberately lives in src/tests: it is test wiring, not shipped UI.
export function ReaderHarness() {
  const [file, setFile] = useState<File | null>(null);
  const view = useSourceView(file, () => {});

  // Same key bindings the workspace wires up, so the keyboard path is covered.
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
      {/* A bombadil-clickable affordance to open search without a modifier combo. */}
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
