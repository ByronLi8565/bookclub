import { useEffect, useRef } from "react";
import { Loading } from "../shared/Loading.tsx";
import { RenamableText } from "../shared/RenamableText.tsx";
import { DropdownMenu, type DropdownItem } from "../shared/DropdownMenu.tsx";
import type { SourceSummary } from "../../../shared/types/sources.ts";
import type { SourceView } from "./useSourceView.ts";

export function Reader({
  view,
  hasFile,
  loading = false,
  floatingNote = true,
  books = [],
  selectedSourceId = "",
  onSelectBook = () => {},
  onRenameBook = () => {},
  onAddBook = null,
}: {
  view: SourceView;
  hasFile: boolean;
  loading?: boolean;
  floatingNote?: boolean;

  books?: SourceSummary[];
  selectedSourceId?: string;
  onSelectBook?: (sourceId: string) => void;
  onRenameBook?: (sourceId: string, title: string) => void;
  onAddBook?: (() => void) | null;
}) {
  const { fontSize, setFontSize, ready, selection, search } = view;

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (search.open) searchInputRef.current?.focus();
  }, [search.open]);

  const { dismissSelection } = view;
  useEffect(() => {
    if (!floatingNote || !selection) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".add-note")) dismissSelection();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [floatingNote, selection, dismissSelection]);
  return (
    <div className="reader">
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
        <button
          onClick={() => setFontSize(Math.max(50, fontSize - 10))}
          disabled={!ready}
          title="Decrease text size"
        >
          −
        </button>
        <span className="font-size">{fontSize}%</span>
        <button
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
            onClick={search.prev}
            disabled={search.matches.length === 0}
            aria-label="Previous match"
            title="Previous match"
          >
            ↑
          </button>
          <button
            onClick={search.next}
            disabled={search.matches.length === 0}
            aria-label="Next match"
            title="Next match"
          >
            ↓
          </button>
          <button onClick={search.closeSearch} aria-label="Close search" title="Close search">
            ✕
          </button>
        </div>
      )}
      <div className="reader-stage">
        <div className="reader-surface" ref={view.containerRef}>
          {loading ? (
            <Loading className="loading--reader" />
          ) : (
            !hasFile && <p className="reader-empty">Open a book to begin.</p>
          )}
        </div>
        {ready && !view.location?.atStart && (
          <button
            className="reader-page-turn reader-page-turn--prev"
            onClick={view.prev}
            aria-label="Previous page"
            title="Previous page"
          />
        )}
        {ready && !view.location?.atEnd && (
          <button
            className="reader-page-turn reader-page-turn--next"
            onClick={view.next}
            aria-label="Next page"
            title="Next page"
          />
        )}
      </div>
      {floatingNote && selection && (
        <button
          className="add-note"
          style={{ left: selection.x, top: selection.y }}
          onClick={view.commitSelection}
          title="Add a note on this selection"
        >
          Add Note
        </button>
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
  onRenameBook: (sourceId: string, title: string) => void;
  onAddBook: (() => void) | null;
}): React.ReactElement {
  const active = books.find((b) => b.id === selectedSourceId) ?? null;
  const label = active ? bookLabel(active, activeTitle, true) : (activeTitle ?? "");

  const interactive = books.length > 1 || onAddBook !== null;

  const title = label ? (
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
    <span className="reader-title" />
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
    <DropdownMenu
      items={items}
      renderTrigger={({ open, toggle }) => (
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
      )}
    >
      {title}
    </DropdownMenu>
  );
}
