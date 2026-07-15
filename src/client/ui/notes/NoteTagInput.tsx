import { isHiddenTag, isReservedTag } from "../../../shared/notes/tags.ts";

export function NoteTagInput({
  tags,
  editable = false,
  onRemove,
  onFilter,
}: {
  tags: readonly string[];
  editable?: boolean;
  onRemove?: (tag: string) => void;
  onFilter?: (tag: string) => void;
}) {
  const visibleTags = tags.filter((tag) => !isHiddenTag(tag));
  if (visibleTags.length === 0) return null;

  return (
    <div className={editable ? "note-tags note-tags--editable" : "note-tags"}>
      {visibleTags.map((tag) => (
        <span className="note-tag" key={tag}>
          <button type="button" onClick={() => onFilter?.(tag)} title={`Filter by ${tag}`}>
            {tag}
          </button>
          {editable && !isReservedTag(tag) && (
            <button
              type="button"
              className="note-tag-remove"
              onClick={() => onRemove?.(tag)}
              aria-label={`Remove #${tag}`}
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
