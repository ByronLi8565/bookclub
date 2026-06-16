import { useHotkey } from "@tanstack/react-hotkeys";

export function Modal({
  title,
  ariaLabel,
  ariaLabelledBy,
  className = "",
  onClose,
  children,
}: {
  title: React.ReactNode;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  className?: string;
  onClose: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  useHotkey("Escape", onClose, { preventDefault: true });
  const labelledBy = ariaLabelledBy ?? (typeof title === "string" ? "modal-title" : undefined);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={className ? `modal ${className}` : "modal"}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : labelledBy}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <strong id={labelledBy}>{title}</strong>
          <button type="button" onClick={onClose} aria-label="close" title="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ModalPagerTabs<T extends string>({
  tabs,
  active,
  onChange,
  className = "",
}: {
  tabs: { id: T; label: string; title?: string }[];
  active: T;
  onChange: (id: T) => void;
  className?: string;
}): React.ReactElement {
  return (
    <div className={className ? `pager-tabs ${className}` : "pager-tabs"}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-pressed={active === tab.id}
          title={tab.title}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
