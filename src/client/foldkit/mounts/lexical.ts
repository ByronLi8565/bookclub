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
  $getNearestNodeFromDOMNode,
  $getSelection,
  $isRangeSelection,
  $nodesOfType,
  CLEAR_HISTORY_COMMAND,
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
  NOTE_IMAGE_REMOVED,
  NOTE_IMAGE_RESIZED,
  NOTE_IMAGE_RETRIED,
  NOTE_IMAGE_TAG,
  registerNoteImageElement,
  type NoteImageStatus,
  type NoteImageWidget,
} from "../../logic/notes/noteImageElement.ts";
import {
  completedNoteHashtagCursor,
  processCompletedNoteHashtags,
} from "../../../shared/notes/tags.ts";
import { createReferenceTransformer } from "../../ui/notes/editor/referenceTransformer.ts";
import { ReferenceNode } from "../../ui/notes/editor/ReferenceNode.ts";

export const ChangedNoteDraft = m("ChangedNoteDraft", {
  groupRef: Schema.String,
  /** Images in the document whose upload has not settled. A draft cannot be
   *  posted while any are outstanding, because they carry no id to write. */
  unresolvedImages: Schema.Number,
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

/** The reader asked a failed upload to go again. The file never entered the
 *  Model: the editor kept it against the token it is retrying. */
export const RetriedNoteImage = m("RetriedNoteImage", {
  groupRef: Schema.String,
  token: Schema.String,
  file: FoldkitFile.File,
});

/** An image left the document, so whatever was uploaded for it is now unused. */
export const RemovedNoteImage = m("RemovedNoteImage", {
  groupRef: Schema.String,
  imageId: Schema.String,
  token: Schema.String,
});

export type NoteEditorMessage =
  | typeof ChangedNoteDraft.Type
  | typeof ChangedNoteDraftSelection.Type
  | typeof ExtractedNoteDraftTags.Type
  | typeof FailedNoteEditor.Type
  | typeof PastedNoteImage.Type
  | typeof RetriedNoteImage.Type
  | typeof RemovedNoteImage.Type;

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

const imageSource = (config: EditorConfig, imageId: string, previewUrl: string): string => {
  if (previewUrl !== "") return previewUrl;
  const base = config.theme[IMAGE_URL_BASE_THEME_KEY];
  return typeof base === "string" && base !== "" && imageId !== "" ? `${base}/${imageId}` : "";
};

/**
 * Renders the `<note-image>` widget rather than a framework decorator: the node
 * owns the document facts (which image, how wide, how its upload is going) and
 * writes them onto the element as properties, while the widget owns its own
 * interactive chrome and reports back with events the Mount listens for.
 */
class NoteImageNode extends DecoratorNode<null> {
  __imageId: string;
  __width: number;
  __status: NoteImageStatus;
  /** A local object URL shown while the bytes are still uploading. */
  __previewUrl: string;
  /** Identifies an image across the upload that has not produced an id yet. */
  __token: string;

  static getType(): string {
    return "note-image";
  }

  static clone(node: NoteImageNode): NoteImageNode {
    return new NoteImageNode(
      node.__imageId,
      node.__width,
      node.__status,
      node.__previewUrl,
      node.__token,
      node.__key,
    );
  }

  static importJSON(serialized: SerializedNoteImageNode): NoteImageNode {
    return $createNoteImageNode({
      imageId: serialized.imageId,
      width: serialized.width ?? DEFAULT_NOTE_IMAGE_WIDTH,
    });
  }

  constructor(
    imageId: string,
    width: number,
    status: NoteImageStatus,
    previewUrl: string,
    token: string,
    key?: NodeKey,
  ) {
    super(key);
    this.__imageId = imageId;
    this.__width = width;
    this.__status = status;
    this.__previewUrl = previewUrl;
    this.__token = token;
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
    registerNoteImageElement();
    const element = document.createElement(NOTE_IMAGE_TAG);
    this.#write(element, config);
    return element;
  }

  updateDOM(previous: NoteImageNode, element: HTMLElement, config: EditorConfig): false {
    if (
      previous.__imageId !== this.__imageId ||
      previous.__width !== this.__width ||
      previous.__status !== this.__status ||
      previous.__previewUrl !== this.__previewUrl
    ) {
      this.#write(element, config);
    }
    // The widget diffs its own properties, so the element is never rebuilt.
    return false;
  }

  #write(element: HTMLElement, config: EditorConfig): void {
    // SAFETY: createDOM builds the registered `<note-image>` element, whose
    // properties are the widget's declared contract.
    const widget = element as NoteImageWidget;
    widget.imageId = this.__imageId;
    widget.src = imageSource(config, this.__imageId, this.__previewUrl);
    widget.width = this.__width;
    widget.status = this.__status;
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

  getStatus(): NoteImageStatus {
    return this.getLatest().__status;
  }

  getToken(): string {
    return this.getLatest().__token;
  }

  getPreviewUrl(): string {
    return this.getLatest().__previewUrl;
  }

  setWidth(width: number): void {
    this.getWritable().__width = clampNoteImageWidth(width);
  }

  setUploaded(imageId: string): void {
    const writable = this.getWritable();
    writable.__imageId = imageId;
    writable.__status = "ready";
    writable.__previewUrl = "";
  }

  setFailed(): void {
    this.getWritable().__status = "failed";
  }

  setUploading(): void {
    this.getWritable().__status = "uploading";
  }
}

function $createNoteImageNode({
  imageId = "",
  width,
  status = "ready",
  previewUrl = "",
  token = "",
}: {
  imageId?: string;
  width: number;
  status?: NoteImageStatus;
  previewUrl?: string;
  token?: string;
}): NoteImageNode {
  return new NoteImageNode(imageId, clampNoteImageWidth(width), status, previewUrl, token);
}

function $isNoteImageNode(node: LexicalNode | null | undefined): node is NoteImageNode {
  return node instanceof NoteImageNode;
}

const NOTE_IMAGE_TRANSFORMER: ElementTransformer = {
  dependencies: [NoteImageNode],
  // An image that has not finished uploading has no id to write, so it stays
  // out of the markdown until it does.
  export: (node) =>
    $isNoteImageNode(node) && node.getImageId() !== ""
      ? noteImageBlock({ id: node.getImageId(), width: node.getWidth() })
      : null,
  regExp: /^\[\[image:([0-9A-HJKMNP-TV-Z]{26})(?::(\d{1,3}))?\]\]$/u,
  replace: (parentNode, _children, match) => {
    const image = parseNoteImageBlock(match[0]);
    if (image) parentNode.replace($createNoteImageNode({ imageId: image.id, width: image.width }));
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
  groupRef: string,
  publish: Publish,
): (() => void) => {
  let published: string | null = null;
  return editor.registerUpdateListener(({ editorState }: { editorState: EditorState }) => {
    const { body, unresolvedImages } = editorState.read(() => ({
      body: $convertToMarkdownString(transformers).trim(),
      unresolvedImages: $nodesOfType(NoteImageNode).filter((node) => node.getStatus() !== "ready")
        .length,
    }));
    const signature = `${unresolvedImages}:${body}`;
    if (signature === published) return;
    published = signature;
    publish(
      ChangedNoteDraft({ groupRef, body, imageIds: [...noteImageIds(body)], unresolvedImages }),
    );
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

/** The files behind uploads that have not settled, kept by the editor rather
 *  than by the Model: a `File` is a handle, and the Model holds none. */
type PendingFiles = Map<string, File>;

const noteImageNodeFor = (target: EventTarget | null): NoteImageNode | null => {
  const element = target instanceof Element ? target.closest(NOTE_IMAGE_TAG) : null;
  if (element === null) return null;
  const node = $getNearestNodeFromDOMNode(element);
  return $isNoteImageNode(node) ? node : null;
};

/**
 * The widget's chrome reaches the application here. Resizing and removing are
 * edits to the document the editor already owns, so they are applied to the
 * node and reach the Model through the draft publisher, exactly like typing.
 * Retrying is a domain fact — it needs an upload — so it becomes a Message.
 */
const registerNoteImageActions = (
  element: Element,
  editor: LexicalEditor,
  groupRef: string,
  pending: PendingFiles,
  publish: Publish,
): (() => void) => {
  const onResized = (event: Event) => {
    // SAFETY: the widget declares this event with a width in its detail.
    const { width } = (event as CustomEvent<{ width: number }>).detail;
    editor.update(() => {
      noteImageNodeFor(event.target)?.setWidth(width);
    });
  };
  const onRemoved = (event: Event) => {
    let removed: { imageId: string; token: string; previewUrl: string } | null = null;
    editor.update(() => {
      const node = noteImageNodeFor(event.target);
      if (node === null) return;
      removed = {
        imageId: node.getImageId(),
        token: node.getToken(),
        previewUrl: node.getPreviewUrl(),
      };
      node.remove();
    });
    if (removed === null) return;
    const { imageId, token, previewUrl } = removed;
    if (previewUrl !== "") URL.revokeObjectURL(previewUrl);
    pending.delete(token);
    // The upload is discarded rather than left for the note that never came,
    // so it must not come back through undo either.
    editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    publish(RemovedNoteImage({ groupRef, imageId, token }));
  };
  const onRetried = (event: Event) => {
    // `editor.read` rather than reading the state directly: resolving a node
    // from its DOM needs the editor active, not just its state.
    const token = editor.read(() => noteImageNodeFor(event.target)?.getToken() ?? "");
    const file = pending.get(token);
    if (file === undefined) return;
    editor.update(() => {
      noteImageNodeFor(event.target)?.setUploading();
    });
    publish(RetriedNoteImage({ groupRef, token, file }));
  };

  element.addEventListener(NOTE_IMAGE_RESIZED, onResized);
  element.addEventListener(NOTE_IMAGE_REMOVED, onRemoved);
  element.addEventListener(NOTE_IMAGE_RETRIED, onRetried);
  return () => {
    element.removeEventListener(NOTE_IMAGE_RESIZED, onResized);
    element.removeEventListener(NOTE_IMAGE_REMOVED, onRemoved);
    element.removeEventListener(NOTE_IMAGE_RETRIED, onRetried);
  };
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
  readonly pending: PendingFiles;
  readonly previewUrls: Set<string>;
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
  const pending: PendingFiles = new Map();
  const previewUrls = new Set<string>();
  const teardown = [
    registerRichText(editor),
    registerMarkdownShortcuts(editor, transformers),
    registerDraftPublisher(editor, transformers, args.groupRef, publish),
    registerSelectionPublisher(editor, publish),
    registerImagePaste(element, args.groupRef, publish),
    registerNoteImageActions(element, editor, args.groupRef, pending, publish),
    ...(args.extractHashtags ? [registerHashtagExtraction(editor, publish)] : []),
    () => editor.setRootElement(null),
    () => releaseEditableElement(element),
  ];
  return {
    editor,
    pending,
    previewUrls,
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
      for (const url of previewUrls) URL.revokeObjectURL(url);
      previewUrls.clear();
      pending.clear();
    },
  };
};

const failureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Owns one Lexical editor for the lifetime of its element. Editor state stays inside the editor;
 * the Message loop only ever sees the note draft, its images, its tags, and selection formatting.
 */
const NoteDraftEditorMount = Mount.defineStream(
  "NoteDraftEditor",
  NoteEditorArgs,
  ChangedNoteDraft,
  ChangedNoteDraftSelection,
  ExtractedNoteDraftTags,
  FailedNoteEditor,
  PastedNoteImage,
  RetriedNoteImage,
  RemovedNoteImage,
);

/**
 * The note editor adapter: the Mount plus the operations an upload needs
 * against whichever editor is live. An image that is still uploading is part of
 * the document the editor owns, not of the Model, so the Commands that settle
 * an upload reach it here rather than by rebuilding the composer and losing the
 * reader's undo history and cursor.
 */
export const makeNoteEditorAdapter = () => {
  let live: NoteEditorHandle | null = null;

  const onLiveEditor = (use: (handle: NoteEditorHandle) => void) =>
    Effect.sync(() => {
      const handle = live;
      if (handle !== null) use(handle);
    });

  const withImageNode = (
    handle: NoteEditorHandle,
    token: string,
    use: (node: NoteImageNode) => void,
  ) => {
    handle.editor.update(() => {
      const node = $nodesOfType(NoteImageNode).find((candidate) => candidate.getToken() === token);
      if (node) use(node);
    });
  };

  const Mounted = NoteDraftEditorMount(
    (args) => (element) =>
      Stream.callback<NoteEditorMessage>((queue) =>
        Effect.gen(function* () {
          const publish: Publish = (message) => {
            Queue.offerUnsafe(queue, message);
          };
          const handle = yield* Effect.acquireRelease(
            Effect.sync(() => {
              const created = createNoteEditorHandle(args, element, publish);
              live = created;
              return created;
            }),
            (acquired) =>
              Effect.sync(() => {
                // A previous scope can release after the next one acquires, so
                // only the editor that is still current clears the handle.
                if (live === acquired) live = null;
                acquired.dispose();
              }),
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

  return {
    Mount: Mounted,
    /** Show the pasted image at once, against the token its upload carries. */
    insertPendingImage: (token: string, file: File) =>
      onLiveEditor((handle) => {
        const previewUrl = URL.createObjectURL(file);
        handle.previewUrls.add(previewUrl);
        handle.pending.set(token, file);
        handle.editor.update(() => {
          const node = $createNoteImageNode({
            width: DEFAULT_NOTE_IMAGE_WIDTH,
            status: "uploading",
            previewUrl,
            token,
          });
          $getRoot().append(node);
          node.selectNext();
        });
      }),
    resolvePendingImage: (token: string, imageId: string) =>
      onLiveEditor((handle) => {
        withImageNode(handle, token, (node) => {
          const previewUrl = node.getPreviewUrl();
          node.setUploaded(imageId);
          if (previewUrl !== "") {
            URL.revokeObjectURL(previewUrl);
            handle.previewUrls.delete(previewUrl);
          }
        });
        handle.pending.delete(token);
      }),
    /** The preview and the file stay, which is what makes a retry possible. */
    failPendingImage: (token: string) =>
      onLiveEditor((handle) => {
        withImageNode(handle, token, (node) => node.setFailed());
      }),
  };
};

export type NoteEditorAdapter = ReturnType<typeof makeNoteEditorAdapter>;

export const noteEditor = makeNoteEditorAdapter();

/**
 * Owns one Lexical editor for the lifetime of its element. Editor state stays inside the editor;
 * the Message loop only ever sees the note draft, its images, its tags, and selection formatting.
 */
export const NoteDraftEditor = noteEditor.Mount;
