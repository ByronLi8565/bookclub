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
import { $createParagraphNode, $getRoot, FORMAT_TEXT_COMMAND } from "lexical";
import { useCallback, useMemo, useRef } from "react";
import { NOTE_TRANSFORMERS } from "../../notes.ts";
import { ReferenceNode } from "./ReferenceNode.ts";
import { createReferenceTransformer } from "./referenceTransformer.ts";

// The restricted node set: paragraphs and text are built in; QuoteNode is the
// only structural node we allow, plus ReferenceNode for `[[n]]` chips. No
// headings, lists, links, code, or images.
const editorConfig = {
  namespace: "note",
  nodes: [QuoteNode, ReferenceNode],
  onError: (error: Error) => console.error("lexical error", error),
  theme: { text: { bold: "bc-bold", italic: "bc-italic" }, quote: "bc-quote" },
};

// Parse the markdown body and place the caret ready for typing: if it ends with
// the seeded quote, drop a fresh paragraph beneath it and select that.
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

// Actions and keyboard shortcuts, sharing the composer context.
function Chrome({
  containerRef,
  submitLabel,
  canSubmit,
  onSubmit,
  onCancel,
  transformers,
  referenceTransformer,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  submitLabel: string;
  canSubmit: boolean;
  onSubmit: (body: string) => void;
  onCancel: () => void;
  transformers: Transformer[];
  referenceTransformer: Transformer;
}) {
  const [editor] = useLexicalComposerContext();

  const submit = useCallback(() => {
    if (!canSubmit) return;
    const body = editor.getEditorState().read(() => $convertToMarkdownString(transformers));
    onSubmit(body.trim());
  }, [canSubmit, editor, onSubmit, transformers]);

  // Ctrl/Cmd+B and +I format; Ctrl/Cmd+Enter publishes. Scoped to this editor's
  // container so multiple open editors don't fire each other's shortcuts.
  useHotkey("Mod+B", () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold"), {
    target: containerRef,
    preventDefault: true,
  });
  useHotkey("Mod+I", () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic"), {
    target: containerRef,
    preventDefault: true,
  });
  useHotkey("Mod+Enter", () => submit(), { target: containerRef, preventDefault: true });

  return (
    <>
      <RichTextPlugin
        contentEditable={<ContentEditable className="note-editor-input" />}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      {/* Only references transform live while typing; bold/italic/quote stay
          explicit (Cmd+B/I / markdown on save) as before. */}
      <MarkdownShortcutPlugin transformers={[referenceTransformer]} />
      <div className="note-editor-actions">
        <button type="button" className="primary" onClick={submit} disabled={!canSubmit}>
          {submitLabel}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

export function NoteEditor({
  initialBody,
  submitLabel,
  onSave,
  onCancel,
  validSeqs,
  canSubmit = true,
}: {
  initialBody: string;
  submitLabel: string;
  onSave: (body: string) => void;
  onCancel: () => void;
  validSeqs: Set<number>;
  canSubmit?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Read the valid seqs fresh on each transform so peer-added notes count, while
  // the transformer identity stays stable across renders.
  const validSeqsRef = useRef(validSeqs);
  validSeqsRef.current = validSeqs;
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
          transformers={transformers}
          referenceTransformer={referenceTransformer}
        />
      </LexicalComposer>
    </div>
  );
}
