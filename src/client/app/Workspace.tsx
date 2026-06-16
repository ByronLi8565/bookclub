import { useHotkey } from "@tanstack/react-hotkeys";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../../shared/types/notes.ts";
import type { SourceReadingPosition } from "../../shared/types/readingPositions.ts";
import type { SourceRef, SourceSummary } from "../../shared/types/sources.ts";
import { renameGroup, type RosterEntry } from "../groups/api.ts";
import { useNoteAgent } from "../notes/agent.ts";
import { buildConversation, referenceSpace, selectNotes } from "../notes/conversation.ts";
import { captureHighlight, type Highlight, type HighlightAnchor } from "../notes/highlights.ts";
import { effectiveHighlight, type NoteViewer } from "../notes/render.ts";
import { InviteModal } from "../ui/group/InviteModal.tsx";
import { PresenceModal } from "../ui/group/PresenceModal.tsx";
import { MobilePager, type Pane } from "../ui/shared/MobilePager.tsx";
import { SplitPane } from "../ui/shared/SplitPane.tsx";
import { spawnToast, showSyncStatusToast } from "../ui/shared/toast/store.ts";
import { ToastViewport } from "../ui/shared/toast/ToastViewport.tsx";
import { useIsMobile } from "../ui/shared/hooks/useIsMobile.ts";
import { NotePanel } from "../ui/notes/NotePanel.tsx";
import type { NoteRefs } from "../ui/notes/NoteThread.tsx";
import { Reader } from "../ui/reader/Reader.tsx";
import {
  updateHighlights,
  type DesiredHighlight,
  type HighlightPainter,
} from "../ui/reader/highlightReconciler.ts";
import { useSourceView } from "../ui/reader/useSourceView.ts";
import { WorkspaceHeader } from "../ui/workspace/WorkspaceHeader.tsx";

export interface WorkspaceProps {
  groupName: string;
  groupRef: string;
  groupId: string;
  source: SourceRef;
  file: File | null;
  storedBookTitle: string | null;
  onTitleParsed: (sourceId: string, title: string) => void;
  initialReadingPosition?: SourceReadingPosition | null;
  onReadingPosition?: (sourceId: string, position: SourceReadingPosition) => void;
  books: SourceSummary[];
  selectedSourceId: string;
  onSelectBook: (sourceId: string) => void;
  onRenameBook: (sourceId: string, title: string) => void;
  onAddBook: () => void;
  members: RosterEntry[];
  viewer: NoteViewer;
}

function afterReaderPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function scrollNoteIntoView(seq: number): void {
  void afterReaderPaint().then(() => {
    document.getElementById(`note-${seq}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

export function Workspace({
  groupName,
  groupRef,
  groupId,
  source,
  file,
  storedBookTitle,
  onTitleParsed,
  initialReadingPosition = null,
  onReadingPosition = () => {},
  books,
  selectedSourceId,
  onSelectBook,
  onRenameBook,
  onAddBook,
  members,
  viewer,
}: WorkspaceProps) {
  const sourceId = source.id;
  const [inviting, setInviting] = useState(false);
  const [showingPresence, setShowingPresence] = useState(false);
  const isMobile = useIsMobile();
  const [pane, setPane] = useState<Pane>("reader");
  const [displayName, setDisplayName] = useState(groupName);
  const agent = useNoteAgent(groupId);
  const notes = useMemo(
    () => selectNotes(agent.notes, { sources: [sourceId] }),
    [agent.notes, sourceId],
  );
  const canWriteNotes = agent.syncStatus === "online";
  const [composing, setComposing] = useState<Highlight | null>(null);
  const composingRef = useRef<Highlight | null>(null);
  composingRef.current = composing;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const sourceIdRef = useRef<string | null>(null);
  sourceIdRef.current = sourceId;
  const onSelectRef = useRef<(anchor: HighlightAnchor, range: Range) => void>(() => {});
  const restoreAfterSearchClearRef = useRef<() => void>(() => {});
  const view = useSourceView(
    source,
    file,
    (anchor, range) => onSelectRef.current(anchor, range),
    (dir) => setPane(dir === "left" ? "notes" : "reader"),
    () => restoreAfterSearchClearRef.current(),
    initialReadingPosition,
  );

  useHotkey("ArrowLeft", () => view.prev(), { enabled: view.ready });
  useHotkey("ArrowRight", () => view.next(), { enabled: view.ready });
  useHotkey("Mod+F", () => view.search.openSearch(), { enabled: view.ready, preventDefault: true });
  useHotkey("Escape", () => view.search.closeSearch(), { enabled: view.search.open });

  const drawnRef = useRef<Map<string, HighlightAnchor>>(new Map());
  const drawnSourceIdRef = useRef<string | null>(null);
  restoreAfterSearchClearRef.current = () => {
    for (const note of notes) {
      for (const h of note.highlights) {
        view.eraseHighlight(h.id);
        view.drawHighlight(h.id, h.anchor, () => void view.goTo(h.anchor));
        drawnRef.current.set(h.id, h.anchor);
      }
    }
    const comp = composingRef.current;
    if (comp) {
      view.eraseHighlight(comp.id);
      view.drawHighlight(comp.id, comp.anchor, () => void view.goTo(comp.anchor));
      drawnRef.current.set(comp.id, comp.anchor);
    }
  };

  onSelectRef.current = (anchor, range) => {
    const sid = sourceIdRef.current;
    if (!sid) return;
    Effect.runPromise(captureHighlight(sid, anchor, range)).then((highlight) => {
      const prev = composingRef.current;
      if (prev) {
        view.eraseHighlight(prev.id);
        drawnRef.current.delete(prev.id);
      }
      view.drawHighlight(highlight.id, highlight.anchor, () => void view.goTo(highlight.anchor));
      drawnRef.current.set(highlight.id, highlight.anchor);
      setComposing(highlight);
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
    if (body === "") {
      setReplyingTo(null);
      return;
    }
    if (agent.addReply(sourceId, parentId, body)) setReplyingTo(null);
  }

  useEffect(() => {
    if (!view.ready) {
      drawnRef.current.clear();
      drawnSourceIdRef.current = null;
      return;
    }
    if (drawnSourceIdRef.current !== sourceId) {
      drawnRef.current.clear();
      drawnSourceIdRef.current = sourceId;
    }
    let cancelled = false;
    const desired: DesiredHighlight[] = [];
    for (const note of notes) {
      for (const h of note.highlights) desired.push({ noteId: note.id, highlight: h });
    }
    const comp = composingRef.current;
    if (comp) desired.push({ noteId: null, highlight: comp });
    const painter: HighlightPainter = {
      draw: (id, anchor) => view.drawHighlight(id, anchor, () => void view.goTo(anchor)),
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
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, view.ready, sourceId]);
  useEffect(() => {
    drawnRef.current.clear();
  }, [sourceId]);
  const titleRepairedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!view.title || storedBookTitle) return;
    if (titleRepairedRef.current === sourceId) return;
    titleRepairedRef.current = sourceId;
    onTitleParsed(sourceId, view.title);
  }, [view.title, storedBookTitle, sourceId, onTitleParsed]);

  useEffect(() => {
    if (!view.position) return;
    onReadingPosition(sourceId, view.position);
  }, [sourceId, view.position, onReadingPosition]);

  function onDelete(note: Note) {
    if (!agent.removeNote(note.id)) return;
    setEditingId((id) => (id === note.id ? null : id));
    setReplyingTo((id) => (id === note.id ? null : id));
  }

  const conversation = useMemo(() => buildConversation(notes), [notes]);
  const { byId } = conversation;
  const allConversation = useMemo(() => buildConversation(agent.notes), [agent.notes]);
  const { byId: allById, bySeq: allBySeq } = allConversation;
  const references = useMemo(() => referenceSpace(agent.notes), [agent.notes]);
  const noteRefs = useMemo<NoteRefs>(
    () => ({ validSeqs: references.validSeqs, byId, refs: references.refs }),
    [byId, references],
  );

  const { flashHighlight, goTo, reader: sourceReader } = view;
  const [pendingReferenceSeq, setPendingReferenceSeq] = useState<number | null>(null);
  const jumpToHighlight = useCallback(
    (highlight: Highlight) => {
      const expectedSourceId = highlight.sourceId;
      if (!file || !view.ready || sourceIdRef.current !== expectedSourceId) return;
      setPane("reader");
      void Effect.runPromise(sourceReader.locateHighlight(highlight)).then(async (located) => {
        if (sourceIdRef.current !== expectedSourceId) return;
        const anchor = located ?? highlight.anchor;
        await goTo(anchor);
        await afterReaderPaint();
        if (sourceIdRef.current !== expectedSourceId) return;
        flashHighlight(anchor);
      });
    },
    [file, flashHighlight, goTo, sourceReader, view.ready],
  );
  const onJump = useCallback(
    (note: Note) => {
      const hl = effectiveHighlight(note, byId);
      if (hl) jumpToHighlight(hl);
    },
    [byId, jumpToHighlight],
  );
  useEffect(() => {
    if (pendingReferenceSeq === null) return;
    const target = allBySeq.get(pendingReferenceSeq);
    if (!target) {
      setPendingReferenceSeq(null);
      return;
    }
    if (target.sourceId !== sourceId) return;
    if (isMobile) {
      setPane("notes");
      scrollNoteIntoView(target.seq);
      setPendingReferenceSeq(null);
      return;
    }
    if (!file || !view.ready) return;
    const hl = effectiveHighlight(target, allById);
    if (hl) {
      jumpToHighlight(hl);
    } else {
      setPane("notes");
    }
    setPendingReferenceSeq(null);
  }, [
    pendingReferenceSeq,
    allBySeq,
    allById,
    sourceId,
    file,
    view.ready,
    isMobile,
    jumpToHighlight,
  ]);

  const onReference = useCallback(
    (seq: number) => {
      const target = allBySeq.get(seq);
      if (!target) return;
      if (target.sourceId !== sourceId) {
        setPendingReferenceSeq(seq);
        onSelectBook(target.sourceId);
        setPane(isMobile ? "notes" : "reader");
        return;
      }
      if (isMobile) {
        setPane("notes");
        scrollNoteIntoView(target.seq);
        return;
      }
      const hl = effectiveHighlight(target, allById);
      if (hl) jumpToHighlight(hl);
    },
    [allBySeq, allById, sourceId, onSelectBook, isMobile, jumpToHighlight],
  );

  const composeInitialBody = composing
    ? `> ${composing.quote.exact.replaceAll(/\s+/gu, " ").trim()}\n\n`
    : "";
  async function onRenameGroup(title: string): Promise<void> {
    const result = await renameGroup(groupRef, title);
    if (result.ok) setDisplayName(title);
    else spawnToast("Rename failed", "Couldn't rename the club.", { type: "error" });
  }

  return (
    <div className="app">
      <WorkspaceHeader
        displayName={displayName}
        onRename={(t) => void onRenameGroup(t)}
        canInvite
        onInvite={() => setInviting(true)}
        onlineCount={agent.online.length}
        onShowPresence={() => setShowingPresence(true)}
        syncStatus={agent.syncStatus}
        onSyncClick={() => showSyncStatusToast(agent.syncStatus, sourceId)}
        book={{ sourceId, groupRef }}
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
            onRenameBook={onRenameBook}
            onAddBook={onAddBook}
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
        <InviteModal
          groupRef={groupRef}
          displayName={displayName}
          onClose={() => setInviting(false)}
        />
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
