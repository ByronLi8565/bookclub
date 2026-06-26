import { useEffect, useRef, useState } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";

export interface DropdownItem {
  key: string;
  label: React.ReactNode;
  title?: string;
  checked?: boolean;
  className?: string;
  itemClassName?: string;
  role?: "menuitem" | "menuitemradio";
  onSelect: () => void;
}

export interface DropdownTriggerProps {
  open: boolean;
  toggle: () => void;
}

interface DropdownMenuProps<P extends object> {
  className?: string;
  listClassName?: string;
  itemClassName?: string;
  items: DropdownItem[];
  children?: React.ReactNode;
  Trigger: React.ComponentType<DropdownTriggerProps & P>;
  triggerProps?: P;
  /** Increment to imperatively open the menu (e.g. from a hotkey). */
  openSignal?: number;
}

export function DropdownMenu<P extends object = object>({
  className = "book-menu",
  listClassName = "book-menu-list",
  itemClassName = "book-menu-item",
  items,
  children,
  Trigger,
  triggerProps = {} as P,
  openSignal,
}: DropdownMenuProps<P>): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const openedSignalRef = useRef(openSignal);

  if (openedSignalRef.current !== openSignal) {
    openedSignalRef.current = openSignal;
    if (openSignal) setOpen(true);
  }

  useHotkey("Escape", () => setOpen(false), { enabled: open, preventDefault: true });

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) setOpen(false);
    };
    const onBlur = () => setOpen(false);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const buttons = () => [...list.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const focusAt = (index: number) => {
      const menuItems = buttons();
      if (menuItems.length === 0) return;
      menuItems[(index + menuItems.length) % menuItems.length]?.focus();
    };
    const activeIndex = () => {
      const menuItems = buttons();
      const focused = document.activeElement;
      const index = focused instanceof HTMLButtonElement ? menuItems.indexOf(focused) : -1;
      return index >= 0 ? index : menuItems.findIndex((button) => button.ariaChecked === "true");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusAt(activeIndex() + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusAt(activeIndex() - 1);
      } else if (event.key === "Enter") {
        const target = document.activeElement;
        if (target instanceof HTMLButtonElement && list.contains(target)) {
          event.preventDefault();
          target.click();
        }
      }
    };
    focusAt(activeIndex());
    list.addEventListener("keydown", onKeyDown);
    return () => list.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className={className} ref={ref}>
      {children}
      <Trigger {...triggerProps} open={open} toggle={() => setOpen((v) => !v)} />
      {open && (
        <ul className={listClassName} role="menu" ref={listRef}>
          {items.map((item) => (
            <li key={item.key} role="none" className={item.itemClassName}>
              <button
                type="button"
                role={item.role ?? (item.checked === undefined ? "menuitem" : "menuitemradio")}
                aria-checked={item.checked}
                className={item.className ?? itemClassName}
                title={item.title}
                onClick={() => {
                  item.onSelect();
                  setOpen(false);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
