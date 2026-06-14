import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import { searchSource, type SearchMatch, type SourceReader } from "../../notes/highlights.ts";

// The reader's ctrl+f state machine. The search bar (Reader) renders it and the
// Mod+F hotkey (Workspace) drives `openSearch`. Jump-to-match: there is no
// results list; Enter/Shift+Enter (or the bar's arrows) cycle `active`, and the
// active match is underlined in place.
export interface ReaderSearch {
  open: boolean;
  query: string;
  matches: SearchMatch[];
  // Index into `matches` of the match currently shown, or -1 when there are none.
  active: number;
  // A search is in flight (the whole book is being scanned).
  searching: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  setQuery: (q: string) => void;
  next: () => void;
  prev: () => void;
}

// How long to wait after the last keystroke before scanning the book.
const DEBOUNCE_MS = 250;

interface Deps {
  reader: SourceReader;
  ready: boolean;
  goTo: (cfi: string) => void;
  drawUnderline: (cfi: string) => void;
  eraseUnderline: (cfi: string) => void;
}

export function useReaderSearch({
  reader,
  ready,
  goTo,
  drawUnderline,
  eraseUnderline,
}: Deps): ReaderSearch {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);

  // The cfi currently underlined, so we can erase it before painting the next.
  const paintedRef = useRef<string | null>(null);
  const fiberRef = useRef<Fiber.Fiber<void, never> | null>(null);
  const debounceRef = useRef<number | undefined>(undefined);

  const clearPaint = useCallback(() => {
    if (paintedRef.current) {
      eraseUnderline(paintedRef.current);
      paintedRef.current = null;
    }
  }, [eraseUnderline]);

  // Show match `index`: move the active marker, navigate there, and re-underline.
  const showMatch = useCallback(
    (list: SearchMatch[], index: number) => {
      clearPaint();
      const match = list[index];
      setActive(match ? index : -1);
      if (!match) return;
      goTo(match.cfi);
      drawUnderline(match.cfi);
      paintedRef.current = match.cfi;
    },
    [clearPaint, goTo, drawUnderline],
  );

  // Interrupt any in-flight scan and clear the timer; shared teardown.
  const cancelPending = useCallback(() => {
    if (debounceRef.current !== undefined) window.clearTimeout(debounceRef.current);
    debounceRef.current = undefined;
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
        const run = searchSource(reader, q).pipe(
          Effect.tap((found) =>
            Effect.sync(() => {
              setMatches(found);
              setSearching(false);
              showMatch(found, 0);
            }),
          ),
          Effect.asVoid,
          Effect.ignore,
        );
        fiberRef.current = Effect.runFork(run);
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

  const openSearch = useCallback(() => setOpen(true), []);
  const closeSearch = useCallback(() => {
    cancelPending();
    clearPaint();
    setOpen(false);
    setQueryState("");
    setMatches([]);
    setActive(-1);
    setSearching(false);
  }, [cancelPending, clearPaint]);

  // A new book (reader identity change) or unmount drops any in-flight scan and
  // resets the bar; the old rendition's underline goes with it.
  useEffect(() => {
    return () => cancelPending();
  }, [cancelPending, reader]);

  // Searching only makes sense once the book is rendered.
  useEffect(() => {
    if (!ready) {
      cancelPending();
      setOpen(false);
      setQueryState("");
      setMatches([]);
      setActive(-1);
      setSearching(false);
    }
  }, [ready, cancelPending]);

  return { open, query, matches, active, searching, openSearch, closeSearch, setQuery, next, prev };
}
