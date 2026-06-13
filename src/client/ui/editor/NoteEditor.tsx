import { useHotkey } from "@tanstack/react-hotkeys";
import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { $isQuoteNode, QuoteNode } from "@lexical/rich-text";
import { $createParagraphNode, $getRoot, FORMAT_TEXT_COMMAND } from "lexical";
import { useCallback, useRef } from "react";
import { NOTE_TRANSFORMERS } from "../../notes.ts";

// The restricted node set: paragraphs and text are built in; QuoteNode is the
// only structural node we allow. No headings, lists, links, code, or images.
const editorConfig = {
  namespace: "note",
  nodes: [QuoteNode],
  onError: (error: Error) => console.error("lexical error", error),
  theme: { text: { bold: "bc-bold", italic: "bc-italic" }, quote: "bc-quote" },
};

// Parse the markdown body and place the caret ready for typing: if it ends with
// the seeded quote, drop a fresh paragraph beneath it and select that.
function buildInitialState(initialBody: string) {
  return () => {
    $convertFromMarkdownString(initialBody, NOTE_TRANSFORMERS);
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
  onSubmit,
  onCancel,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  submitLabel: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [editor] = useLexicalComposerContext();

  const submit = useCallback(() => {
    const body = editor.getEditorState().read(() => $convertToMarkdownString(NOTE_TRANSFORMERS));
    onSubmit(body.trim());
  }, [editor, onSubmit]);

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
      <div className="note-editor-actions">
        <button type="button" className="primary" onClick={submit}>
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
}: {
  initialBody: string;
  submitLabel: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initialConfig = { ...editorConfig, editorState: buildInitialState(initialBody) };
  return (
    <div className="note-editor" ref={containerRef}>
      <LexicalComposer initialConfig={initialConfig}>
        <Chrome
          containerRef={containerRef}
          submitLabel={submitLabel}
          onSubmit={onSave}
          onCancel={onCancel}
        />
      </LexicalComposer>
    </div>
  );
}
