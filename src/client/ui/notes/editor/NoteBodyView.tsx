import { useMemo, type ReactNode } from "react";

const INLINE_PATTERN =
  /`([^`]+)`|\[\[key:([^\]]+)\]\]|\[\[(\d+)\]\]|==(.+?)==|\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/gu;
const IMAGE_BLOCK_PATTERN = /^\[\[image:([0-9A-HJKMNP-TV-Z]{26})\]\]$/u;

type BodyBlock = { key: string; quote: boolean; text: string; imageId: string | null };

function renderInlineNodes(
  text: string,
  refs: Map<number, string>,
  onReference: (seq: number) => void,
  keyPrefix: string,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const [whole, code, keycap, ref, mark, bold, italic, underscoreItalic] = match;
    const key = `${keyPrefix}-${index++}`;
    if (code !== undefined) {
      nodes.push(
        <code className="note-code" key={key}>
          {code}
        </code>,
      );
    } else if (keycap !== undefined) {
      nodes.push(
        <kbd className="note-key" key={key}>
          {keycap}
        </kbd>,
      );
    } else if (ref !== undefined) {
      const seq = Number(ref);
      const snippet = refs.get(seq);
      nodes.push(
        snippet === undefined ? (
          whole
        ) : (
          <button
            type="button"
            className="note-ref"
            data-seq={seq}
            title={snippet}
            onClick={() => onReference(seq)}
            key={key}
          >
            {seq}
          </button>
        ),
      );
    } else if (mark !== undefined) {
      nodes.push(
        <mark className="note-mark" key={key}>
          {mark}
        </mark>,
      );
    } else if (bold !== undefined) {
      nodes.push(<strong key={key}>{bold}</strong>);
    } else if (italic !== undefined || underscoreItalic !== undefined) {
      nodes.push(<em key={key}>{italic ?? underscoreItalic}</em>);
    }
    last = start + whole.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function InlineContent({
  text,
  refs,
  onReference,
}: {
  text: string;
  refs: Map<number, string>;
  onReference: (seq: number) => void;
}): ReactNode {
  return renderInlineNodes(text, refs, onReference, text);
}

export function NoteBodyView({
  body,
  refs,
  onReference,
  imageUrlBase,
}: {
  body: string;
  refs: Map<number, string>;
  onReference: (seq: number) => void;
  imageUrlBase?: string;
}) {
  const blocks = useMemo(
    () =>
      body.split(/\n{2,}/u).flatMap((raw): BodyBlock[] => {
        const block = raw.trim();
        if (!block) return [];
        const image = IMAGE_BLOCK_PATTERN.exec(block);
        if (image) return [{ key: block, quote: false, text: "", imageId: image[1] }];
        const lines = block.split("\n");
        const quote = lines.every((line) => line.startsWith(">"));
        const text = quote
          ? lines.map((line) => line.replace(/^>\s?/u, "")).join(" ")
          : lines.join(" ");
        return [{ key: block, quote, text, imageId: null }];
      }),
    [body],
  );

  return (
    <div className="note-body">
      {blocks.map((block) => {
        if (block.imageId) {
          const src = imageUrlBase ? `${imageUrlBase}/${block.imageId}` : null;
          return src ? (
            <figure className="note-image" key={block.key}>
              <img src={src} alt="" loading="lazy" />
            </figure>
          ) : (
            <p key={block.key}>[image unavailable]</p>
          );
        }
        if (block.quote) {
          return (
            <blockquote key={block.key}>
              <InlineContent text={block.text} refs={refs} onReference={onReference} />
            </blockquote>
          );
        }
        return (
          <p key={block.key}>
            <InlineContent text={block.text} refs={refs} onReference={onReference} />
          </p>
        );
      })}
    </div>
  );
}
