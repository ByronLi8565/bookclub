import { useMemo, useState } from "react";
import { normalizeTag } from "../../../shared/notes/tags.ts";
import {
  filterTermKey,
  filterTermLabel,
  type NoteFilterSuggestion,
  type NoteFilterTerm,
  type NoteQuery,
  type NoteQueryContext,
  type NotesScope,
} from "../../logic/notes/noteQuery.ts";

export function NoteFilterBar({
  scope,
  query,
  context,
  suggestions,
  currentSourceId,
  onScopeChange,
  onQueryChange,
}: {
  scope: NotesScope;
  query: NoteQuery;
  context: NoteQueryContext;
  suggestions: readonly NoteFilterSuggestion[];
  currentSourceId: string;
  onScopeChange: (scope: NotesScope) => void;
  onQueryChange: (query: NoteQuery) => void;
}) {
  const [input, setInput] = useState("");
  const activeKeys = useMemo(() => new Set(query.terms.map(filterTermKey)), [query.terms]);
  const filteredSuggestions = useMemo(() => {
    const needle = input.trim().toLocaleLowerCase("en-US").replace(/^#/u, "");
    return suggestions
      .filter(
        (suggestion) =>
          !activeKeys.has(filterTermKey(suggestion.term)) &&
          (!needle || suggestion.label.toLocaleLowerCase("en-US").includes(needle)),
      )
      .slice(0, 12);
  }, [activeKeys, input, suggestions]);

  const addTerm = (term: NoteFilterTerm): void => {
    if (activeKeys.has(filterTermKey(term))) return;
    if (term.kind === "property" && term.property === "book") {
      onScopeChange({ kind: "all-books" });
    }
    onQueryChange({ ...query, terms: [...query.terms, term] });
    setInput("");
  };
  const addFreeformTag = (): void => {
    const tag = normalizeTag(input);
    if (tag) addTerm({ kind: "tag", value: tag, negated: false });
  };

  return (
    <div
      className={
        query.terms.length > 0 ? "note-filter-bar note-filter-bar--active" : "note-filter-bar"
      }
    >
      <div className="note-scope" aria-label="Notes scope">
        <button
          type="button"
          className={scope.kind === "current-book" ? "active" : ""}
          onClick={() => {
            onScopeChange({ kind: "current-book", sourceId: currentSourceId });
          }}
        >
          This book
        </button>
        <button
          type="button"
          className={scope.kind === "all-books" ? "active" : ""}
          onClick={() => onScopeChange({ kind: "all-books" })}
        >
          All books
        </button>
      </div>
      <div className="note-filter-terms">
        {query.terms.map((term) => {
          const key = filterTermKey(term);
          return (
            <span
              className={term.negated ? "note-filter-chip excluded" : "note-filter-chip"}
              key={key}
            >
              <button
                type="button"
                title="Include or exclude"
                onClick={() =>
                  onQueryChange({
                    ...query,
                    terms: query.terms.map((candidate) =>
                      filterTermKey(candidate) === key
                        ? { ...candidate, negated: !candidate.negated }
                        : candidate,
                    ),
                  })
                }
              >
                {term.negated ? "Not " : ""}
                {filterTermLabel(term, context)}
              </button>
              <button
                type="button"
                aria-label={`Remove ${filterTermLabel(term, context)} filter`}
                onClick={() =>
                  onQueryChange({
                    ...query,
                    terms: query.terms.filter((candidate) => filterTermKey(candidate) !== key),
                  })
                }
              >
                ×
              </button>
            </span>
          );
        })}
        <div className="note-filter-entry">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (filteredSuggestions[0]) addTerm(filteredSuggestions[0].term);
                else addFreeformTag();
              }
            }}
            placeholder="Filter"
            aria-label="Filter notes"
          />
          {input && (
            <div className="note-filter-suggestions">
              {filteredSuggestions.map((suggestion) => (
                <button
                  key={`${suggestion.group}:${filterTermKey(suggestion.term)}`}
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    addTerm(suggestion.term);
                  }}
                >
                  <span>{suggestion.group}</span>
                  {suggestion.label} <small>{suggestion.count}</small>
                </button>
              ))}
              {normalizeTag(input) &&
                !filteredSuggestions.some((item) => item.label === normalizeTag(input)) && (
                  <button
                    type="button"
                    onPointerDown={(event) => {
                      event.preventDefault();
                      addFreeformTag();
                    }}
                  >
                    <span>Tags</span>Create {normalizeTag(input)} filter
                  </button>
                )}
            </div>
          )}
        </div>
        {query.terms.length > 0 && (
          <div className="note-filter-status">
            {query.terms.filter((term) => !term.negated).length > 1 && (
              <button
                type="button"
                onClick={() =>
                  onQueryChange({ ...query, mode: query.mode === "all" ? "any" : "all" })
                }
              >
                Match {query.mode}
              </button>
            )}
            <button type="button" onClick={() => onQueryChange({ ...query, terms: [] })}>
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
