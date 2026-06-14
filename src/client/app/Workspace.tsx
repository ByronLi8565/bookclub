import { useHotkey } from "@tanstack/react-hotkeys";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types/notes.ts";
import type { SourceRef, SourceSummary } from "../../shared/types/sources.ts";
import type { BookUpload } from "../groups/useBookUpload.ts";
import { renameGroup, type RosterEntry } from "../groups/api.ts";
import { useNoteAgent } from "../notes/agent.ts";
import { buildConversation } from "../notes/conversation.ts";
import { captureHighlight, type Highlight, type HighlightAnchor } from "../notes/highlights.ts";
import { effectiveHighlight, noteSnippet } from "../notes/render.ts";
import { InviteModal } from "../ui/group/InviteModal.tsx";
import { PresenceModal } from "../ui/group/PresenceModal.tsx";
import { MobilePager, type Pane } from "../ui/shared/MobilePager.tsx";
import { SplitPane } from "../ui/shared/SplitPane.tsx";
import { spawnToast, showSyncStatusToast } from "../ui/shared/toast/store.ts";
import { ToastViewport } from "../ui/shared/toast/ToastViewport.tsx";
import { useIsMobile } from "../ui/shared/hooks/useIsMobile.ts";
import { NotePanel } from "../ui/notes/NotePanel.tsx";
import type { NoteRefs, NoteViewer } from "../ui/notes/NoteThread.tsx";
import { Reader } from "../ui/reader/Reader.tsx";
import {
  updateHighlights,
  type DesiredHighlight,
  type HighlightPainter,
} from "../ui/reader/highlightReconciler.ts";
import { useSourceView } from "../ui/reader/useSourceView.ts";
import { WorkspaceHeader } from "../ui/workspace/WorkspaceHeader.tsx";

// The reader + notes workspace (the Steps 1-5 app), mounted by GroupView at
// `/:name` for a group the caller is a member of. The book and its sourceId
// (content hash) are supplied by the group; the NoteAgent is keyed by groupId
// (decision 6), so all of the group's notes flow through one instance.
export interface WorkspaceProps {
  name: string; // the group's URL name (for invite/title APIs)
  groupName: string; // the group's display name
  groupId: string;
  source: SourceRef; // the active source (content hash + kind + content type)
  file: File | null;
  // A member-set source title override, if any (else the source metadata title).
  bookTitleOverride: string | null;
  // The club's library and which book is active, for the reader's book switcher.
  books: SourceSummary[];
  selectedSourceId: string;
  onSelectBook: (sourceId: string) => void;
  // Owner-only "add a book" affordance; null for non-owners (hides the action).
  bookUpload: BookUpload | null;
  members: RosterEntry[];
  // The signed-in caller, used to gate edit/delete affordances (decision 7).
  viewer: NoteViewer;
}

export function Workspace({
  name,
  groupName,
  groupId,
  source,
  file,
  books,
  selectedSourceId,
  onSelectBook,
  bookUpload,
  members,
  viewer,
}: WorkspaceProps) {
  const sourceId = source.id;
  const [inviting, setInviting] = useState(false);
  const [showingPresence, setShowingPresence] = useState(false);
  // Phone layout: which of the two swipeable pages is showing (decision: a
  // selection jumps to notes; a jump/reference returns to the reader).
  const isMobile = useIsMobile();
  const [pane, setPane] = useState<Pane>("reader");
  // Local override so a rename shows immediately (propagation is refetch-only).
  const [displayName, setDisplayName] = useState(groupName);
  // Notes are owned by the durable object; this is its live broadcast state. One
  // NoteAgent serves the whole club (decision 6), so notes for every book flow
  // through it; scope to the active book before rendering and reconciling.
  const agent = useNoteAgent(groupId);
  const notes = useMemo(
    () => agent.notes.filter((n) => n.sourceId === sourceId),
    [agent.notes, sourceId],
  );
  const canWriteNotes = agent.syncStatus === "online";

  // The armed highlight being composed into a new note (painted, awaiting save).
  const [composing, setComposing] = useState<Highlight | null>(null);
  const composingRef = useRef<Highlight | null>(null);
  composingRef.current = composing;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const sourceIdRef = useRef<string | null>(null);
  sourceIdRef.current = sourceId;

  const onSelectRef = useRef<(anchor: HighlightAnchor, range: Range) => void>(() => {});
  const view = useSourceView(
    source,
    file,
    (anchor, range) => onSelectRef.current(anchor, range),
    (dir) => setPane(dir === "left" ? "notes" : "reader"),
  );

  useHotkey("ArrowLeft", () => view.prev(), { enabled: view.ready });
  useHotkey("ArrowRight", () => view.next(), { enabled: view.ready });
  // Override the browser's native find with the reader's full-text search.
  useHotkey("Mod+F", () => view.search.openSearch(), { enabled: view.ready, preventDefault: true });
  useHotkey("Escape", () => view.search.closeSearch(), { enabled: view.search.open });

  // Which embedded highlights are currently painted on the reader, mapped to the
  // anchor they were drawn at, so the sync effect can diff against live state.
  const drawnRef = useRef<Map<string, HighlightAnchor>>(new Map());

  // Add Note: capture the highlight synchronously (never retain the live range),
  // paint it, and arm the compose slot. The note is created only on save.
  onSelectRef.current = (anchor, range) => {
    const sid = sourceIdRef.current;
    if (!sid) return;
    Effect.runPromise(captureHighlight(sid, anchor, range)).then((highlight) => {
      // Replace any in-flight compose: erase its orphaned paint first.
      const prev = composingRef.current;
      if (prev) {
        view.eraseHighlight(prev.id);
        drawnRef.current.delete(prev.id);
      }
      view.drawHighlight(highlight.id, highlight.anchor, () => view.goTo(highlight.anchor));
      drawnRef.current.set(highlight.id, highlight.anchor);
      setComposing(highlight);
      // Pressing "Add Note" takes you to the notes page to write the note.
      setPane("notes");
    });
  };

  function onComposeSave(body: string) {
    const highlight = composingRef.current;
    if (!sourceIdRef.current || !highlight) return;
    if (agent.addNote(sourceId, body, [highlight])) setComposing(null);
  }

  function onComposeCancel() {
    const highlight = composingRef.current;
    if (highlight) {
      view.eraseHighlight(highlight.id);
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
    if (agent.addReply(sourceId, parentId, body)) setReplyingTo(null);
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
      draw: (id, anchor) => view.drawHighlight(id, anchor, () => view.goTo(anchor)),
      erase: (id) => view.eraseHighlight(id),
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

  function onDelete(note: Note) {
    // Erasing the paint is handled by the sync effect once the note leaves state.
    if (!agent.removeNote(note.id)) return;
    setEditingId((id) => (id === note.id ? null : id));
    setReplyingTo((id) => (id === note.id ? null : id));
  }

  // The threaded view of the flat note list: roots, replies, and the id/seq
  // lookups used for anchor inheritance, jump targets, and chip hovers. Built
  // once per note-state change.
  const conversation = useMemo(() => buildConversation(notes), [notes]);
  const { byId, bySeq } = conversation;
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
      if (hl) {
        goTo(hl.anchor);
        setPane("reader"); // follow the highlight to the reader page
      }
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
      if (hl) {
        goTo(hl.anchor);
        setPane("reader"); // a reference jumps the reader to the cited highlight
      }
      flashNote(seq);
    },
    [bySeq, byId, goTo, flashNote],
  );

  // Seed a new note's body with the highlighted passage as a blockquote, then a
  // blank paragraph for the note text.
  const composeInitialBody = composing
    ? `> ${composing.quote.exact.replaceAll(/\s+/gu, " ").trim()}\n\n`
    : "";

  async function onRenameGroup(title: string): Promise<void> {
    const result = await renameGroup(name, title);
    if (result.ok) setDisplayName(title);
    else spawnToast("Rename failed", "Couldn't rename the club.", { type: "error" });
  }

  return (
    <div className="app">
      <WorkspaceHeader
        displayName={displayName}
        onRename={(t) => void onRenameGroup(t)}
        canInvite={viewer.isOwner}
        onInvite={() => setInviting(true)}
        onlineCount={agent.online.length}
        onShowPresence={() => setShowingPresence(true)}
        syncStatus={agent.syncStatus}
        onSyncClick={() => showSyncStatusToast(agent.syncStatus, sourceId)}
        book={{ sourceId, name }}
      />
      {(() => {
        const reader = (
          <Reader
            view={view}
            hasFile={file !== null}
            loading={file === null || !view.ready}
            floatingNote={!isMobile}
            books={books}
            selectedSourceId={selectedSourceId}
            onSelectBook={onSelectBook}
            bookUpload={bookUpload}
          />
        );
        const notePanel = (
          <NotePanel
            conversation={conversation}
            canWrite={canWriteNotes}
            composing={composing !== null}
            loading={!agent.notesReady}
            composeInitialBody={composeInitialBody}
            onComposeSave={onComposeSave}
            onComposeCancel={onComposeCancel}
            refs={noteRefs}
            viewer={viewer}
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
        );
        return isMobile ? (
          <MobilePager
            pane={pane}
            onPane={setPane}
            reader={reader}
            notes={notePanel}
            selecting={view.selection !== null}
            onAddNote={view.commitSelection}
          />
        ) : (
          <SplitPane left={reader} right={notePanel} />
        );
      })()}
      {inviting && (
        <InviteModal name={name} displayName={displayName} onClose={() => setInviting(false)} />
      )}
      {showingPresence && (
        <PresenceModal
          members={members}
          online={agent.online}
          onClose={() => setShowingPresence(false)}
        />
      )}
      <ToastViewport />
    </div>
  );
}
