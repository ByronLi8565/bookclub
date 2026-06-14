import { useHotkey } from "@tanstack/react-hotkeys";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { captureHighlight, type Highlight } from "./highlights.ts";
import { effectiveHighlight, noteSnippet, type Note } from "./notes.ts";
import { hashFile } from "./storage/hashFile.ts";
import { NotePanel } from "./ui/NotePanel.tsx";
import type { NoteRefs } from "./ui/NoteThread.tsx";
import { Reader } from "./ui/reader/Reader.tsx";
import {
  updateHighlights,
  type DesiredHighlight,
  type HighlightPainter,
} from "./ui/reader/highlightReconciler.ts";
import { useSourceView } from "./ui/reader/useSourceView.ts";
import { SplitPane } from "./ui/SplitPane.tsx";
import { spawnToast, ToastViewport } from "./ui/toast.tsx";
import { useNoteAgent } from "./useNoteAgent.ts";

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  // Notes are owned by the durable object; this is its live broadcast state.
  const agent = useNoteAgent(sourceId);
  const notes = agent.notes;
  const canWriteNotes = agent.syncStatus === "online";

  // The armed highlight being composed into a new note (painted, awaiting save).
  const [composing, setComposing] = useState<Highlight | null>(null);
  const composingRef = useRef<Highlight | null>(null);
  composingRef.current = composing;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const sourceIdRef = useRef<string | null>(null);
  sourceIdRef.current = sourceId;
  const filePickRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onSelectRef = useRef<(cfi: string, range: Range) => void>(() => {});
  const view = useSourceView(file, (cfi, range) => onSelectRef.current(cfi, range));

  useHotkey("Mod+O", () => fileInputRef.current?.click(), { preventDefault: true });
  useHotkey("ArrowLeft", () => view.prev(), { enabled: view.ready });
  useHotkey("ArrowRight", () => view.next(), { enabled: view.ready });

  // Which embedded highlights are currently painted on the rendition, mapped to
  // the cfi they were drawn at, so the sync effect can diff against live state.
  const drawnRef = useRef<Map<string, string>>(new Map());

  // Add Note: capture the highlight synchronously (never retain the live range),
  // paint it, and arm the compose slot. The note is created only on save.
  onSelectRef.current = (cfi, range) => {
    const sid = sourceIdRef.current;
    if (!sid) return;
    Effect.runPromise(captureHighlight(sid, cfi, range)).then((highlight) => {
      // Replace any in-flight compose: erase its orphaned paint first.
      const prev = composingRef.current;
      if (prev) {
        view.eraseHighlight(prev.cfi.value);
        drawnRef.current.delete(prev.id);
      }
      view.drawHighlight(highlight.id, highlight.cfi.value, () => view.goTo(highlight.cfi.value));
      drawnRef.current.set(highlight.id, highlight.cfi.value);
      setComposing(highlight);
    });
  };

  function onComposeSave(body: string) {
    const highlight = composingRef.current;
    if (!sourceIdRef.current || !highlight) return;
    if (agent.addNote(body, [highlight])) setComposing(null);
  }

  function onComposeCancel() {
    const highlight = composingRef.current;
    if (highlight) {
      view.eraseHighlight(highlight.cfi.value);
      drawnRef.current.delete(highlight.id);
    }
    setComposing(null);
  }

  function onEditSave(note: Note, body: string) {
    if (agent.editNote(note.id, body)) setEditingId(null);
  }

  function onReplySave(parentId: string, body: string) {
    // An empty reply has nothing to show (no highlight, no body); discard it.
    if (body === "") {
      setReplyingTo(null);
      return;
    }
    if (agent.addReply(parentId, body)) setReplyingTo(null);
  }

  // Keep the rendition's painted highlights in sync with the live note state.
  // The reconciler draws (and rebinds drifted cfis for) highlights that appear
  // and erases those that leave; we just hand it the desired set, a painter, and
  // a cancel flag. Runs on every state change, so a peer's note shows up here too.
  useEffect(() => {
    if (!view.ready) return;
    let cancelled = false;

    const desired: DesiredHighlight[] = [];
    for (const note of notes) {
      for (const h of note.highlights) desired.push({ noteId: note.id, highlight: h });
    }
    // The composing highlight is painted but not yet in state; keep it alive.
    const comp = composingRef.current;
    if (comp) desired.push({ noteId: null, highlight: comp });

    const painter: HighlightPainter = {
      draw: (id, cfi) => view.drawHighlight(id, cfi, () => view.goTo(cfi)),
      erase: (cfi) => view.eraseHighlight(cfi),
    };

    void updateHighlights(desired, drawnRef.current, {
      reader: view.reader,
      painter,
      rebind: agent.rebindHighlight,
      isCancelled: () => cancelled,
    });

    return () => {
      cancelled = true;
    };
    // Re-run on state changes and when the book becomes ready, not on every view identity change.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, view.ready]);

  // A new book means a new rendition with no annotations; forget what we drew.
  useEffect(() => {
    drawnRef.current.clear();
  }, [sourceId]);

  const onPick = useCallback((f: File) => {
    const pickId = ++filePickRef.current;
    setSourceId(null);
    setComposing(null);
    setFile(f);
    Effect.runPromise(hashFile(f)).then((id) => {
      if (filePickRef.current === pickId) setSourceId(id);
    });
  }, []);

  // TEMP: accept ?book=<url> to auto-load a fixture (used by the bombadil test).
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get("book");
    if (!url) return;
    fetch(url)
      .then((r) => r.blob())
      .then((b) => onPick(new File([b], url.split("/").pop() ?? "book.epub")));
  }, [onPick]);

  function onDelete(note: Note) {
    // Erasing the paint is handled by the sync effect once the note leaves state.
    if (!agent.removeNote(note.id)) return;
    setEditingId((id) => (id === note.id ? null : id));
    setReplyingTo((id) => (id === note.id ? null : id));
  }

  // Lookups for references: id -> note (anchor inheritance), seq -> note (jump
  // target), and seq -> snippet (chip hover). Built once per note-state change.
  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n] as const)), [notes]);
  const bySeq = useMemo(() => new Map(notes.map((n) => [n.seq, n] as const)), [notes]);
  const noteRefs = useMemo<NoteRefs>(
    () => ({
      validSeqs: new Set(bySeq.keys()),
      byId,
      refs: new Map([...bySeq].map(([seq, n]) => [seq, noteSnippet(n)] as const)),
    }),
    [byId, bySeq],
  );

  const { goTo } = view;

  // Scroll the panel to a note and flash it. Shared by every "go to this note"
  // path (jumping from the note itself, or following a `[[n]]` reference) so the
  // feedback is consistent.
  const flashNote = useCallback((seq: number) => {
    const el = document.getElementById(`note-${seq}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash");
    requestAnimationFrame(() => {
      el.classList.add("flash");
      window.setTimeout(() => el.classList.remove("flash"), 1200);
    });
  }, []);

  const onJump = useCallback(
    (note: Note) => {
      const hl = effectiveHighlight(note, byId);
      if (hl) goTo(hl.cfi.value);
      flashNote(note.seq);
    },
    [byId, goTo, flashNote],
  );

  // Click a `[[n]]` chip: jump the reader to note n's (inherited) highlight and
  // flash it in the panel.
  const onReference = useCallback(
    (seq: number) => {
      const target = bySeq.get(seq);
      if (!target) return;
      const hl = effectiveHighlight(target, byId);
      if (hl) goTo(hl.cfi.value);
      flashNote(seq);
    },
    [bySeq, byId, goTo, flashNote],
  );

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
        {sourceId && (
          <button
            type="button"
            className={`sync-badge sync-badge--${agent.syncStatus}`}
            onClick={() => showSyncStatusToast(agent.syncStatus, sourceId)}
            aria-label="show sync status"
          >
            {agent.syncStatus}
          </button>
        )}
      </header>
      <SplitPane
        left={<Reader view={view} hasFile={!!file} />}
        right={
          <NotePanel
            notes={notes}
            canWrite={canWriteNotes}
            composing={composing !== null}
            composeInitialBody={composeInitialBody}
            onComposeSave={onComposeSave}
            onComposeCancel={onComposeCancel}
            refs={noteRefs}
            actions={{
              editingId,
              replyingTo,
              onJump,
              onReference,
              onDelete,
              onEdit: (note) => setEditingId(note.id),
              onEditSave,
              onEditCancel: () => setEditingId(null),
              onReply: (note) => setReplyingTo(note.id),
              onReplySave,
              onReplyCancel: () => setReplyingTo(null),
            }}
          />
        }
      />
      <ToastViewport />
    </div>
  );
}

function showSyncStatusToast(status: "syncing" | "online" | "offline", sourceId: string): void {
  if (status === "online") {
    spawnToast("Status: Online", `Synced to book with hash ${sourceId}.`, { type: "info" });
    return;
  }
  if (status === "syncing") {
    spawnToast("Status: Syncing", `Connecting to book with hash ${sourceId}.`, { type: "info" });
    return;
  }
  spawnToast("Status: Offline", `Offline for book with hash ${sourceId}.`, { type: "error" });
}
