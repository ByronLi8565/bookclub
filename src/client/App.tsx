import { useHotkey } from "@tanstack/react-hotkeys";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { createCard } from "./cards/createCard.ts";
import type { Card } from "./cards/types.ts";
import { captureHighlight } from "./highlights/captureHighlight.ts";
import { locateHighlight } from "./highlights/locateHighlight.ts";
import { useRun } from "./runtime.tsx";
import { hashFile } from "./sources/hashFile.ts";
import { CardStore } from "./storage/CardStore.ts";
import { CardPanel } from "./ui/CardPanel.tsx";
import { Reader } from "./ui/reader/Reader.tsx";
import { useSourceView } from "./ui/reader/useSourceView.ts";
import { SplitPane } from "./ui/SplitPane.tsx";

export default function App() {
  const run = useRun();
  const [file, setFile] = useState<File | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const sourceIdRef = useRef<string | null>(null);
  sourceIdRef.current = sourceId;
  const filePickRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onSelectRef = useRef<(cfi: string, range: Range) => void>(() => {});
  const view = useSourceView(file, (cfi, range) => onSelectRef.current(cfi, range));

  useHotkey("Mod+O", () => fileInputRef.current?.click(), { preventDefault: true });
  useHotkey("ArrowLeft", () => view.prev(), { enabled: view.ready });
  useHotkey("ArrowRight", () => view.next(), { enabled: view.ready });

  // Add Note: capture the highlight synchronously (never retain the live range),
  // paint it, and create an empty-body card. The editor arrives in Step 2.
  onSelectRef.current = (cfi, range) => {
    const sid = sourceIdRef.current;
    if (!sid) return;
    run(
      Effect.gen(function* () {
        const store = yield* CardStore;
        const highlight = yield* captureHighlight(sid, cfi, range);
        const card = yield* createCard(sid, "", [highlight]);
        yield* store.save(card);
        setCards((prev) => [...prev, card]);
        view.drawHighlight(highlight.id, highlight.cfi.value, () => view.goTo(highlight.cfi.value));
      }),
    );
  };

  useEffect(() => {
    if (!view.ready || !sourceId) return;
    let cancelled = false;
    run(
      Effect.gen(function* () {
        const store = yield* CardStore;
        const saved = yield* store.list(sourceId);
        if (cancelled) return;
        setCards(saved);
        // Re-locate every embedded highlight, rebinding cfis that drifted.
        const rebinds = new Map<string, Map<string, string>>();
        for (const card of saved) {
          for (const h of card.highlights) {
            if (cancelled) return;
            const located = yield* locateHighlight(h, view.reader);
            if (!located) continue;
            if (located.cfi !== h.cfi.value) {
              yield* store.updateHighlightCfi(card.id, h.id, located.cfi);
              const perCard = rebinds.get(card.id) ?? new Map<string, string>();
              perCard.set(h.id, located.cfi);
              rebinds.set(card.id, perCard);
            }
            const cfi = located.cfi;
            view.drawHighlight(h.id, cfi, () => view.goTo(cfi));
          }
        }
        if (!cancelled && rebinds.size > 0) {
          setCards((prev) =>
            prev.map((card) => {
              const perCard = rebinds.get(card.id);
              if (!perCard) return card;
              return {
                ...card,
                highlights: card.highlights.map((h) => {
                  const cfi = perCard.get(h.id);
                  return cfi ? { ...h, cfi: { ...h.cfi, value: cfi } } : h;
                }),
              };
            }),
          );
        }
      }),
    );
    return () => {
      cancelled = true;
    };
    // Intentionally re-run only when the source becomes ready, not on every view identity change.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [view.ready, sourceId]);

  const onPick = useCallback(
    (f: File) => {
      const pickId = ++filePickRef.current;
      setCards([]);
      setSourceId(null);
      setFile(f);
      run(hashFile(f)).then((id) => {
        if (filePickRef.current === pickId) setSourceId(id);
      });
    },
    [run],
  );

  // TEMP: accept ?book=<url> to auto-load a fixture (used by the bombadil test).
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get("book");
    if (!url) return;
    fetch(url)
      .then((r) => r.blob())
      .then((b) => onPick(new File([b], url.split("/").pop() ?? "book.epub")));
  }, [onPick]);

  function onDelete(card: Card) {
    run(
      Effect.gen(function* () {
        const store = yield* CardStore;
        yield* store.remove(card.id);
        for (const h of card.highlights) view.eraseHighlight(h.cfi.value);
        setCards((prev) => prev.filter((x) => x.id !== card.id));
      }),
    );
  }

  function onJump(card: Card) {
    const cfi = card.highlights[0]?.cfi.value;
    if (cfi) view.goTo(cfi);
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>bookclub</h1>
        <label className="picker">
          open epub
          <input
            ref={fileInputRef}
            type="file"
            accept=".epub,application/epub+zip"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onPick(f);
            }}
          />
        </label>
        {sourceId && <code className="source-id">{sourceId.slice(0, 12)}…</code>}
      </header>
      <SplitPane
        left={<Reader view={view} hasFile={!!file} />}
        right={<CardPanel cards={cards} onJump={onJump} onDelete={onDelete} />}
      />
    </div>
  );
}
