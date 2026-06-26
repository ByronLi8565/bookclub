import { useEffect } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { pushModal } from "./modalLayer.ts";

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
  useHotkey("Escape", onClose, { preventDefault: true, conflictBehavior: "allow" });
  // While any modal is open, global reader hotkeys are suppressed (see
  // useAnyModalOpen) so the modal owns the keyboard.
  useEffect(() => pushModal(), []);
  const labelledBy = ariaLabelledBy ?? (typeof title === "string" ? "modal-title" : undefined);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <dialog
        open
        className={className ? `modal ${className}` : "modal"}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : labelledBy}
      >
        <div role="presentation" onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <strong id={labelledBy}>{title}</strong>
            <button type="button" onClick={onClose} aria-label="close" title="Close">
              ✕
            </button>
          </div>
          {children}
        </div>
      </dialog>
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
  // Left/Right arrows move between modal pages (and override the reader's
  // page-turn arrows, which are suppressed while a modal is open).
  const step = (delta: number) => {
    if (tabs.length === 0) return;
    const index = tabs.findIndex((tab) => tab.id === active);
    const nextTab = tabs[(index + delta + tabs.length) % tabs.length];
    if (nextTab) onChange(nextTab.id);
  };
  useHotkey("ArrowRight", () => step(1), { preventDefault: true, conflictBehavior: "allow" });
  useHotkey("ArrowLeft", () => step(-1), { preventDefault: true, conflictBehavior: "allow" });
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
