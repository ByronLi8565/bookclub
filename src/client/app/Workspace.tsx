import { useHotkey } from "@tanstack/react-hotkeys";
import { useAnyModalOpen } from "../ui/shared/modalLayer.ts";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HIGHLIGHT_TAG, type Note, type NoteAuthor } from "../../shared/types/notes.ts";
import type { SourceReadingPosition } from "../../shared/types/readingPositions.ts";
import type { SourceRef, SourceSummary } from "../../shared/types/sources.ts";
import { renameGroup, type RosterEntry } from "../logic/groups/groupClient.ts";
import { useNoteAgent } from "../logic/notes/useNoteAgent.ts";
import { buildConversation, referenceSpace, selectNotes } from "../logic/notes/conversation.ts";
import { blockquote, highlightMark } from "../logic/notes/format.ts";
import {
  captureHighlight,
  type Highlight,
  type HighlightAnchor,
} from "../logic/notes/highlights.ts";
import { effectiveHighlight } from "../logic/notes/conversation.ts";
import { type NoteViewer } from "../logic/notes/permissions.ts";
import { InviteModal } from "../ui/group/InviteModal.tsx";
import { PresenceModal } from "../ui/group/PresenceModal.tsx";
import { MobilePager, type Pane } from "../ui/shared/MobilePager.tsx";
import { SplitPane } from "../ui/shared/SplitPane.tsx";
import { spawnToast, showSyncStatusToast } from "../ui/shared/toast/toastStore.ts";
import { ToastViewport } from "../ui/shared/toast/ToastViewport.tsx";
import { useDelayedFlag } from "../ui/shared/hooks/useDelayedFlag.ts";
import { useIsMobile } from "../ui/shared/hooks/useIsMobile.ts";
import { setReaderPref, useReaderPrefs } from "../logic/settings/userPrefs.ts";
import { NotePanel } from "../ui/notes/NotePanel.tsx";
import type { NoteRefs } from "../ui/notes/NoteThread.tsx";
import { Reader } from "../ui/reader/Reader.tsx";
import {
  updateHighlights,
  type DesiredHighlight,
  type HighlightPainter,
} from "../ui/reader/engine/highlightReconciler.ts";
import { useSourceView, type SelectIntent } from "../ui/reader/useSourceView.ts";
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
  onSyncReadingPosition?: (sourceId: string) => Effect.Effect<boolean, unknown>;
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

const FIT_AFTER_CHROME_TOGGLE_MS = 140;
const FIT_AFTER_SPLIT_EXPAND_MS = 240;
type DesktopExpandedPane = "left" | "right" | null;

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
  onSyncReadingPosition = () => Effect.succeed(false),
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
  const [desktopExpandedPane, setDesktopExpandedPane] = useState<DesktopExpandedPane>(null);
  const [chromeHidden, setChromeHidden] = useState(false);
  const fitToTextRef = useRef<(() => void) | null>(null);
  const chromeMountedRef = useRef(false);
  const [renamedDisplayName, setRenamedDisplayName] = useState<{
    base: string;
    value: string;
  } | null>(null);
  const displayName = renamedDisplayName?.base === groupName ? renamedDisplayName.value : groupName;
  const author = useMemo<NoteAuthor | null>(() => {
    if (!viewer.userId) return null;
    const me = members.find((m) => m.id === viewer.userId);
    return { id: viewer.userId, name: me?.name ?? "You" };
  }, [viewer.userId, members]);
  const agent = useNoteAgent(groupId, author, viewer.isOwner);
  const notes = useMemo(
    () => selectNotes(agent.notes, { sources: [sourceId] }),
    [agent.notes, sourceId],
  );
  // Notes are local-first: writing works offline (it queues). Only cross-note
  // @references need the live socket, since their target seq is server-assigned.
  const canWriteNotes = agent.notesReady;
  const canReference = agent.syncStatus !== "offline";
  const [composing, setComposing] = useState<Highlight | null>(null);
  const composingRef = useRef<Highlight | null>(null);
  composingRef.current = composing;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const sourceIdRef = useRef<string | null>(null);
  sourceIdRef.current = sourceId;
  const onSelectRef = useRef<(anchor: HighlightAnchor, range: Range, intent: SelectIntent) => void>(
    () => {},
  );
  const restoreAfterSearchClearRef = useRef<() => void>(() => {});
  const view = useSourceView(
    source,
    file,
    (anchor, range, intent) => onSelectRef.current(anchor, range, intent),
    (dir) => {
      if (dir === "left") setPane("notes");
      else if (dir === "right") setPane("reader");
      else setChromeHidden(dir === "up");
    },
    () => restoreAfterSearchClearRef.current(),
    initialReadingPosition,
  );
  fitToTextRef.current = view.fitToText ?? null;
  const readerPending = file === null || !view.ready;
  const showReaderLoading = useDelayedFlag(readerPending, 300);

  useEffect(() => {
    if (!chromeMountedRef.current) {
      chromeMountedRef.current = true;
      return;
    }
    const timeout = window.setTimeout(() => fitToTextRef.current?.(), FIT_AFTER_CHROME_TOGGLE_MS);
    return () => window.clearTimeout(timeout);
  }, [chromeHidden]);

  useEffect(() => {
    if (desktopExpandedPane !== "left") return;
    const timeout = window.setTimeout(() => fitToTextRef.current?.(), FIT_AFTER_SPLIT_EXPAND_MS);
    return () => window.clearTimeout(timeout);
  }, [desktopExpandedPane]);

  // While a modal is open it owns the keyboard; reader hotkeys are suppressed.
  const modalOpen = useAnyModalOpen();
  const readerKeys = view.ready && !modalOpen;
  const { pdfPageLayout } = useReaderPrefs();
  useHotkey("ArrowLeft", () => view.prev(), { enabled: readerKeys });
  useHotkey("ArrowRight", () => view.next(), { enabled: readerKeys });
  useHotkey("Shift+ArrowLeft", () => setDesktopExpandedPane("right"), {
    enabled: readerKeys && !isMobile,
    preventDefault: true,
  });
  useHotkey("Shift+ArrowRight", () => setDesktopExpandedPane("left"), {
    enabled: readerKeys && !isMobile,
    preventDefault: true,
  });
  useHotkey("Shift+ArrowDown", () => setDesktopExpandedPane(null), {
    enabled: readerKeys && !isMobile,
    preventDefault: true,
  });
  // Toggle single ⇄ two-page (book) layout for PDFs and EPUBs alike.
  useHotkey(
    "D",
    () => setReaderPref("pdfPageLayout", pdfPageLayout === "auto" ? "single" : "auto"),
    { enabled: readerKeys },
  );
  useHotkey("Mod+F", () => view.search.openSearch(), { enabled: readerKeys, preventDefault: true });
  useHotkey("Mod+S", () => void Effect.runPromise(onSyncReadingPosition(sourceId)), {
    enabled: readerKeys,
    preventDefault: true,
  });
  useHotkey("Z", () => setChromeHidden((hidden) => !hidden), {
    enabled: !modalOpen,
    preventDefault: true,
  });
  useHotkey("Escape", () => view.search.closeSearch(), {
    enabled: view.search.open && !modalOpen,
    conflictBehavior: "allow",
  });

  const drawnRef = useRef<Map<string, HighlightAnchor>>(null!);
  drawnRef.current ??= new Map<string, HighlightAnchor>();
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

  onSelectRef.current = (anchor, range, intent) => {
    const sid = sourceIdRef.current;
    if (!sid) return;
    Effect.runPromise(captureHighlight(sid, anchor, range)).then((highlight) => {
      // A highlight skips the composer: post it straight away as a note whose
      // body is the quoted passage, tagged so it reads "highlighted". The
      // highlight reconciler paints it once it lands in `notes`.
      if (intent === "highlight") {
        agent.addNote(sid, highlightMark(highlight.quote.exact), [highlight], [HIGHLIGHT_TAG]);
        setPane("notes");
        return;
      }
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
    let cancelled = false;
    if (!view.ready) {
      drawnRef.current.clear();
      drawnSourceIdRef.current = null;
      return;
    }
    if (drawnSourceIdRef.current !== sourceId) {
      drawnRef.current.clear();
      drawnSourceIdRef.current = sourceId;
    }
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
  }, [notes, view.ready, sourceId, view, agent.rebindHighlight]);
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
    () => ({
      validSeqs: references.validSeqs,
      byId,
      refs: references.refs,
      canReference,
      pendingNoteIds: agent.pendingNoteIds,
      failedNoteIds: agent.failedNoteIds,
    }),
    [byId, references, canReference, agent.pendingNoteIds, agent.failedNoteIds],
  );

  const { flashHighlight, goTo, reader: sourceReader } = view;
  const pendingReferenceSeqRef = useRef<number | null>(null);
  const jumpToHighlight = useCallback(
    (highlight: Highlight) => {
      const expectedSourceId = highlight.sourceId;
      if (!file || !view.ready || sourceIdRef.current !== expectedSourceId) return;
      void Effect.runPromise(sourceReader.locateHighlight(highlight)).then(async (located) => {
        if (sourceIdRef.current !== expectedSourceId) return;
        const anchor = located ?? highlight.anchor;
        await goTo(anchor);
        if (sourceIdRef.current === expectedSourceId) {
          await afterReaderPaint();
          if (sourceIdRef.current === expectedSourceId) flashHighlight(anchor);
        }
      });
    },
    [file, flashHighlight, goTo, sourceReader, view.ready],
  );
  const onJump = useCallback(
    (note: Note) => {
      const hl = effectiveHighlight(note, byId);
      if (hl) {
        setPane("reader");
        jumpToHighlight(hl);
      }
    },
    [byId, jumpToHighlight],
  );
  useEffect(() => {
    const pendingReferenceSeq = pendingReferenceSeqRef.current;
    if (pendingReferenceSeq === null) return;
    const target = allBySeq.get(pendingReferenceSeq);
    if (!target) {
      pendingReferenceSeqRef.current = null;
      return;
    }
    if (target.sourceId !== sourceId) return;
    if (isMobile) {
      scrollNoteIntoView(target.seq);
      pendingReferenceSeqRef.current = null;
      return;
    }
    if (!file || !view.ready) return;
    const hl = effectiveHighlight(target, allById);
    if (hl) jumpToHighlight(hl);
    else scrollNoteIntoView(target.seq);
    pendingReferenceSeqRef.current = null;
  }, [allBySeq, allById, sourceId, file, view.ready, isMobile, jumpToHighlight]);

  const onReference = useCallback(
    (seq: number) => {
      const target = allBySeq.get(seq);
      if (!target) return;
      if (target.sourceId !== sourceId) {
        pendingReferenceSeqRef.current = seq;
        onSelectBook(target.sourceId);
        setPane(isMobile || !effectiveHighlight(target, allById) ? "notes" : "reader");
        return;
      }
      if (isMobile) {
        setPane("notes");
        scrollNoteIntoView(target.seq);
        return;
      }
      const hl = effectiveHighlight(target, allById);
      if (hl) {
        setPane("reader");
        jumpToHighlight(hl);
      }
    },
    [allBySeq, allById, sourceId, onSelectBook, isMobile, jumpToHighlight],
  );

  const composeInitialBody = composing ? `${blockquote(composing.quote.exact)}\n\n` : "";
  async function onRenameGroup(title: string): Promise<void> {
    const result = await renameGroup(groupRef, title);
    if (result.ok) setRenamedDisplayName({ base: groupName, value: title });
    else spawnToast("Rename failed", "Couldn't rename the club.", { type: "error" });
  }

  return (
    <div className={chromeHidden ? "app app--chrome-hidden" : "app"}>
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
            hasFile
            loading={showReaderLoading}
            floatingNote={!isMobile}
            books={books}
            selectedSourceId={selectedSourceId}
            onSelectBook={onSelectBook}
            onRenameBook={onRenameBook}
            onAddBook={onAddBook}
            chromeHidden={chromeHidden && isMobile}
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
            onAddNote={() => view.commitSelection("note")}
            onHighlight={() => view.commitSelection("highlight")}
            onChromeHiddenChange={setChromeHidden}
          />
        ) : (
          <SplitPane
            left={reader}
            right={notePanel}
            expandedPane={desktopExpandedPane}
            onExpandedPaneChange={setDesktopExpandedPane}
          />
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
