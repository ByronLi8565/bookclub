import type { TextMatchTransformer } from "@lexical/markdown";
import { REFERENCE_IMPORT, REFERENCE_TYPING } from "../../../../shared/references.ts";
import { $createReferenceNode, $isReferenceNode, ReferenceNode } from "./ReferenceNode.ts";

export function createReferenceTransformer(getValidSeqs: () => Set<number>): TextMatchTransformer {
  return {
    dependencies: [ReferenceNode],
    export: (node) => ($isReferenceNode(node) ? `[[${node.getSeq()}]]` : null),
    importRegExp: REFERENCE_IMPORT,

    regExp: REFERENCE_TYPING,
    replace: (textNode, match) => {
      const seq = Number(match[1]);
      if (!getValidSeqs().has(seq)) return;
      textNode.replace($createReferenceNode(seq));
    },
    trigger: "]",
    type: "text-match",
  };
}
