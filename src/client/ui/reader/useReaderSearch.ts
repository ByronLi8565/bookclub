import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import type { HighlightAnchor, SearchMatch, SourceReader } from "../../logic/notes/highlights.ts";

export interface ReaderSearch {
  open: boolean;
  query: string;
  matches: SearchMatch[];

  active: number;

  searching: boolean;
  // Bumped on every openSearch so the input can re-focus + select-all even when
  // the panel is already open (lets a second Ctrl+F restart the query).
  focusTick: number;
  openSearch: () => void;
  closeSearch: () => void;
  setQuery: (q: string) => void;
  next: () => void;
  prev: () => void;
}

const DEBOUNCE_MS = 250;

interface Deps {
  reader: SourceReader;
  ready: boolean;
  goTo: (anchor: HighlightAnchor) => Promise<void>;
  drawSearchHighlight: (anchor: HighlightAnchor) => void;
  eraseSearchHighlight: (anchor: HighlightAnchor) => void;
  onSearchHighlightCleared?: () => void;
}

export function useReaderSearch({
  reader,
  ready,
  goTo,
  drawSearchHighlight,
  eraseSearchHighlight,
  onSearchHighlightCleared,
}: Deps): ReaderSearch {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const [readySnapshot, setReadySnapshot] = useState(ready);

  const paintedRef = useRef<HighlightAnchor | null>(null);
  const fiberRef = useRef<Fiber.Fiber<void, never> | null>(null);
  const debounceRef = useRef<number | null>(null);

  if (readySnapshot !== ready) {
    setReadySnapshot(ready);
    if (!ready) {
      setOpen(false);
      setQueryState("");
      setMatches([]);
      setActive(-1);
      setSearching(false);
    }
  }

  const clearPaint = useCallback(() => {
    if (paintedRef.current) {
      eraseSearchHighlight(paintedRef.current);
      paintedRef.current = null;
      onSearchHighlightCleared?.();
    }
  }, [eraseSearchHighlight, onSearchHighlightCleared]);

  const showMatch = useCallback(
    (list: SearchMatch[], index: number) => {
      clearPaint();
      const match = list[index];
      setActive(match ? index : -1);
      if (!match) return;
      void goTo(match.anchor);
      drawSearchHighlight(match.anchor);
      paintedRef.current = match.anchor;
    },
    [clearPaint, goTo, drawSearchHighlight],
  );

  const cancelPending = useCallback(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = null;
    if (fiberRef.current) {
      Effect.runFork(Fiber.interrupt(fiberRef.current));
      fiberRef.current = null;
    }
  }, []);

  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);
      cancelPending();
      clearPaint();
      if (q.trim() === "") {
        setMatches([]);
        setActive(-1);
        setSearching(false);
        return;
      }
      setSearching(true);
      debounceRef.current = window.setTimeout(() => {
        const run = Effect.fn("ReaderSearch.search")(function* () {
          const found = yield* reader.search(q);
          setMatches(found);
          setSearching(false);
          showMatch(found, 0);
        });
        fiberRef.current = Effect.runFork(
          run().pipe(Effect.catch(() => Effect.sync(() => setSearching(false)))),
        );
      }, DEBOUNCE_MS);
    },
    [reader, cancelPending, clearPaint, showMatch],
  );

  const next = useCallback(() => {
    if (matches.length === 0) return;
    showMatch(matches, (active + 1) % matches.length);
  }, [matches, active, showMatch]);

  const prev = useCallback(() => {
    if (matches.length === 0) return;
    showMatch(matches, (active - 1 + matches.length) % matches.length);
  }, [matches, active, showMatch]);

  const openSearch = useCallback(() => {
    setOpen(true);
    setFocusTick((t) => t + 1);
  }, []);
  const closeSearch = useCallback(() => {
    cancelPending();
    clearPaint();
    setOpen(false);
    setQueryState("");
    setMatches([]);
    setActive(-1);
    setSearching(false);
  }, [cancelPending, clearPaint]);

  useEffect(() => {
    if (!ready) return;
    return () => cancelPending();
  }, [ready, cancelPending, reader]);

  return {
    open,
    query,
    matches,
    active,
    searching,
    focusTick,
    openSearch,
    closeSearch,
    setQuery,
    next,
    prev,
  };
}
