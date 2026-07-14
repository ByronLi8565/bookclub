import { useHotkey } from "@tanstack/react-hotkeys";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type Transformer,
} from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { $isQuoteNode, QuoteNode } from "@lexical/rich-text";
import {
  $getNodeByKey,
  $getRoot,
  $insertNodes,
  $nodesOfType,
  $createParagraphNode,
  CLEAR_HISTORY_COMMAND,
  FORMAT_TEXT_COMMAND,
  type NodeKey,
} from "lexical";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useLatestRef } from "../../../logic/useLatestRef.ts";
import { NOTE_TRANSFORMERS } from "../../../logic/notes/renderHtml.ts";
import { noteImageIds } from "../../../../shared/notes/images.ts";
import {
  $createNoteImageNode,
  $isNoteImageNode,
  NOTE_IMAGE_TRANSFORMER,
  NoteImageActionsContext,
  NoteImageNode,
  type UploadedNoteImage,
} from "./NoteImageNode.tsx";
import { ReferenceNode } from "./ReferenceNode.ts";
import { createReferenceTransformer } from "./referenceTransformer.ts";

const editorConfig = {
  namespace: "note",
  nodes: [QuoteNode, ReferenceNode, NoteImageNode],
  onError: (error: Error) => console.error("lexical error", error),
  theme: { text: { bold: "bc-bold", italic: "bc-italic" }, quote: "bc-quote" },
};

function buildInitialState(initialBody: string, transformers: Transformer[]) {
  return () => {
    $convertFromMarkdownString(initialBody, transformers);
    const root = $getRoot();
    const last = root.getLastChild();
    if (last && $isQuoteNode(last)) {
      const paragraph = $createParagraphNode();
      root.append(paragraph);
      paragraph.select();
    } else {
      root.selectEnd();
    }
  };
}

function Chrome({
  containerRef,
  submitLabel,
  canSubmit,
  onSubmit,
  onCancel,
  onPasteImage,
  imageUrlBase,
  transformers,
  referenceTransformer,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  submitLabel: string;
  canSubmit: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
  onPasteImage?: (file: File) => Promise<UploadedNoteImage | null>;
  imageUrlBase?: string;
  transformers: Transformer[];
  referenceTransformer: Transformer;
}) {
  const [editor] = useLexicalComposerContext();
  const [unresolvedImages, setUnresolvedImages] = useState(0);
  const uploadedRef = useRef(new Map<string, () => Promise<void>>());
  const previewUrlsRef = useRef(new Set<string>());
  const disposedRef = useRef(false);
  const committedRef = useRef(false);

  const releasePreviewUrls = useCallback(() => {
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    previewUrlsRef.current.clear();
  }, []);

  const discardUploads = useCallback(() => {
    for (const discard of uploadedRef.current.values()) void discard();
    uploadedRef.current.clear();
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      releasePreviewUrls();
      if (!committedRef.current) discardUploads();
    };
  }, [discardUploads, releasePreviewUrls]);

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        const unresolved = editorState.read(
          () => $nodesOfType(NoteImageNode).filter((node) => !node.getImageId()).length,
        );
        setUnresolvedImages(unresolved);
      }),
    [editor],
  );

  const beginUpload = useCallback(
    (key: NodeKey, file: File) => {
      if (!onPasteImage) return;
      editor.update(() => {
        const node = $getNodeByKey(key);
        if ($isNoteImageNode(node)) node.setStatus("uploading");
      });
      void onPasteImage(file)
        .then((uploaded) => {
          if (!uploaded) {
            editor.update(() => {
              const node = $getNodeByKey(key);
              if ($isNoteImageNode(node)) node.setStatus("failed");
            });
            return;
          }
          if (disposedRef.current) {
            void uploaded.discard();
            return;
          }
          let retained = false;
          editor.update(() => {
            const node = $getNodeByKey(key);
            if (!$isNoteImageNode(node)) return;
            node.setUploaded(uploaded.id);
            retained = true;
          });
          if (retained) uploadedRef.current.set(uploaded.id, uploaded.discard);
          else void uploaded.discard();
        })
        .catch(() => {
          editor.update(() => {
            const node = $getNodeByKey(key);
            if ($isNoteImageNode(node)) node.setStatus("failed");
          });
        });
    },
    [editor, onPasteImage],
  );

  const removeImage = useCallback(
    (key: NodeKey) => {
      let imageId: string | null = null;
      let previewUrl: string | null = null;
      editor.update(() => {
        const node = $getNodeByKey(key);
        if (!$isNoteImageNode(node)) return;
        imageId = node.getImageId();
        previewUrl = node.getPreviewUrl();
        node.remove();
      });
      // The removed upload is deleted immediately, so it must not be restored by undo.
      // oxlint-disable-next-line unicorn/no-useless-undefined
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrlsRef.current.delete(previewUrl);
      }
      if (imageId) {
        const discard = uploadedRef.current.get(imageId);
        if (discard) {
          uploadedRef.current.delete(imageId);
          void discard();
        }
      }
    },
    [editor],
  );

  const submit = useCallback(() => {
    if (!canSubmit || unresolvedImages > 0) return;
    const body = editor.getEditorState().read(() => $convertToMarkdownString(transformers));
    const retainedImageIds = noteImageIds(body);
    for (const [imageId, discard] of uploadedRef.current) {
      if (!retainedImageIds.has(imageId)) void discard();
    }
    committedRef.current = true;
    uploadedRef.current.clear();
    releasePreviewUrls();
    onSubmit(body.trim());
  }, [canSubmit, editor, onSubmit, releasePreviewUrls, transformers, unresolvedImages]);

  useHotkey("Mod+B", () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold"), {
    target: containerRef,
    preventDefault: true,
  });
  useHotkey("Mod+I", () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic"), {
    target: containerRef,
    preventDefault: true,
  });
  useHotkey("Mod+Enter", () => submit(), { target: containerRef, preventDefault: true });

  const beginPasteUpload = useEffectEvent(beginUpload);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onPasteImage) return;
    const onPaste = (event: ClipboardEvent) => {
      const image = [...(event.clipboardData?.items ?? [])]
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile();
      if (!image) return;
      event.preventDefault();
      const previewUrl = URL.createObjectURL(image);
      previewUrlsRef.current.add(previewUrl);
      let key: NodeKey | null = null;
      editor.update(() => {
        const node = $createNoteImageNode({ file: image, previewUrl, status: "uploading" });
        $insertNodes([node]);
        key = node.getKey();
      });
      if (key) beginPasteUpload(key, image);
    };
    container.addEventListener("paste", onPaste);
    return () => container.removeEventListener("paste", onPaste);
  }, [containerRef, editor, onPasteImage]);

  const imageActions = { imageUrlBase, retry: beginUpload, remove: removeImage };

  return (
    <NoteImageActionsContext value={imageActions}>
      <RichTextPlugin
        contentEditable={<ContentEditable className="note-editor-input" />}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <MarkdownShortcutPlugin transformers={[NOTE_IMAGE_TRANSFORMER, referenceTransformer]} />
      {unresolvedImages > 0 && (
        <p className="note-editor-hint">Finish or remove image uploads before saving.</p>
      )}
      <div className="note-editor-actions">
        <button
          type="button"
          className="primary"
          onClick={submit}
          disabled={!canSubmit || unresolvedImages > 0}
          title={`${submitLabel} (⌘↵)`}
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            discardUploads();
            releasePreviewUrls();
            onCancel();
          }}
          title="Cancel"
        >
          Cancel
        </button>
      </div>
    </NoteImageActionsContext>
  );
}

const NO_SEQS: Set<number> = new Set();

export function NoteEditor({
  initialBody,
  submitLabel,
  onSave,
  onCancel,
  onPasteImage,
  imageUrlBase,
  validSeqs,
  canSubmit = true,
  canReference = true,
}: {
  initialBody: string;
  submitLabel: string;
  onSave: (body: string) => void;
  onCancel: () => void;
  onPasteImage?: (file: File) => Promise<UploadedNoteImage | null>;
  imageUrlBase?: string;
  validSeqs: Set<number>;
  canSubmit?: boolean;
  canReference?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Offline, the target note's seq is unknowable, so we feed the reference
  // transformer an empty set — `@N` simply stays plain text — and tell the user
  // why below the editor.
  const validSeqsRef = useLatestRef(canReference ? validSeqs : NO_SEQS);
  const referenceTransformer = useMemo(
    () => createReferenceTransformer(() => validSeqsRef.current),
    [validSeqsRef],
  );
  const transformers = useMemo<Transformer[]>(
    () => [NOTE_IMAGE_TRANSFORMER, ...NOTE_TRANSFORMERS, referenceTransformer],
    [referenceTransformer],
  );
  const initialConfig = {
    ...editorConfig,
    editorState: buildInitialState(initialBody, transformers),
  };
  return (
    <div className="note-editor" ref={containerRef}>
      <LexicalComposer initialConfig={initialConfig}>
        <Chrome
          containerRef={containerRef}
          submitLabel={submitLabel}
          canSubmit={canSubmit}
          onSubmit={onSave}
          onCancel={onCancel}
          onPasteImage={onPasteImage}
          imageUrlBase={imageUrlBase}
          transformers={transformers}
          referenceTransformer={referenceTransformer}
        />
      </LexicalComposer>
      {!canReference && (
        <p className="note-editor-hint">references are unsupported while offline!</p>
      )}
    </div>
  );
}
