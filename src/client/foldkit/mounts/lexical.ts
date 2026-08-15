// oxlint-disable no-underscore-dangle
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  BOLD_STAR,
  HIGHLIGHT,
  ITALIC_STAR,
  QUOTE,
  registerMarkdownShortcuts,
  type ElementTransformer,
  type Transformer,
} from "@lexical/markdown";
import { $isQuoteNode, QuoteNode, registerRichText } from "@lexical/rich-text";
import { Effect, Queue, Schema, Stream } from "effect";
import { Mount } from "foldkit";
import * as FoldkitFile from "foldkit/file";
import { m } from "foldkit/message";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $nodesOfType,
  createEditor,
  DecoratorNode,
  TextNode,
  type EditorConfig,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";
import {
  clampNoteImageWidth,
  DEFAULT_NOTE_IMAGE_WIDTH,
  noteImageBlock,
  noteImageIds,
  parseNoteImageBlock,
} from "../../../shared/notes/images.ts";
import {
  completedNoteHashtagCursor,
  processCompletedNoteHashtags,
} from "../../../shared/notes/tags.ts";
import { createReferenceTransformer } from "../../ui/notes/editor/referenceTransformer.ts";
import { ReferenceNode } from "../../ui/notes/editor/ReferenceNode.ts";

export const ChangedNoteDraft = m("ChangedNoteDraft", {
  body: Schema.String,
  imageIds: Schema.Array(Schema.String),
});

export const ChangedNoteDraftSelection = m("ChangedNoteDraftSelection", {
  collapsed: Schema.Boolean,
  bold: Schema.Boolean,
  italic: Schema.Boolean,
  highlight: Schema.Boolean,
});

export const ExtractedNoteDraftTags = m("ExtractedNoteDraftTags", {
  tags: Schema.Array(Schema.String),
});

export const FailedNoteEditor = m("FailedNoteEditor", { message: Schema.String });

/**
 * The paste *fact*, not the upload. A Mount cannot perform the upload itself —
 * its factory has no requirement channel and no way to reach a Command — so it
 * reports the pasted file and `update` dispatches the upload.
 */
export const PastedNoteImage = m("PastedNoteImage", {
  groupRef: Schema.String,
  file: FoldkitFile.File,
});

export type NoteEditorMessage =
  | typeof ChangedNoteDraft.Type
  | typeof ChangedNoteDraftSelection.Type
  | typeof ExtractedNoteDraftTags.Type
  | typeof FailedNoteEditor.Type
  | typeof PastedNoteImage.Type;

const NoteEditorArgs = {
  initialBody: Schema.String,
  validSeqs: Schema.Array(Schema.Number),
  groupRef: Schema.String,
  imageUrlBase: Schema.String,
  extractHashtags: Schema.Boolean,
};
type NoteEditorArgs = Schema.Schema.Type<Schema.Struct<typeof NoteEditorArgs>>;

export const NOTE_EDITOR_INPUT_CLASS = "note-editor-input";
const HASHTAG_UPDATE_TAG = "note-hashtag";
const IMAGE_URL_BASE_THEME_KEY = "noteImageUrlBase";

type SerializedNoteImageNode = SerializedLexicalNode & { imageId: string; width: number };

/** Renders its own DOM instead of a framework decorator so the editor stays free of React. */
class NoteImageNode extends DecoratorNode<null> {
  __imageId: string;
  __width: number;

  static getType(): string {
    return "note-image";
  }

  static clone(node: NoteImageNode): NoteImageNode {
    return new NoteImageNode(node.__imageId, node.__width, node.__key);
  }

  static importJSON(serialized: SerializedNoteImageNode): NoteImageNode {
    return $createNoteImageNode(serialized.imageId, serialized.width ?? DEFAULT_NOTE_IMAGE_WIDTH);
  }

  constructor(imageId: string, width: number, key?: NodeKey) {
    super(key);
    this.__imageId = imageId;
    this.__width = width;
  }

  exportJSON(): SerializedNoteImageNode {
    return {
      ...super.exportJSON(),
      imageId: this.__imageId,
      type: "note-image",
      version: 1,
      width: this.__width,
    };
  }

  createDOM(config: EditorConfig): HTMLElement {
    const figure = document.createElement("figure");
    figure.className = "note-editor-image note-editor-image--ready";
    figure.style.width = `${this.__width}%`;
    const image = document.createElement("img");
    const base = config.theme[IMAGE_URL_BASE_THEME_KEY];
    image.src = typeof base === "string" && base ? `${base}/${this.__imageId}` : "";
    image.alt = "";
    image.dataset.noteImageId = this.__imageId;
    figure.appendChild(image);
    return figure;
  }

  updateDOM(previous: NoteImageNode): boolean {
    return previous.__imageId !== this.__imageId || previous.__width !== this.__width;
  }

  decorate(): null {
    return null;
  }

  isInline(): false {
    return false;
  }

  getImageId(): string {
    return this.getLatest().__imageId;
  }

  getWidth(): number {
    return this.getLatest().__width;
  }
}

function $createNoteImageNode(imageId: string, width: number): NoteImageNode {
  return new NoteImageNode(imageId, clampNoteImageWidth(width));
}

function $isNoteImageNode(node: LexicalNode | null | undefined): node is NoteImageNode {
  return node instanceof NoteImageNode;
}

const NOTE_IMAGE_TRANSFORMER: ElementTransformer = {
  dependencies: [NoteImageNode],
  export: (node) =>
    $isNoteImageNode(node)
      ? noteImageBlock({ id: node.getImageId(), width: node.getWidth() })
      : null,
  regExp: /^\[\[image:([0-9A-HJKMNP-TV-Z]{26})(?::(\d{1,3}))?\]\]$/u,
  replace: (parentNode, _children, match) => {
    const image = parseNoteImageBlock(match[0]);
    if (image) parentNode.replace($createNoteImageNode(image.id, image.width));
  },
  type: "element",
};

const noteTransformers = (validSeqs: readonly number[]): Transformer[] => {
  const seqs = new Set(validSeqs);
  return [
    NOTE_IMAGE_TRANSFORMER,
    QUOTE,
    HIGHLIGHT,
    BOLD_STAR,
    ITALIC_STAR,
    createReferenceTransformer(() => seqs),
  ];
};

function $seedDraft(initialBody: string, transformers: Transformer[]): void {
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
}

type Publish = (message: NoteEditorMessage) => void;

const registerDraftPublisher = (
  editor: LexicalEditor,
  transformers: Transformer[],
  publish: Publish,
): (() => void) => {
  let published: string | null = null;
  return editor.registerUpdateListener(({ editorState }: { editorState: EditorState }) => {
    const body = editorState.read(() => $convertToMarkdownString(transformers)).trim();
    if (body === published) return;
    published = body;
    publish(ChangedNoteDraft({ body, imageIds: [...noteImageIds(body)] }));
  });
};

const registerSelectionPublisher = (editor: LexicalEditor, publish: Publish): (() => void) => {
  let published: string | null = null;
  return editor.registerUpdateListener(({ editorState }: { editorState: EditorState }) => {
    const selection = editorState.read(() => {
      const current = $getSelection();
      return $isRangeSelection(current)
        ? {
            collapsed: current.isCollapsed(),
            bold: current.hasFormat("bold"),
            italic: current.hasFormat("italic"),
            highlight: current.hasFormat("highlight"),
          }
        : null;
    });
    if (!selection) return;
    const signature = JSON.stringify(selection);
    if (signature === published) return;
    published = signature;
    publish(ChangedNoteDraftSelection(selection));
  });
};

const registerHashtagExtraction = (editor: LexicalEditor, publish: Publish): (() => void) =>
  editor.registerUpdateListener(({ editorState, tags }) => {
    if (tags.has(HASHTAG_UPDATE_TAG)) return;
    const replacements = editorState.read(() => {
      const selection = $getSelection();
      const focusKey = $isRangeSelection(selection) ? selection.focus.key : null;
      return $nodesOfType(TextNode)
        .map((node) => {
          const text = node.getTextContent();
          return {
            key: node.getKey(),
            cursor: node.getKey() === focusKey ? completedNoteHashtagCursor(text) : null,
            ...processCompletedNoteHashtags(text),
          };
        })
        .filter((replacement) => replacement.tags.length > 0);
    });
    if (replacements.length === 0) return;
    editor.update(
      () => {
        for (const replacement of replacements) {
          const node = $getNodeByKey(replacement.key);
          if (node instanceof TextNode) {
            node.setTextContent(replacement.body);
            if (replacement.cursor !== null) node.select(replacement.cursor, replacement.cursor);
          }
        }
      },
      { discrete: true, tag: HASHTAG_UPDATE_TAG },
    );
    publish(
      ExtractedNoteDraftTags({ tags: replacements.flatMap((replacement) => replacement.tags) }),
    );
  });

const pastedImage = (clipboard: DataTransfer | null): File | null => {
  const items = [...(clipboard?.items ?? [])];
  for (const item of items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
};

const registerImagePaste = (element: Element, groupRef: string, publish: Publish): (() => void) => {
  const onPaste = (event: Event): void => {
    // SAFETY: this listener is registered only for "paste", which always
    // dispatches a ClipboardEvent.
    const file = pastedImage((event as ClipboardEvent).clipboardData);
    if (!file) return;
    // Lexical would otherwise drop the raw clipboard payload into the document.
    event.preventDefault();
    publish(PastedNoteImage({ groupRef, file }));
  };
  element.addEventListener("paste", onPaste);
  return () => element.removeEventListener("paste", onPaste);
};

const EDITABLE_ATTRIBUTES: readonly (readonly [string, string])[] = [
  ["contenteditable", "true"],
  ["role", "textbox"],
  ["spellcheck", "true"],
];

const claimEditableElement = (element: Element): void => {
  element.classList.add(NOTE_EDITOR_INPUT_CLASS);
  for (const [name, value] of EDITABLE_ATTRIBUTES) element.setAttribute(name, value);
};

const releaseEditableElement = (element: Element): void => {
  for (const [name] of EDITABLE_ATTRIBUTES) element.removeAttribute(name);
  element.classList.remove(NOTE_EDITOR_INPUT_CLASS);
};

interface NoteEditorHandle {
  readonly editor: LexicalEditor;
  readonly start: () => void;
  readonly dispose: () => void;
}

/**
 * Everything the release needs is created here and nowhere else, so the handle the runtime
 * registers for teardown always owns every listener and DOM change this Mount made.
 */
const createNoteEditorHandle = (
  args: NoteEditorArgs,
  element: Element,
  publish: Publish,
): NoteEditorHandle => {
  const transformers = noteTransformers(args.validSeqs);
  const editor = createEditor({
    namespace: "note",
    nodes: [QuoteNode, ReferenceNode, NoteImageNode],
    onError: (error: Error) => publish(FailedNoteEditor({ message: error.message })),
    theme: {
      text: { bold: "bc-bold", highlight: "bc-highlight", italic: "bc-italic" },
      quote: "bc-quote",
      [IMAGE_URL_BASE_THEME_KEY]: args.imageUrlBase,
    },
  });
  const teardown = [
    registerRichText(editor),
    registerMarkdownShortcuts(editor, transformers),
    registerDraftPublisher(editor, transformers, publish),
    registerSelectionPublisher(editor, publish),
    registerImagePaste(element, args.groupRef, publish),
    ...(args.extractHashtags ? [registerHashtagExtraction(editor, publish)] : []),
    () => editor.setRootElement(null),
    () => releaseEditableElement(element),
  ];
  return {
    editor,
    start: () => {
      if (!(element instanceof HTMLElement)) {
        claimEditableElement(element);
        throw new TypeError("the note editor requires an HTML element root");
      }
      editor.setRootElement(element);
      // Lexical normalizes its root on attachment, so apply the ContentEditable contract after it.
      claimEditableElement(element);
      editor.update(() => $seedDraft(args.initialBody, transformers), { discrete: true });
    },
    dispose: () => {
      for (const release of teardown.toReversed()) release();
    },
  };
};

const failureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Owns one Lexical editor for the lifetime of its element. Editor state stays inside the editor;
 * the Message loop only ever sees the note draft, its images, its tags, and selection formatting.
 */
export const NoteDraftEditor = Mount.defineStream(
  "NoteDraftEditor",
  NoteEditorArgs,
  ChangedNoteDraft,
  ChangedNoteDraftSelection,
  ExtractedNoteDraftTags,
  FailedNoteEditor,
  PastedNoteImage,
)(
  (args) => (element) =>
    Stream.callback<NoteEditorMessage>((queue) =>
      Effect.gen(function* () {
        const publish: Publish = (message) => {
          Queue.offerUnsafe(queue, message);
        };
        const handle = yield* Effect.acquireRelease(
          Effect.sync(() => createNoteEditorHandle(args, element, publish)),
          (acquired) => Effect.sync(() => acquired.dispose()),
        );
        yield* Effect.try({ try: () => handle.start(), catch: failureMessage }).pipe(
          Effect.catch((message: string) =>
            Effect.sync(() => publish(FailedNoteEditor({ message }))),
          ),
        );
        return yield* Effect.never;
      }),
    ),
);
