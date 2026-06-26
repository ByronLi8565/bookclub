import { useMemo, type ReactNode } from "react";

const INLINE_PATTERN = /\[\[(\d+)\]\]|\*\*(.+?)\*\*|\*(.+?)\*/gu;

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
    const [whole, ref, bold, italic] = match;
    const key = `${keyPrefix}-${index++}`;
    if (ref !== undefined) {
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
    } else if (bold !== undefined) {
      nodes.push(<strong key={key}>{bold}</strong>);
    } else if (italic !== undefined) {
      nodes.push(<em key={key}>{italic}</em>);
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
}: {
  body: string;
  refs: Map<number, string>;
  onReference: (seq: number) => void;
}) {
  const blocks = useMemo(
    () =>
      body.split(/\n{2,}/u).flatMap((raw) => {
        const block = raw.trim();
        if (!block) return [];
        const lines = block.split("\n");
        const quote = lines.every((line) => line.startsWith(">"));
        const text = quote
          ? lines.map((line) => line.replace(/^>\s?/u, "")).join(" ")
          : lines.join(" ");
        return [{ key: block, quote, text }];
      }),
    [body],
  );

  return (
    <div className="note-body">
      {blocks.map((block) => {
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
