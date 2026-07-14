// oxlint-disable no-underscore-dangle
import type { ElementTransformer } from "@lexical/markdown";
import {
  $applyNodeReplacement,
  $getNodeByKey,
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  clampNoteImageWidth,
  DEFAULT_NOTE_IMAGE_WIDTH,
  noteImageBlock,
  parseNoteImageBlock,
} from "../../../../shared/notes/images.ts";

export type NoteImageStatus = "uploading" | "failed" | "ready";

export interface UploadedNoteImage {
  id: string;
  discard: () => Promise<void>;
}

export interface NoteImageActions {
  imageUrlBase?: string;
  retry: (key: NodeKey, file: File) => void;
  remove: (key: NodeKey) => void;
}

export const NoteImageActionsContext = createContext<NoteImageActions | null>(null);

type SerializedNoteImageNode = SerializedLexicalNode & { imageId: string; width: number };

export class NoteImageNode extends DecoratorNode<ReactNode> {
  __imageId: string | null;
  __previewUrl: string | null;
  __file: File | null;
  __status: NoteImageStatus;
  __width: number;

  static getType(): string {
    return "note-image";
  }

  static clone(node: NoteImageNode): NoteImageNode {
    return new NoteImageNode(
      node.__imageId,
      node.__previewUrl,
      node.__file,
      node.__status,
      node.__width,
      node.__key,
    );
  }

  static importJSON(serialized: SerializedNoteImageNode): NoteImageNode {
    return $createNoteImageNode({
      imageId: serialized.imageId,
      status: "ready",
      width: serialized.width ?? DEFAULT_NOTE_IMAGE_WIDTH,
    });
  }

  constructor(
    imageId: string | null,
    previewUrl: string | null,
    file: File | null,
    status: NoteImageStatus,
    width: number,
    key?: NodeKey,
  ) {
    super(key);
    this.__imageId = imageId;
    this.__previewUrl = previewUrl;
    this.__file = file;
    this.__status = status;
    this.__width = width;
  }

  exportJSON(): SerializedNoteImageNode {
    return {
      ...super.exportJSON(),
      imageId: this.__imageId ?? "",
      type: "note-image",
      version: 1,
      width: this.__width,
    };
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("div");
    element.className = "note-editor-image-node";
    return element;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): false {
    return false;
  }

  getImageId(): string | null {
    return this.getLatest().__imageId;
  }

  getFile(): File | null {
    return this.getLatest().__file;
  }

  getPreviewUrl(): string | null {
    return this.getLatest().__previewUrl;
  }

  getWidth(): number {
    return this.getLatest().__width;
  }

  setWidth(width: number): void {
    this.getWritable().__width = clampNoteImageWidth(width);
  }

  setStatus(status: NoteImageStatus): void {
    this.getWritable().__status = status;
  }

  setUploaded(imageId: string): void {
    const writable = this.getWritable();
    writable.__imageId = imageId;
    writable.__status = "ready";
  }

  decorate(): ReactNode {
    return (
      <NoteImagePreview
        nodeKey={this.getKey()}
        imageId={this.__imageId}
        previewUrl={this.__previewUrl}
        file={this.__file}
        status={this.__status}
        width={this.__width}
      />
    );
  }
}

function NoteImagePreview({
  nodeKey,
  imageId,
  previewUrl,
  file,
  status,
  width,
}: {
  nodeKey: NodeKey;
  imageId: string | null;
  previewUrl: string | null;
  file: File | null;
  status: NoteImageStatus;
  width: number;
}) {
  const [editor] = useLexicalComposerContext();
  const actions = useContext(NoteImageActionsContext);
  const figureRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    startX: number;
    startWidth: number;
    containerWidth: number;
    currentWidth: number;
  } | null>(null);
  const [resizingWidth, setResizingWidth] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const displayWidth = resizingWidth ?? width;
  const src =
    previewUrl ?? (imageId && actions?.imageUrlBase ? `${actions.imageUrlBase}/${imageId}` : null);

  function commitWidth(next: number): void {
    const clamped = clampNoteImageWidth(next);
    setResizingWidth(null);
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isNoteImageNode(node)) node.setWidth(clamped);
    });
  }

  function onResizeStart(event: PointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startWidth: displayWidth,
      containerWidth: figureRef.current?.parentElement?.clientWidth || 1,
      currentWidth: displayWidth,
    };
    setResizing(true);
  }

  function onResizeMove(event: PointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = ((event.clientX - drag.startX) / drag.containerWidth) * 100;
    drag.currentWidth = clampNoteImageWidth(drag.startWidth + delta);
    setResizingWidth(drag.currentWidth);
  }

  function onResizeEnd(event: PointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    setResizing(false);
    commitWidth(drag.currentWidth);
  }

  function onResizeKey(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    commitWidth(displayWidth + (event.key === "ArrowRight" ? 5 : -5));
  }

  return (
    <figure
      ref={figureRef}
      className={`note-editor-image note-editor-image--${status}`}
      style={{ width: `${displayWidth}%` }}
    >
      <button
        type="button"
        className="note-editor-image-remove"
        aria-label="Remove image"
        title="Remove image"
        onClick={() => {
          if (actions) actions.remove(nodeKey);
          else editor.update(() => $getNodeByKey(nodeKey)?.remove());
        }}
      >
        X
      </button>
      {src ? (
        <img src={src} alt="" />
      ) : (
        <div className="note-editor-image-missing">image unavailable</div>
      )}
      {status !== "ready" && (
        <figcaption>
          <span>{status === "uploading" ? "uploading image..." : "upload failed"}</span>
          {status === "failed" && file && actions && (
            <button type="button" onClick={() => actions.retry(nodeKey, file)}>
              Retry
            </button>
          )}
        </figcaption>
      )}
      {resizing && <span className="note-editor-image-size">{displayWidth}%</span>}
      <button
        type="button"
        className="note-editor-image-resize"
        aria-label="Resize image"
        title={`Resize image (${displayWidth}%)`}
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={() => {
          dragRef.current = null;
          setResizing(false);
          setResizingWidth(null);
        }}
        onKeyDown={onResizeKey}
      />
    </figure>
  );
}

export function $createNoteImageNode({
  imageId = null,
  previewUrl = null,
  file = null,
  status,
  width = DEFAULT_NOTE_IMAGE_WIDTH,
}: {
  imageId?: string | null;
  previewUrl?: string | null;
  file?: File | null;
  status: NoteImageStatus;
  width?: number;
}): NoteImageNode {
  return $applyNodeReplacement(
    new NoteImageNode(imageId, previewUrl, file, status, clampNoteImageWidth(width)),
  );
}

export function $isNoteImageNode(node: LexicalNode | null | undefined): node is NoteImageNode {
  return node instanceof NoteImageNode;
}

export const NOTE_IMAGE_TRANSFORMER: ElementTransformer = {
  dependencies: [NoteImageNode],
  export: (node) => {
    if (!$isNoteImageNode(node)) return null;
    const imageId = node.getImageId();
    return imageId ? noteImageBlock({ id: imageId, width: node.getWidth() }) : null;
  },
  regExp: /^\[\[image:([0-9A-HJKMNP-TV-Z]{26})(?::(\d{1,3}))?\]\]$/u,
  replace: (parentNode, _children, match) => {
    const image = parseNoteImageBlock(match[0]);
    if (image) {
      parentNode.replace(
        $createNoteImageNode({ imageId: image.id, status: "ready", width: image.width }),
      );
    }
  },
  type: "element",
};
