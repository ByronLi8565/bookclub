import * as Effect from "effect/Effect";
import { useEffect, useRef, useState } from "react";
import { captureHighlight } from "./highlights/captureHighlight.ts";
import { locateHighlight } from "./highlights/locateHighlight.ts";
import type { Highlight } from "./highlights/types.ts";
import { useRun } from "./runtime.tsx";
import { hashFile } from "./sources/hashFile.ts";
import { HighlightStore } from "./storage/HighlightStore.ts";
import { HighlightList } from "./ui/HighlightList.tsx";
import { Reader } from "./ui/reader/Reader.tsx";
import { useSourceView } from "./ui/reader/useSourceView.ts";
import { SplitPane } from "./ui/SplitPane.tsx";

export default function App() {
  const run = useRun();
  const [file, setFile] = useState<File | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const sourceIdRef = useRef<string | null>(null);
  sourceIdRef.current = sourceId;

  const onSelectRef = useRef<(cfi: string, range: Range) => void>(() => {});
  const view = useSourceView(file, (cfi, range) => onSelectRef.current(cfi, range));

  onSelectRef.current = (cfi, range) => {
    const sid = sourceIdRef.current;
    if (!sid) return;
    run(
      Effect.gen(function* () {
        const store = yield* HighlightStore;
        const h = yield* captureHighlight(sid, cfi, range);
        yield* store.save(h);
        setHighlights((prev) => [...prev, h]);
        view.drawHighlight(h.id, h.cfi.value, () => view.goTo(h.cfi.value));
      }),
    );
  };

  useEffect(() => {
    if (!view.ready || !sourceId) return;
    let cancelled = false;
    run(
      Effect.gen(function* () {
        const store = yield* HighlightStore;
        const saved = yield* store.list(sourceId);
        if (cancelled) return;
        setHighlights(saved);
        for (const h of saved) {
          const located = yield* locateHighlight(h, view.reader);
          if (!located) continue;
          if (located.rebound) {
            yield* store.updateCfi(h.id, located.cfi);
            h.cfi.value = located.cfi;
          }
          view.drawHighlight(h.id, located.cfi, () => view.goTo(located.cfi));
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [view.ready, sourceId]);

  function onPick(f: File) {
    setHighlights([]);
    setFile(f);
    run(hashFile(f)).then(setSourceId);
  }

  function onDelete(h: Highlight) {
    run(
      Effect.gen(function* () {
        const store = yield* HighlightStore;
        yield* store.remove(h.id);
        setHighlights((prev) => prev.filter((x) => x.id !== h.id));
      }),
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>bookclub</h1>
        <label className="picker">
          open epub
          <input
            type="file"
            accept=".epub,application/epub+zip"
            onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
          />
        </label>
        {sourceId && <code className="source-id">{sourceId.slice(0, 12)}…</code>}
      </header>
      <SplitPane
        left={<Reader view={view} hasFile={!!file} />}
        right={
          <HighlightList
            highlights={highlights}
            onJump={(h) => view.goTo(h.cfi.value)}
            onDelete={onDelete}
          />
        }
      />
    </div>
  );
}
