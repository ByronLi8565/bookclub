// Lexical node fields use the framework's `__`-prefixed convention (e.g. __key,
// __seq) so clone/getLatest copy them; the dangling-underscore rule doesn't apply.
// oxlint-disable no-underscore-dangle
import {
  $applyNodeReplacement,
  TextNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
} from "lexical";

// A `[[n]]` cross-reference, rendered in the editor as an atomic chip showing
// "#n". It is a token-mode TextNode so the caret can't land inside it and typing
// never merges into it; on save it serializes back to `[[n]]` markdown via the
// reference transformer.
export type SerializedReferenceNode = SerializedTextNode & { seq: number };

export class ReferenceNode extends TextNode {
  __seq: number;

  static getType(): string {
    return "reference";
  }

  static clone(node: ReferenceNode): ReferenceNode {
    return new ReferenceNode(node.__seq, node.__key);
  }

  constructor(seq: number, key?: NodeKey) {
    super(String(seq), key);
    this.__seq = seq;
  }

  getSeq(): number {
    return this.getLatest().__seq;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.classList.add("note-ref");
    return dom;
  }

  static importJSON(serialized: SerializedReferenceNode): ReferenceNode {
    return $createReferenceNode(serialized.seq);
  }

  exportJSON(): SerializedReferenceNode {
    return { ...super.exportJSON(), seq: this.__seq, type: "reference", version: 1 };
  }
}

export function $createReferenceNode(seq: number): ReferenceNode {
  const node = new ReferenceNode(seq);
  node.setMode("token");
  return $applyNodeReplacement(node);
}

export function $isReferenceNode(node: LexicalNode | null | undefined): node is ReferenceNode {
  return node instanceof ReferenceNode;
}
