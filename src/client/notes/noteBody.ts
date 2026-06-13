import { BOLD_STAR, ITALIC_STAR, QUOTE, type Transformer } from "@lexical/markdown";

// The single source of truth for the note body dialect. Both the Lexical editor
// (serialize/parse) and the hand-rolled renderer key off this restricted set:
// paragraphs (implicit), **bold**, *italic*, and `> ` blockquotes. No headings,
// lists, links, images, code, or referenceChips (chips arrive in Step 3).
//
// Order matters for `$convertToMarkdownString`: element transformers first,
// then text-format transformers.
export const NOTE_TRANSFORMERS: Transformer[] = [QUOTE, BOLD_STAR, ITALIC_STAR];
