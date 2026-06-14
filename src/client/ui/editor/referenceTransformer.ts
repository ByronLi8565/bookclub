import type { TextMatchTransformer } from "@lexical/markdown";
import { $createReferenceNode, $isReferenceNode, ReferenceNode } from "./ReferenceNode.ts";

// Round-trips `[[n]]` <-> ReferenceNode for both markdown import/export and live
// typing. The chip is only created when the seq resolves to a real note (per
// `getValidSeqs`, read fresh each time so peer additions are picked up): an
// unknown number like `[[99]]` is left as plain text rather than chipped.
export function createReferenceTransformer(getValidSeqs: () => Set<number>): TextMatchTransformer {
  return {
    dependencies: [ReferenceNode],
    export: (node) => ($isReferenceNode(node) ? `[[${node.getSeq()}]]` : null),
    importRegExp: /\[\[(\d+)\]\]/u,
    // Trailing $ + trigger "]" so the live shortcut fires as the closing ]] is typed.
    regExp: /\[\[(\d+)\]\]$/u,
    replace: (textNode, match) => {
      const seq = Number(match[1]);
      if (!getValidSeqs().has(seq)) return;
      textNode.replace($createReferenceNode(seq));
    },
    trigger: "]",
    type: "text-match",
  };
}
