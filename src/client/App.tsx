import { useHotkey } from "@tanstack/react-hotkeys";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { captureHighlight } from "./highlights/captureHighlight.ts";
import { locateHighlight } from "./highlights/locateHighlight.ts";
import type { Highlight } from "./highlights/types.ts";
import { createNote } from "./notes/createNote.ts";
import type { Note } from "./notes/types.ts";
import { useRun } from "./runtime.tsx";
import { hashFile } from "./sources/hashFile.ts";
import { NoteStore } from "./storage/NoteStore.ts";
import { NotePanel } from "./ui/NotePanel.tsx";
import { Reader } from "./ui/reader/Reader.tsx";
import { useSourceView } from "./ui/reader/useSourceView.ts";
import { SplitPane } from "./ui/SplitPane.tsx";

export default function App() {
  const run = useRun();
  const [file, setFile] = useState<File | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  // The armed highlight being composed into a new note (painted, awaiting save).
  const [composing, setComposing] = useState<Highlight | null>(null);
  const composingRef = useRef<Highlight | null>(null);
  composingRef.current = composing;
  const [editingId, setEditingId] = useState<string | null>(null);
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
  // paint it, and arm the compose slot. The note is created only on save.
  onSelectRef.current = (cfi, range) => {
    const sid = sourceIdRef.current;
    if (!sid) return;
    run(
      Effect.gen(function* () {
        const highlight = yield* captureHighlight(sid, cfi, range);
        // Replace any in-flight compose: erase its orphaned paint first.
        const prev = composingRef.current;
        if (prev) view.eraseHighlight(prev.cfi.value);
        view.drawHighlight(highlight.id, highlight.cfi.value, () => view.goTo(highlight.cfi.value));
        setComposing(highlight);
      }),
    );
  };

  function onComposeSave(body: string) {
    const sid = sourceIdRef.current;
    const highlight = composingRef.current;
    if (!sid || !highlight) return;
    run(
      Effect.gen(function* () {
        const store = yield* NoteStore;
        const note = yield* createNote(sid, body, [highlight]);
        yield* store.save(note);
        setNotes((prev) => [...prev, note]);
        setComposing(null);
      }),
    );
  }

  function onComposeCancel() {
    const highlight = composingRef.current;
    if (highlight) view.eraseHighlight(highlight.cfi.value);
    setComposing(null);
  }

  function onEditSave(note: Note, body: string) {
    run(
      Effect.gen(function* () {
        const store = yield* NoteStore;
        const updated: Note = {
          ...note,
          body,
          editedAt: new Date().toISOString(),
          version: note.version + 1,
        };
        yield* store.save(updated);
        setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)));
        setEditingId(null);
      }),
    );
  }

  useEffect(() => {
    if (!view.ready || !sourceId) return;
    let cancelled = false;
    run(
      Effect.gen(function* () {
        const store = yield* NoteStore;
        const saved = yield* store.list(sourceId);
        if (cancelled) return;
        setNotes(saved);
        // Re-locate every embedded highlight, rebinding cfis that drifted.
        const rebinds = new Map<string, Map<string, string>>();
        for (const note of saved) {
          for (const h of note.highlights) {
            if (cancelled) return;
            const located = yield* locateHighlight(h, view.reader);
            if (!located) continue;
            if (located.cfi !== h.cfi.value) {
              yield* store.updateHighlightCfi(note.id, h.id, located.cfi);
              const perNote = rebinds.get(note.id) ?? new Map<string, string>();
              perNote.set(h.id, located.cfi);
              rebinds.set(note.id, perNote);
            }
            const cfi = located.cfi;
            view.drawHighlight(h.id, cfi, () => view.goTo(cfi));
          }
        }
        if (!cancelled && rebinds.size > 0) {
          setNotes((prev) =>
            prev.map((note) => {
              const perNote = rebinds.get(note.id);
              if (!perNote) return note;
              return {
                ...note,
                highlights: note.highlights.map((h) => {
                  const cfi = perNote.get(h.id);
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
      setNotes([]);
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

  function onDelete(note: Note) {
    run(
      Effect.gen(function* () {
        const store = yield* NoteStore;
        yield* store.remove(note.id);
        for (const h of note.highlights) view.eraseHighlight(h.cfi.value);
        setNotes((prev) => prev.filter((x) => x.id !== note.id));
        setEditingId((id) => (id === note.id ? null : id));
      }),
    );
  }

  function onJump(note: Note) {
    const cfi = note.highlights[0]?.cfi.value;
    if (cfi) view.goTo(cfi);
  }

  // Seed a new note's body with the highlighted passage as a blockquote, then a
  // blank paragraph for the note text.
  const composeInitialBody = composing
    ? `> ${composing.quote.exact.replaceAll(/\s+/gu, " ").trim()}\n\n`
    : "";

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
        right={
          <NotePanel
            notes={notes}
            composing={composing !== null}
            composeInitialBody={composeInitialBody}
            editingId={editingId}
            onComposeSave={onComposeSave}
            onComposeCancel={onComposeCancel}
            onEdit={(note) => setEditingId(note.id)}
            onEditSave={onEditSave}
            onEditCancel={() => setEditingId(null)}
            onJump={onJump}
            onDelete={onDelete}
          />
        }
      />
    </div>
  );
}
