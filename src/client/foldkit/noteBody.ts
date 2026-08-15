import type { Html, HtmlBuilder } from "foldkit/html";

// `Child` is not part of foldkit/html's public surface, but children are it.
type Child = Html | string;
import { parseNoteImageBlock } from "../../shared/notes/images.ts";
import { noteImage } from "./noteImage.ts";

/**
 * A note body is blocks separated by blank lines, each of which is an image, a
 * quote, or a paragraph of inline markup. React's `NoteBodyView` is the
 * reference; the pattern below is its `INLINE_PATTERN`, unchanged, so the two
 * renderers cannot disagree about what a note says.
 */
const INLINE_PATTERN =
  /`([^`]+)`|\[\[key:([^\]]+)\]\]|\[\[(\d+)\]\]|==(.+?)==|\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/gu;

interface BodyBlock {
  readonly key: string;
  readonly quote: boolean;
  readonly text: string;
  readonly imageId: string | null;
  readonly imageWidth?: number;
}

export const noteBodyBlocks = (body: string): readonly BodyBlock[] =>
  body.split(/\n{2,}/u).flatMap((raw): BodyBlock[] => {
    const block = raw.trim();
    if (block === "") return [];
    const image = parseNoteImageBlock(block);
    if (image !== null) {
      return [{ key: block, quote: false, text: "", imageId: image.id, imageWidth: image.width }];
    }
    const lines = block.split("\n");
    const quote = lines.every((line) => line.startsWith(">"));
    const text = quote
      ? lines.map((line) => line.replace(/^>\s?/u, "")).join(" ")
      : lines.join(" ");
    return [{ key: block, quote, text, imageId: null }];
  });

export interface NoteBodyContext<Message> {
  /** Numbered references resolve to the note they point at; one with no entry
   *  here stays literal text, exactly as React leaves it. */
  readonly refs: ReadonlyMap<number, string>;
  readonly onReference?: (seq: number) => Message;
  readonly imageUrlBase?: string;
}

const inlineNodes = <Message>(
  text: string,
  { refs, onReference }: NoteBodyContext<Message>,
  h: HtmlBuilder<Message>,
  keyPrefix: string,
): Child[] => {
  const nodes: Child[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const [whole, code, keycap, ref, mark, bold, italic, underscoreItalic] = match;
    const key = `${keyPrefix}-${index++}`;
    if (code !== undefined) {
      nodes.push(h.code([h.Key(key), h.Class("note-code")], [code]));
    } else if (keycap !== undefined) {
      nodes.push(h.kbd([h.Key(key), h.Class("note-key")], [keycap]));
    } else if (ref !== undefined) {
      const seq = Number(ref);
      const snippet = refs.get(seq);
      nodes.push(
        snippet === undefined || onReference === undefined
          ? whole
          : h.button(
              [
                h.Key(key),
                h.Type("button"),
                h.Class("note-ref"),
                h.DataAttribute("seq", String(seq)),
                h.Title(snippet),
                h.OnClick(onReference(seq)),
              ],
              [String(seq)],
            ),
      );
    } else if (mark !== undefined) {
      nodes.push(h.mark([h.Key(key), h.Class("note-mark")], [mark]));
    } else if (bold !== undefined) {
      nodes.push(h.strong([h.Key(key)], [bold]));
    } else if (italic !== undefined || underscoreItalic !== undefined) {
      nodes.push(h.em([h.Key(key)], [italic ?? underscoreItalic ?? ""]));
    }
    last = start + whole.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
};

/**
 * A posted note's body. Images render as the same `<note-image>` element the
 * composer uses, read-only, so an uploaded picture looks the same before and
 * after the note is posted.
 */
export const noteBodyView = <Message>(
  body: string,
  context: NoteBodyContext<Message>,
  h: HtmlBuilder<Message>,
): Html => {
  const image = noteImage.withMessage(h);
  return h.div(
    [h.Class("note-body")],
    noteBodyBlocks(body).map((block, index) => {
      if (block.imageId !== null) {
        return context.imageUrlBase === undefined
          ? h.p([h.Key(block.key)], ["[image unavailable]"])
          : image([
              h.Key(block.key),
              image.ImageId(block.imageId),
              image.Src(`${context.imageUrlBase}/${block.imageId}`),
              image.Width(block.imageWidth ?? 100),
              image.Status("ready"),
              image.ReadOnly(true),
            ]);
      }
      const inline = inlineNodes(block.text, context, h, `${index}`);
      return block.quote
        ? h.blockquote([h.Key(block.key)], inline)
        : h.p([h.Key(block.key)], inline);
    }),
  );
};
