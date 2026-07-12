import { useEffect, useRef, useState } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Loading } from "../shared/Loading.tsx";
import { RenamableText } from "../shared/RenamableText.tsx";
import {
  DropdownMenu,
  type DropdownItem,
  type DropdownTriggerProps,
} from "../shared/DropdownMenu.tsx";
import { useDelayedFlag } from "../shared/hooks/useDelayedFlag.ts";
import { useAnyModalOpen } from "../shared/modalLayer.ts";
import type { SourceSummary } from "../../../shared/types/sources.ts";
import type { SourceView } from "./useSourceView.ts";
import { ReaderSnapshot } from "./ReaderSnapshot.tsx";

const EMPTY_BOOKS: SourceSummary[] = [];

export function Reader({
  view,
  hasFile,
  loading = false,
  floatingNote = true,
  books = EMPTY_BOOKS,
  selectedSourceId = "",
  onSelectBook = () => {},
  onRenameBook = null,
  onAddBook = null,
  chromeHidden = false,
}: {
  view: SourceView;
  hasFile: boolean;
  loading?: boolean;
  floatingNote?: boolean;

  books?: SourceSummary[];
  selectedSourceId?: string;
  onSelectBook?: (sourceId: string) => void;
  onRenameBook?: ((sourceId: string, title: string) => void) | null;
  onAddBook?: (() => void) | null;
  chromeHidden?: boolean;
}) {
  const { fontSize, setFontSize, ready, selection, search } = view;
  const modalOpen = useAnyModalOpen();

  // Hold the "Add Note" button back by a beat so it doesn't flash in mid-drag.
  const showAddNote = useDelayedFlag(selection !== null, 250);

  useHotkey("F", () => view.fitToText?.(), {
    enabled: ready && !modalOpen && Boolean(view.fitToText),
    preventDefault: true,
  });

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // Focus + select-all whenever search opens (focusTick changes on each
  // openSearch), so a repeat Ctrl+F while already open highlights the current
  // term and lets you type a fresh query immediately.
  useEffect(() => {
    if (!search.open) return;
    const input = searchInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [search.open, search.focusTick]);

  const { dismissSelection } = view;
  useEffect(() => {
    if (!floatingNote || !selection) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".selection-actions")) dismissSelection();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [floatingNote, selection, dismissSelection]);
  return (
    <div className={chromeHidden ? "reader reader--chrome-hidden" : "reader"}>
      <div className="reader-bar">
        <BookMenu
          activeTitle={view.title}
          books={books}
          selectedSourceId={selectedSourceId}
          onSelectBook={onSelectBook}
          onRenameBook={onRenameBook}
          onAddBook={onAddBook}
        />
        {view.location && view.location.total > 0 && (
          <span className="page-count">
            {view.location.page} / {view.location.total}
            {view.location.percentage > 0 && ` · ${Math.round(view.location.percentage * 100)}%`}
          </span>
        )}
        <span className="spacer" />
        {view.fitToText && (
          <button
            type="button"
            className="reader-fit"
            onClick={view.fitToText}
            disabled={!ready}
            aria-label="Fit text to screen"
            title="Fit text to screen"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path
                d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="square"
                strokeLinejoin="miter"
              />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={() => setFontSize(Math.max(50, fontSize - 10))}
          disabled={!ready}
          title="Decrease text size"
        >
          −
        </button>
        <span className="font-size">{fontSize}%</span>
        <button
          type="button"
          onClick={() => setFontSize(fontSize + 10)}
          disabled={!ready}
          title="Increase text size"
        >
          +
        </button>
      </div>
      {search.open && (
        <div className="reader-search">
          <input
            ref={searchInputRef}
            className="reader-search-input"
            type="text"
            aria-label="Find in book"
            placeholder="Find in book"
            value={search.query}
            onChange={(e) => search.setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) search.prev();
                else search.next();
              } else if (e.key === "Escape") {
                e.preventDefault();
                search.closeSearch();
              } else if (e.key === "ArrowRight" && search.matches.length > 0) {
                // Page through matches with the arrow keys while focused here.
                e.preventDefault();
                search.next();
              } else if (e.key === "ArrowLeft" && search.matches.length > 0) {
                e.preventDefault();
                search.prev();
              }
            }}
          />
          <span className="reader-search-count">
            {search.searching
              ? "…"
              : search.matches.length === 0
                ? search.query.trim() === ""
                  ? ""
                  : "0 / 0"
                : `${search.active + 1} / ${search.matches.length}`}
          </span>
          <button
            type="button"
            onClick={search.prev}
            disabled={search.matches.length === 0}
            aria-label="Previous match"
            title="Previous match"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={search.next}
            disabled={search.matches.length === 0}
            aria-label="Next match"
            title="Next match"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={search.closeSearch}
            aria-label="Close search"
            title="Close search"
          >
            ✕
          </button>
        </div>
      )}
      <div className="reader-stage">
        <div className="reader-surface" ref={view.containerRef}>
          {loading && view.snapshot && <ReaderSnapshot snapshot={view.snapshot} />}
          {loading ? (
            <Loading className="loading--reader" />
          ) : (
            !hasFile && <p className="reader-empty label">Open a book to begin.</p>
          )}
        </div>
        {ready && !view.location?.atStart && (
          <button
            type="button"
            className="reader-page-turn reader-page-turn--prev"
            onClick={view.prev}
            aria-label="Previous page"
            title="Previous page"
          />
        )}
        {ready && !view.location?.atEnd && (
          <button
            type="button"
            className="reader-page-turn reader-page-turn--next"
            onClick={view.next}
            aria-label="Next page"
            title="Next page"
          />
        )}
      </div>
      {floatingNote && selection && showAddNote && (
        <div className="selection-actions" style={{ left: selection.x, top: selection.y }}>
          <button
            type="button"
            className="add-note label"
            onClick={() => view.commitSelection("highlight")}
            title="Highlight this selection"
          >
            Highlight
          </button>
          <button
            type="button"
            className="add-note label"
            onClick={() => view.commitSelection("note")}
            title="Add a note on this selection"
          >
            Add Note
          </button>
        </div>
      )}
    </div>
  );
}

function bookLabel(book: SourceSummary, activeTitle: string | null, isActive: boolean): string {
  if (book.title) return book.title;
  if (isActive && activeTitle) return activeTitle;
  return `${book.kind.toUpperCase()} · ${book.id.slice(0, 8)}`;
}

function BookMenu({
  activeTitle,
  books,
  selectedSourceId,
  onSelectBook,
  onRenameBook,
  onAddBook,
}: {
  activeTitle: string | null;
  books: SourceSummary[];
  selectedSourceId: string;
  onSelectBook: (sourceId: string) => void;
  onRenameBook: ((sourceId: string, title: string) => void) | null;
  onAddBook: (() => void) | null;
}): React.ReactElement {
  const active = books.find((b) => b.id === selectedSourceId) ?? null;
  const label = active ? bookLabel(active, activeTitle, true) : (activeTitle ?? "");

  const interactive = books.length > 1 || onAddBook !== null;
  const modalOpen = useAnyModalOpen();

  const [openSignal, setOpenSignal] = useState(0);
  useHotkey("S", () => setOpenSignal((n) => n + 1), { enabled: interactive && !modalOpen });

  const title =
    label && onRenameBook ? (
      <RenamableText
        value={label}
        onRename={(nextTitle) => {
          if (active) onRenameBook(active.id, nextTitle);
        }}
        className="reader-title"
        title="Double-click to rename the book"
        ariaLabel="book title"
        inputClassName="reader-title-edit"
      />
    ) : (
      <span className="reader-title">{label}</span>
    );

  if (!interactive) return title;

  const items: DropdownItem[] = books.map((book) => ({
    key: book.id,
    label: bookLabel(book, activeTitle, book.id === selectedSourceId),
    title: `Open ${bookLabel(book, activeTitle, book.id === selectedSourceId)}`,
    checked: book.id === selectedSourceId,
    className: book.id === selectedSourceId ? "book-menu-item is-active" : "book-menu-item",
    onSelect: () => onSelectBook(book.id),
  }));
  if (onAddBook) {
    items.push({
      key: "add-book",
      label: "+ Add a book",
      title: "Add a book",
      itemClassName: "book-menu-add",
      onSelect: onAddBook,
    });
  }

  return (
    <DropdownMenu items={items} openSignal={openSignal} Trigger={BookMenuTrigger}>
      {title}
    </DropdownMenu>
  );
}

function BookMenuTrigger({ open, toggle }: DropdownTriggerProps): React.ReactElement {
  return (
    <button
      type="button"
      className="book-menu-arrow"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label="switch book"
      title="Switch book"
      onClick={toggle}
    >
      ▾
    </button>
  );
}
