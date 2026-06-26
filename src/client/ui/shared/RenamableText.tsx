import { useState } from "react";

export function RenamableText({
  value,
  onRename,
  as: Element = "span",
  className,
  inputClassName,
  title,
  ariaLabel,
  placeholder,
  allowEmpty = false,
}: {
  value: string;
  onRename: (value: string) => void;
  as?: "h1" | "span";
  className?: string;
  inputClassName?: string;
  title?: string;
  ariaLabel?: string;
  placeholder?: string;
  allowEmpty?: boolean;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  function save(): void {
    const next = draft.trim();
    if ((allowEmpty || next !== "") && next !== value) onRename(next);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        className={inputClassName}
        value={draft}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") {
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <Element
      className={className}
      title={title}
      onDoubleClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      {value || placeholder}
    </Element>
  );
}
