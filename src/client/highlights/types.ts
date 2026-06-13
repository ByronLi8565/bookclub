// A Highlight is a stable reference into an immutable Source.
// It carries two selectors, following W3C Web Annotation model
//   CfiSelector:   the primary, locator (EPUB CFI).
//   QuoteSelector: the fallback, used to rebind if a CFI fails to resolve.

export interface CfiSelector {
  type: "FragmentSelector";
  conformsTo: "http://www.idpf.org/epub/linking/cfi/epub-cfi.html";
  value: string; // Epubcfi(...)
}

export interface QuoteSelector {
  type: "TextQuoteSelector";
  exact: string;
  prefix: string;
  suffix: string;
}

export interface Highlight {
  id: string;
  sourceId: string; // Sha256 of the SourceFile this Highlight lives in
  cfi: CfiSelector;
  quote: QuoteSelector;
  createdAt: string; // ISO, display-only
}

export function cfiSelector(value: string): CfiSelector {
  return {
    type: "FragmentSelector",
    conformsTo: "http://www.idpf.org/epub/linking/cfi/epub-cfi.html",
    value,
  };
}
