import * as Effect from "effect/Effect";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { HIGHLIGHT_TAG, type Note, type NoteAuthor } from "../../../shared/types/notes.ts";
import type { SourceReadingPosition } from "../../../shared/types/readingPositions.ts";
import type { SourceRef } from "../../../shared/types/sources.ts";
import type { RosterEntry } from "../../logic/groups/groupClient.ts";
import {
  avatarImagePath,
  avatarInitial,
  deleteNoteImage,
  uploadNoteImage,
} from "../../logic/groups/groupClient.ts";
import {
  buildConversation,
  effectiveHighlight,
  referenceSpace,
  selectNotes,
} from "../../logic/notes/conversation.ts";
import { blockquote, highlightMark } from "../../logic/notes/format.ts";
import {
  captureHighlight,
  type Highlight,
  type HighlightAnchor,
} from "../../logic/notes/highlights.ts";
import type { NoteViewer } from "../../logic/notes/permissions.ts";
import { useNoteAgent } from "../../logic/notes/useNoteAgent.ts";
import { useLatestRef } from "../../logic/useLatestRef.ts";
import { useNotesPrefs } from "../../logic/settings/userPrefs.ts";
import type { NotePanel } from "../notes/NotePanel.tsx";
import type { AvatarResolver, NoteRefs } from "../notes/NoteThread.tsx";
import {
  updateHighlights,
  type DesiredHighlight,
  type HighlightPainter,
} from "../reader/engine/highlightReconciler.ts";
import { useSourceView, type SelectIntent } from "../reader/useSourceView.ts";
import { useDelayedFlag } from "../shared/hooks/useDelayedFlag.ts";
import { spawnToast } from "../shared/toast/toastStore.ts";
import type { useWorkspaceLayout } from "./useWorkspaceLayout.ts";

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

export function useReaderNoteSession({
  groupId,
  groupRef,
  source,
  file,
  storedBookTitle,
  initialReadingPosition,
  members,
  viewer,
  layout,
  onTitleParsed,
  onReadingPosition,
  onSelectBook,
}: {
  groupId: string;
  groupRef: string;
  source: SourceRef;
  file: File | null;
  storedBookTitle: string | null;
  initialReadingPosition: SourceReadingPosition | null;
  members: RosterEntry[];
  viewer: NoteViewer;
  layout: ReturnType<typeof useWorkspaceLayout>;
  onTitleParsed: (sourceId: string, title: string) => void;
  onReadingPosition: (sourceId: string, position: SourceReadingPosition) => void;
  onSelectBook: (sourceId: string) => void;
}) {
  const sourceId = source.id;
  const { onSwipe, chromeTransitioning, isMobile, setDesktopExpandedPane, setPane } = layout;
  const author = useMemo<NoteAuthor | null>(() => {
    if (!viewer.userId) return null;
    const me = members.find((member) => member.id === viewer.userId);
    return { id: viewer.userId, name: me?.name ?? "You" };
  }, [members, viewer.userId]);
  const { showAvatars } = useNotesPrefs();
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
  const canReference = agent.syncStatus !== "offline";
  const canUploadImages = agent.syncStatus !== "offline";
  const [composing, setComposing] = useState<Highlight | null>(null);
  const composingRef = useLatestRef(composing);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const sourceIdRef = useLatestRef(sourceId);
  const onSelectRef = useRef<(anchor: HighlightAnchor, range: Range, intent: SelectIntent) => void>(
    () => {},
  );
  const restoreAfterSearchClearRef = useRef<() => void>(() => {});
  const onReadingPositionRef = useLatestRef(onReadingPosition);
  const handleSelect = useCallback(
    (anchor: HighlightAnchor, range: Range, intent: SelectIntent) =>
      onSelectRef.current(anchor, range, intent),
    [],
  );
  const handleSearchHighlightCleared = useCallback(() => restoreAfterSearchClearRef.current(), []);
  const view = useSourceView(
    source,
    file,
    handleSelect,
    onSwipe,
    handleSearchHighlightCleared,
    initialReadingPosition,
    chromeTransitioning,
  );
  const readerLoading = useDelayedFlag(file === null || !view.ready, 300);

  const drawnRef = useRef(new Map<string, HighlightAnchor>());
  const drawnSourceIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    restoreAfterSearchClearRef.current = () => {
      for (const note of notes) {
        for (const highlight of note.highlights) {
          view.eraseHighlight(highlight.id);
          view.drawHighlight(
            highlight.id,
            highlight.anchor,
            () => void view.goTo(highlight.anchor),
          );
          drawnRef.current.set(highlight.id, highlight.anchor);
        }
      }
      const pending = composingRef.current;
      if (pending) {
        view.eraseHighlight(pending.id);
        view.drawHighlight(pending.id, pending.anchor, () => void view.goTo(pending.anchor));
        drawnRef.current.set(pending.id, pending.anchor);
      }
    };
  });

  useLayoutEffect(() => {
    onSelectRef.current = (anchor, range, intent) => {
      const selectedSourceId = sourceIdRef.current;
      if (!selectedSourceId) return;
      if (intent === "note" && !isMobile) setDesktopExpandedPane(null);
      Effect.runPromise(captureHighlight(selectedSourceId, anchor, range)).then((highlight) => {
        if (intent === "highlight") {
          agent.addNote(
            selectedSourceId,
            highlightMark(highlight.quote.exact),
            [highlight],
            [HIGHLIGHT_TAG],
          );
          setPane("notes");
          return;
        }
        const previous = composingRef.current;
        if (previous) {
          view.eraseHighlight(previous.id);
          drawnRef.current.delete(previous.id);
        }
        view.drawHighlight(highlight.id, highlight.anchor, () => void view.goTo(highlight.anchor));
        drawnRef.current.set(highlight.id, highlight.anchor);
        setComposing(highlight);
        setPane("notes");
      });
    };
  });

  function onComposeSave(body: string): void {
    const highlight = composingRef.current;
    if (!sourceIdRef.current || !highlight) return;
    if (agent.addNote(sourceId, body, [highlight])) setComposing(null);
  }

  function onComposeCancel(): void {
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

  function onEditSave(note: Note, body: string): void {
    if (agent.editNote(note.id, body)) setEditingId(null);
  }

  function onReplySave(parentId: string, body: string): void {
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
      for (const highlight of note.highlights) desired.push({ noteId: note.id, highlight });
    }
    const pending = composingRef.current;
    if (pending) desired.push({ noteId: null, highlight: pending });
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
  }, [notes, view.ready, sourceId, view, agent.rebindHighlight, composingRef]);
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
    onReadingPositionRef.current(sourceId, view.position);
  }, [sourceId, view.position, onReadingPositionRef]);

  function onDelete(note: Note): void {
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
    [file, flashHighlight, goTo, sourceReader, view.ready, sourceIdRef],
  );
  const onJump = useCallback(
    (note: Note) => {
      const highlight = effectiveHighlight(note, byId);
      if (highlight) {
        setPane("reader");
        jumpToHighlight(highlight);
      }
    },
    [byId, jumpToHighlight, setPane],
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
    const highlight = effectiveHighlight(target, allById);
    if (highlight) jumpToHighlight(highlight);
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
      const highlight = effectiveHighlight(target, allById);
      if (highlight) {
        setPane("reader");
        jumpToHighlight(highlight);
      }
    },
    [allBySeq, allById, sourceId, onSelectBook, isMobile, jumpToHighlight, setPane],
  );

  const notePanelProps = {
    conversation,
    canWrite: agent.notesReady,
    composing: composing !== null,
    loading: !agent.notesReady,
    composeInitialBody: composing ? `${blockquote(composing.quote.exact)}\n\n` : "",
    onComposeSave,
    onComposeCancel,
    onPasteImage,
    refs: noteRefs,
    viewer,
    avatarFor: showAvatars ? avatarFor : undefined,
    imageUrlBase: `/groups/${groupRef}/images`,
    actions: {
      editingId,
      replyingTo,
      onJump,
      onReference,
      onDelete,
      onEdit: (note: Note) => setEditingId(note.id),
      onEditSave,
      onEditCancel: () => setEditingId(null),
      onReply: (note: Note) => setReplyingTo(note.id),
      onReplySave,
      onReplyCancel: () => setReplyingTo(null),
    },
  } satisfies ComponentProps<typeof NotePanel>;

  return { view, readerLoading, online: agent.online, notePanelProps };
}
