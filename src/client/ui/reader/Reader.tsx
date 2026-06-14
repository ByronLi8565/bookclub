import { useEffect, useRef, useState } from "react";
import { Loading } from "../shared/Loading.tsx";
import type { BookUpload } from "../../groups/useBookUpload.ts";
import type { SourceSummary } from "../../../shared/types/sources.ts";
import type { SourceView } from "./useSourceView.ts";

// Reader shell around the SourceView iframe. `floatingNote` renders the desktop
// "Add Note" popup at the selection; on mobile that affordance lives in the
// pager's bottom bar instead, so it (and its dismiss handler) are disabled here.
export function Reader({
  view,
  hasFile,
  loading = false,
  floatingNote = true,
  books = [],
  selectedSourceId = "",
  onSelectBook = () => {},
  bookUpload = null,
}: {
  view: SourceView;
  hasFile: boolean;
  loading?: boolean;
  floatingNote?: boolean;
  // The club's library, the active book, and a selection callback for the title
  // dropdown. `bookUpload` is the owner-only "add a book" action (null hides it).
  books?: SourceSummary[];
  selectedSourceId?: string;
  onSelectBook?: (sourceId: string) => void;
  bookUpload?: BookUpload | null;
}) {
  const { fontSize, setFontSize, ready, selection, search } = view;

  // Focus the search input when the bar opens so the caller can type at once.
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (search.open) searchInputRef.current?.focus();
  }, [search.open]);

  // Dismiss the Add Note popup on any click outside it
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
          upload={bookUpload}
        />
        {view.location && (
          <span className="page-count">
            {view.location.page} / {view.location.total}
            {view.location.percentage > 0 && ` · ${Math.round(view.location.percentage * 100)}%`}
          </span>
        )}
        <span className="spacer" />
        <button onClick={() => setFontSize(Math.max(80, fontSize - 10))} disabled={!ready}>
          −
        </button>
        <span className="font-size">{fontSize}%</span>
        <button onClick={() => setFontSize(fontSize + 10)} disabled={!ready}>
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
          >
            ↑
          </button>
          <button
            onClick={search.next}
            disabled={search.matches.length === 0}
            aria-label="Next match"
          >
            ↓
          </button>
          <button onClick={search.closeSearch} aria-label="Close search">
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
          />
        )}
        {ready && !view.location?.atEnd && (
          <button
            className="reader-page-turn reader-page-turn--next"
            onClick={view.next}
            aria-label="Next page"
          />
        )}
      </div>
      {floatingNote && selection && (
        <button
          className="add-note"
          style={{ left: selection.x, top: selection.y }}
          onClick={view.commitSelection}
        >
          Add Note
        </button>
      )}
    </div>
  );
}

// A human label for a book in the switcher: the member-set title override, or
// (for the active book) the parsed title, falling back to kind + short hash.
function bookLabel(book: SourceSummary, activeTitle: string | null, isActive: boolean): string {
  if (book.title) return book.title;
  if (isActive && activeTitle) return activeTitle;
  return `${book.kind.toUpperCase()} · ${book.id.slice(0, 8)}`;
}

// The book switcher in the reader bar: shows the active book's title with a
// disclosure arrow that opens a dropdown of the club's library. Owners get an
// "Add a book" entry that uploads (and binds) another source. With a single
// book and no upload affordance it renders as a plain, non-interactive title.
function BookMenu({
  activeTitle,
  books,
  selectedSourceId,
  onSelectBook,
  upload,
}: {
  activeTitle: string | null;
  books: SourceSummary[];
  selectedSourceId: string;
  onSelectBook: (sourceId: string) => void;
  upload: BookUpload | null;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const active = books.find((b) => b.id === selectedSourceId) ?? null;
  const label = active ? bookLabel(active, activeTitle, true) : (activeTitle ?? "");
  // No switching and no uploading: just show the title (matches the old bar).
  const interactive = books.length > 1 || upload !== null;

  // The original title element is preserved verbatim; the dropdown only adds an
  // arrow affordance beside it.
  const title = label ? (
    <span className="reader-title" title={label}>
      {label}
    </span>
  ) : (
    <span className="reader-title" />
  );

  if (!interactive) return title;

  return (
    <div className="book-menu" ref={ref}>
      {title}
      <button
        type="button"
        className="book-menu-arrow"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="switch book"
        onClick={() => setOpen((v) => !v)}
      >
        ▾
      </button>
      {open && (
        <ul className="book-menu-list" role="menu">
          {books.map((book) => (
            <li key={book.id} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={book.id === selectedSourceId}
                className={
                  book.id === selectedSourceId ? "book-menu-item is-active" : "book-menu-item"
                }
                onClick={() => {
                  onSelectBook(book.id);
                  setOpen(false);
                }}
              >
                {bookLabel(book, activeTitle, book.id === selectedSourceId)}
              </button>
            </li>
          ))}
          {upload && (
            <li role="none" className="book-menu-add">
              <label className="book-menu-item">
                {upload.busy
                  ? upload.status === "checking"
                    ? "checking…"
                    : "uploading…"
                  : "+ Add a book"}
                <input
                  type="file"
                  accept=".epub,application/epub+zip,.pdf,application/pdf"
                  disabled={upload.busy}
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload.pick(f);
                    setOpen(false);
                  }}
                />
              </label>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
