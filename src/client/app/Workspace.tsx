import { useHotkey } from "@tanstack/react-hotkeys";
import { useAnyModalOpen } from "../ui/shared/modalLayer.ts";
import * as Effect from "effect/Effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HIGHLIGHT_TAG, type Note, type NoteAuthor } from "../../shared/types/notes.ts";
import { GroupAction, permits } from "../../shared/groupPermissions.ts";
import type { SourceReadingPosition } from "../../shared/types/readingPositions.ts";
import type { SourceRef, SourceSummary } from "../../shared/types/sources.ts";
import type { ClubProfile } from "../../shared/types/profiles.ts";
import {
  avatarImagePath,
  avatarInitial,
  deleteNoteImage,
  renameGroup,
  uploadNoteImage,
  type GroupRole,
  type GroupSummary,
  type BookMetadataPatch,
  type RosterEntry,
} from "../logic/groups/groupClient.ts";
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
import { PresenceModal } from "../ui/group/PresenceModal.tsx";
import { InfoScreen } from "../ui/shared/InfoScreen.tsx";
import { MobilePager, type Pane } from "../ui/shared/MobilePager.tsx";
import { SplitPane, stepExpandedPane, type ExpandedPane } from "../ui/shared/SplitPane.tsx";
import { spawnToast } from "../ui/shared/toast/toastStore.ts";
import { ToastViewport } from "../ui/shared/toast/ToastViewport.tsx";
import { useDelayedFlag } from "../ui/shared/hooks/useDelayedFlag.ts";
import { useIsMobile } from "../ui/shared/hooks/useIsMobile.ts";
import { setReaderPref, useNotesPrefs, useReaderPrefs } from "../logic/settings/userPrefs.ts";
import { NotePanel } from "../ui/notes/NotePanel.tsx";
import type { AvatarResolver, NoteRefs } from "../ui/notes/NoteThread.tsx";
import { Reader } from "../ui/reader/Reader.tsx";
import {
  updateHighlights,
  type DesiredHighlight,
  type HighlightPainter,
} from "../ui/reader/engine/highlightReconciler.ts";
import { useSourceView, type SelectIntent } from "../ui/reader/useSourceView.ts";
import { WorkspaceHeader } from "../ui/workspace/WorkspaceHeader.tsx";
import { SettingsModal } from "../ui/workspace/SettingsModal.tsx";
import {
  stepChromeVisibility,
  type ChromeVisibilityLevel,
} from "../ui/workspace/chromeVisibility.ts";

export interface WorkspaceProps {
  group: GroupSummary;
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
  viewerRole: GroupRole;
  viewer: NoteViewer;
  onChangeMemberRole: (memberId: string, role: GroupRole) => Promise<boolean>;
  onDeleteBook: (sourceId: string) => Promise<boolean>;
  onUpdateBookMetadata: (sourceId: string, patch: BookMetadataPatch) => Promise<boolean>;
  onProfileChange: (profile: ClubProfile) => void;
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

const CHROME_TRANSITION_FALLBACK_MS = 400;
const FIT_AFTER_SPLIT_EXPAND_MS = 240;
type WorkspaceModal = "group" | "settings" | "info";
const WORKSPACE_MODALS: WorkspaceModal[] = ["group", "settings", "info"];

export function Workspace({
  group,
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
  viewerRole,
  viewer,
  onChangeMemberRole,
  onDeleteBook,
  onUpdateBookMetadata,
  onProfileChange,
}: WorkspaceProps) {
  const sourceId = source.id;
  const canRenameBooks = permits(viewerRole, GroupAction.RenameBook);
  const [activeModal, setActiveModal] = useState<WorkspaceModal | null>(null);
  const isMobile = useIsMobile();
  const [pane, setPane] = useState<Pane>("reader");
  const [desktopExpandedPane, setDesktopExpandedPane] = useState<ExpandedPane>(null);
  const [chromeLevel, setChromeLevel] = useState<ChromeVisibilityLevel>(0);
  const [chromeTransitioning, setChromeTransitioning] = useState(false);
  const fitToTextRef = useRef<(() => void) | null>(null);
  const chromeMountedRef = useRef(false);
  const chromeToggleFrameRef = useRef<number | null>(null);
  const chromeTransitionTimeoutRef = useRef<number | null>(null);
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
  const memberProfile = useMemo<ClubProfile>(() => {
    const me = members.find((member) => member.id === viewer.userId);
    return {
      id: viewer.userId,
      displayName: me?.name ?? "You",
      ...(me?.avatarImageId ? { avatarImageId: me.avatarImageId } : {}),
    };
  }, [members, viewer.userId]);
  const { showAvatars } = useNotesPrefs();
  // Resolve a note author to their picture by joining against the roster (which
  // carries avatarImageId). Notes only store {id, name}, so the roster is the
  // source of truth for avatars and this stays live as members update theirs.
  const avatarFor = useMemo<AvatarResolver>(() => {
    const byId = new Map(members.map((member) => [member.id, member]));
    return (noteAuthor) => {
      const member = byId.get(noteAuthor.id);
      return {
        url: member?.avatarImageId ? avatarImagePath(noteAuthor.id, member.avatarImageId) : null,
        initials: avatarInitial(noteAuthor.name),
        name: noteAuthor.name,
      };
    };
  }, [members]);
  const agent = useNoteAgent(groupId, author, viewer.isOwner);
  const notes = useMemo(
    () => selectNotes(agent.notes, { sources: [sourceId] }),
    [agent.notes, sourceId],
  );
  const canWriteNotes = agent.notesReady;
  const canReference = agent.syncStatus !== "offline";
  const canUploadImages = agent.syncStatus !== "offline";
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
  const finishChromeTransition = () => {
    if (chromeTransitionTimeoutRef.current !== null) {
      window.clearTimeout(chromeTransitionTimeoutRef.current);
      chromeTransitionTimeoutRef.current = null;
    }
    setChromeTransitioning(false);
  };
  const beginChromeTransition = () => {
    setChromeTransitioning(true);
    if (chromeTransitionTimeoutRef.current !== null) {
      window.clearTimeout(chromeTransitionTimeoutRef.current);
    }
    chromeTransitionTimeoutRef.current = window.setTimeout(
      finishChromeTransition,
      CHROME_TRANSITION_FALLBACK_MS,
    );
  };
  const stepChrome = (direction: "hide" | "show") => {
    const next = stepChromeVisibility(chromeLevel, direction);
    if (next === chromeLevel) return;
    beginChromeTransition();
    setChromeLevel(next);
  };
  const view = useSourceView(
    source,
    file,
    (anchor, range, intent) => onSelectRef.current(anchor, range, intent),
    (dir) => {
      if (dir === "left") setPane("notes");
      else if (dir === "right") setPane("reader");
      else stepChrome(dir === "up" ? "hide" : "show");
    },
    () => restoreAfterSearchClearRef.current(),
    initialReadingPosition,
    chromeTransitioning,
  );
  fitToTextRef.current = view.fitToText ?? null;
  const readerPending = file === null || !view.ready;
  const showReaderLoading = useDelayedFlag(readerPending, 300);

  useEffect(() => {
    if (chromeTransitioning) return;
    if (!chromeMountedRef.current) {
      chromeMountedRef.current = true;
      return;
    }
    fitToTextRef.current?.();
  }, [chromeTransitioning]);

  useEffect(
    () => () => {
      if (chromeToggleFrameRef.current !== null) {
        cancelAnimationFrame(chromeToggleFrameRef.current);
      }
      if (chromeTransitionTimeoutRef.current !== null) {
        window.clearTimeout(chromeTransitionTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (desktopExpandedPane !== "left") return;
    const timeout = window.setTimeout(() => fitToTextRef.current?.(), FIT_AFTER_SPLIT_EXPAND_MS);
    return () => window.clearTimeout(timeout);
  }, [desktopExpandedPane]);

  const modalOpen = useAnyModalOpen();
  const readerKeys = view.ready && !modalOpen;
  const stepModal = (delta: number) => {
    if (!activeModal) return;
    const index = WORKSPACE_MODALS.indexOf(activeModal);
    setActiveModal(
      WORKSPACE_MODALS[(index + delta + WORKSPACE_MODALS.length) % WORKSPACE_MODALS.length],
    );
  };
  useHotkey("Shift+ArrowLeft", () => stepModal(-1), {
    enabled: activeModal !== null,
    preventDefault: true,
    conflictBehavior: "allow",
  });
  useHotkey("Shift+ArrowRight", () => stepModal(1), {
    enabled: activeModal !== null,
    preventDefault: true,
    conflictBehavior: "allow",
  });
  const { pdfPageLayout } = useReaderPrefs();
  useHotkey("ArrowLeft", () => view.prev(), { enabled: readerKeys });
  useHotkey("ArrowRight", () => view.next(), { enabled: readerKeys });
  useHotkey(
    "Shift+ArrowLeft",
    () => setDesktopExpandedPane((expanded) => stepExpandedPane(expanded, "left")),
    { enabled: readerKeys && !isMobile, preventDefault: true },
  );
  useHotkey(
    "Shift+ArrowRight",
    () => setDesktopExpandedPane((expanded) => stepExpandedPane(expanded, "right")),
    { enabled: readerKeys && !isMobile, preventDefault: true },
  );
  useHotkey("Shift+ArrowUp", () => stepChrome("hide"), {
    enabled: readerKeys && !isMobile,
    preventDefault: true,
  });
  useHotkey("Shift+ArrowDown", () => stepChrome("show"), {
    enabled: readerKeys && !isMobile,
    preventDefault: true,
  });
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
  useHotkey(
    "Z",
    () => {
      if (chromeToggleFrameRef.current !== null) return;
      // Commit the current geometry before changing the class so keyboard
      // toggles enter the same CSS transition used by the swipe gesture.
      chromeToggleFrameRef.current = requestAnimationFrame(() => {
        chromeToggleFrameRef.current = null;
        beginChromeTransition();
        setChromeLevel((level) => (level === 0 ? 2 : 0));
      });
    },
    { enabled: !modalOpen, preventDefault: true, requireReset: true },
  );
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
    if (intent === "note" && !isMobile) setDesktopExpandedPane(null);
    Effect.runPromise(captureHighlight(sid, anchor, range)).then((highlight) => {
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

  async function onPasteImage(image: File) {
    if (!canUploadImages) {
      spawnToast("Image upload unavailable", "Reconnect before pasting images into notes.", {
        type: "error",
      });
      return null;
    }
    const result = await uploadNoteImage(groupRef, image);
    if (result.ok) {
      const imageId = result.value;
      return {
        id: imageId,
        discard: async () => {
          await deleteNoteImage(groupRef, imageId);
        },
      };
    }
    const message =
      result.error === "too_large"
        ? "That image is still too large after compression. Try a smaller image."
        : result.error === "image_processing_failed"
          ? "This browser couldn't compress that image. Try a different image."
          : result.error;
    spawnToast("Image upload failed", message, { type: "error" });
    return null;
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
    <div
      className={chromeLevel >= 1 ? "app app--chrome-hidden" : "app"}
      onTransitionEnd={(event) => {
        if (
          event.propertyName === "max-height" &&
          event.target instanceof Element &&
          event.target.matches(".topbar, .reader-bar")
        ) {
          finishChromeTransition();
        }
      }}
    >
      <WorkspaceHeader
        displayName={displayName}
        onRename={(t) => void onRenameGroup(t)}
        onlineCount={agent.online.length}
        onShowPeople={() => setActiveModal("group")}
        onShowSettings={() => setActiveModal("settings")}
        onShowInfo={() => setActiveModal("info")}
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
            onRenameBook={canRenameBooks ? onRenameBook : null}
            onAddBook={onAddBook}
            chromeHidden={chromeLevel >= 2}
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
            onPasteImage={onPasteImage}
            refs={noteRefs}
            viewer={viewer}
            avatarFor={showAvatars ? avatarFor : undefined}
            imageUrlBase={`/groups/${groupRef}/images`}
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
            onChromeHiddenChange={(hidden) => stepChrome(hidden ? "hide" : "show")}
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
      {activeModal === "group" && (
        <PresenceModal
          groupRef={groupRef}
          group={group}
          members={members}
          online={agent.online}
          viewerId={viewer.userId}
          viewerRole={viewerRole}
          onChangeMemberRole={onChangeMemberRole}
          onDeleteBook={onDeleteBook}
          onUpdateBookMetadata={onUpdateBookMetadata}
          onClose={() => setActiveModal(null)}
        />
      )}
      {activeModal === "settings" && (
        <SettingsModal
          book={{ groupId, profile: memberProfile, onProfileChange }}
          onClose={() => setActiveModal(null)}
        />
      )}
      {activeModal === "info" && <InfoScreen onClose={() => setActiveModal(null)} />}
      <ToastViewport />
    </div>
  );
}
