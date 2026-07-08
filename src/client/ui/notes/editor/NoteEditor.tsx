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
import { $createParagraphNode, $createTextNode, $getRoot, FORMAT_TEXT_COMMAND } from "lexical";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NOTE_TRANSFORMERS } from "../../../logic/notes/renderHtml.ts";
import { ReferenceNode } from "./ReferenceNode.ts";
import { createReferenceTransformer } from "./referenceTransformer.ts";

const editorConfig = {
  namespace: "note",
  nodes: [QuoteNode, ReferenceNode],
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
  transformers,
  referenceTransformer,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  submitLabel: string;
  canSubmit: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
  onPasteImage?: (file: File) => Promise<string | null>;
  transformers: Transformer[];
  referenceTransformer: Transformer;
}) {
  const [editor] = useLexicalComposerContext();
  const [pasteStatus, setPasteStatus] = useState<string | null>(null);

  const submit = useCallback(() => {
    if (!canSubmit) return;
    const body = editor.getEditorState().read(() => $convertToMarkdownString(transformers));
    onSubmit(body.trim());
  }, [canSubmit, editor, onSubmit, transformers]);

  useHotkey("Mod+B", () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold"), {
    target: containerRef,
    preventDefault: true,
  });
  useHotkey("Mod+I", () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic"), {
    target: containerRef,
    preventDefault: true,
  });
  useHotkey("Mod+Enter", () => submit(), { target: containerRef, preventDefault: true });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !onPasteImage) return;
    const onPaste = (event: ClipboardEvent) => {
      const image = [...(event.clipboardData?.items ?? [])]
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile();
      if (!image) return;
      event.preventDefault();
      setPasteStatus("uploading image...");
      void onPasteImage(image).then((imageId) => {
        if (!imageId) {
          setPasteStatus("image upload failed");
          return;
        }
        editor.update(() => {
          const paragraph = $createParagraphNode();
          paragraph.append($createTextNode(`[[image:${imageId}]]`));
          $getRoot().append(paragraph);
          paragraph.selectEnd();
        });
        setPasteStatus(null);
      });
    };
    container.addEventListener("paste", onPaste);
    return () => container.removeEventListener("paste", onPaste);
  }, [containerRef, editor, onPasteImage]);

  return (
    <>
      <RichTextPlugin
        contentEditable={<ContentEditable className="note-editor-input" />}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <MarkdownShortcutPlugin transformers={[referenceTransformer]} />
      {pasteStatus && <p className="note-editor-hint">{pasteStatus}</p>}
      <div className="note-editor-actions">
        <button
          type="button"
          className="primary"
          onClick={submit}
          disabled={!canSubmit}
          title={`${submitLabel} (⌘↵)`}
        >
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel} title="Cancel">
          Cancel
        </button>
      </div>
    </>
  );
}

const NO_SEQS: Set<number> = new Set();

export function NoteEditor({
  initialBody,
  submitLabel,
  onSave,
  onCancel,
  onPasteImage,
  validSeqs,
  canSubmit = true,
  canReference = true,
}: {
  initialBody: string;
  submitLabel: string;
  onSave: (body: string) => void;
  onCancel: () => void;
  onPasteImage?: (file: File) => Promise<string | null>;
  validSeqs: Set<number>;
  canSubmit?: boolean;
  canReference?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Offline, the target note's seq is unknowable, so we feed the reference
  // transformer an empty set — `@N` simply stays plain text — and tell the user
  // why below the editor.
  const validSeqsRef = useRef(validSeqs);
  validSeqsRef.current = canReference ? validSeqs : NO_SEQS;
  const referenceTransformer = useMemo(
    () => createReferenceTransformer(() => validSeqsRef.current),
    [],
  );
  const transformers = useMemo<Transformer[]>(
    () => [...NOTE_TRANSFORMERS, referenceTransformer],
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
