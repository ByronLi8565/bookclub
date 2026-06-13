# Step 2 handoff — single-user cards, local only

This document is the implementation brief for Step 2 of bookclub. It assumes
Step 1 (anchoring) is complete and on disk. No code has been written for Step 2
yet; this is the plan to execute.

## Working principles (apply to every change)

- **Testable at every step.** There is no automated test suite (the maintainer
  drives verification manually). So each build sub-step must land the app in a
  working, demoable state with explicit manual acceptance criteria (listed per
  step below). Never leave the tree half-migrated between sub-steps.
- **Polish the first time.** Carry the Step 1 reader discipline forward: survive
  font-size reflow, two-page spread, and split-pane drag; recompute on
  `relocated` and the rAF resize observer; stable empty states; no `display:flex`
  on the epub container. Do not ship something that needs a cleanup pass later.
- **Minimal, understandable code.** Small modules, clear seams, no speculative
  abstraction. Prefer deleting code to adding flags.
- **Idiomatic Effect.** Services as `Context.Service` + `Layer`; async/failure
  work as Effects run via the `useRun` boundary. Keep pure helpers pure and
  trivial synchronous DOM pokes plain (the Step 1 boundary). Do not force Effect
  into Lexical internals — wrap it at the React boundary.
- **Hard cutover, no fallbacks.** When a thing is replaced, delete the old thing
  outright. No compatibility shims, no dual code paths, no dead exports.
- **House style.** Sentence-case comments. `tsc --noEmit`, `oxlint`, and
  `oxfmt --check` all clean before a sub-step is considered done. Tooling:
  bun, Alchemy v2 (`alchemy@next`), Effect 4 beta, epub.js, idb.

## Scope

**In:** the Card data model; a Lexical rich-text editor (bold, italic,
paragraph, blockquote); local persistence of cards; basic replies; a card panel
in the right pane.

**Deferred — do not build in Step 2:**

- Reading-view docking (cards painted into the reader margin at their passages).
  Step 2 keeps cards in the right panel only. Selecting text still paints the
  passage highlight in the reader, but card bodies are not docked onto the page.
- `referenceChip` inline nodes, reverse index, cites/cited-by → Step 3.
- Durable Object, `seq`, WebSocket sync → Step 4+.
- Real auth / groups; `author` is the literal `"local"` placeholder → Step 7.

## Decisions (settled with the maintainer)

1. **Card owns embedded anchors.** The standalone Step 1 "Highlight" _entity_
   is absorbed into `Card.highlights[]`. An empty-body card renders as a plain
   highlight; a card with a body is a note. One self-contained object, which
   keeps the future Durable Object storage trivial.
2. **Keep the word "Highlight"** for the reference-into-source (cfi + quote).
   So a Card has `highlights: Highlight[]`. No `highlights/ -> anchors/` rename.
   The storage service is still renamed to `CardStore` because it now stores
   cards.
3. **Replies are built.** `parent` is exercised: a reply has a `parent` card id
   and (by convention) an empty `highlights` array — it points at a card, not
   the book. Threaded rendering in the panel.
4. **Add Note flow.** Selecting a passage does not auto-create a card. It arms a
   pending highlight and reveals an **Add Note** button; clicking it opens the
   editor; the card is created on save. Cancel discards (no card, no painted
   highlight).
5. **Hand-rolled minimal renderer** for read-only card bodies (see below).

## Data model

`src/client/cards/types.ts`:

```ts
export interface Card {
  id: string; // local uuid now; server ULID in Step 4+
  sourceId: string; // the Source (book) hash this card belongs to
  author: string; // "local" until Step 7
  parent: string | null; // another card id for replies; null for top-level notes
  body: string; // markdown serialized from Lexical (may be empty)
  highlights: Highlight[]; // embedded anchors; empty for replies
  createdAt: string; // local clock; ordering only until seq exists
  editedAt: string | null;
  version: number; // bumped on edit; groundwork for Step 4 baseVersion
}
```

Reuse the existing `Highlight`, `CfiSelector`, `QuoteSelector` types from
`src/client/highlights/types.ts` unchanged.

Include `parent`, `version`, and `editedAt` in the model now even though the UI
exercises them lightly, to avoid a storage migration later.

## Body format and the minimal renderer

- **Editor → markdown:** Lexical with a restricted node set only — bold, italic,
  paragraph, blockquote. Serialize/parse with `@lexical/markdown` using an
  explicitly filtered transformer list: `BOLD_STAR`, `ITALIC_STAR`, `QUOTE`
  (paragraphs are implicit). No headings, lists, links, images, code, or
  referenceChip (chips are Step 3).
- **Markdown → HTML (`renderCardBody`)**: a tiny hand-rolled function. It must
  mirror the exact dialect produced by the transformer list above and nothing
  more:
  - HTML-escape all text first.
  - `**bold**` → `<strong>`, `*italic*` → `<em>`.
  - Lines beginning `> ` → `<blockquote>`.
  - Blank-line-separated runs → `<p>`.
  - Target ~40-50 lines. No markdown dependency.
  - Keep it structured so a `referenceChip` token branch can be added in Step 3
    without a rewrite.
- The editor and the renderer share one source of truth for the token set
  (`cards/cardBody.ts` holds the transformer list and the dialect constants).
  This kills editor/renderer dialect drift.

## Module tree (deltas from Step 1)

```
src/client/
  cards/
    types.ts            Card
    createCard.ts       Effect: build a Card from a pending highlight + body
    cardBody.ts         shared transformer list / dialect constants
    renderCardBody.ts   markdown -> HTML (minimal, hand-rolled)
  storage/
    CardStore.ts        Context.Service + Layer (REPLACES HighlightStore.ts)
    db.ts               IndexedDB: `cards` object store keyed by id, index by sourceId
  ui/
    editor/
      CardEditor.tsx     Lexical instance, restricted nodes, small toolbar
      CardBodyView.tsx   read-only body via renderCardBody
    CardPanel.tsx        right-pane list of top-level cards (REPLACES HighlightList.tsx)
    CardThread.tsx       a card + its nested replies, with actions
  runtime.tsx            add CardStoreLive to the layer (remove HighlightStoreLive)
```

Unchanged: `highlights/` (capture/locate/quote/wordBoundary), `ui/reader/*`,
`ui/SplitPane.tsx`, `sources/`.

Deleted in the cutover: `storage/HighlightStore.ts`, `ui/HighlightList.tsx`, and
the old `highlights` IndexedDB object store. No standalone-highlight persistence
remains.

## Reader integration (selection + Add Note)

- `useSourceView` currently creates a highlight on the epub.js `selected` event.
  Change it to instead expose a **pending highlight**: on `selected`, compute the
  `Highlight` (cfi + quote) via the existing capture logic and store it as
  pending state; clear it on `relocated` / deselect. Do not hold a live DOM
  Range across async work.
- The reader toolbar gets an **Add Note** button, enabled only when a pending
  highlight exists. Clicking opens `CardEditor` (in the panel) pre-attached to
  that highlight. On save: run `createCard` + `CardStore.save`, paint the
  highlight, clear pending, show the card in the panel. (A floating popover over
  the selection would re-introduce the deferred iframe-overlay positioning
  problem; use the toolbar button.)

## Build sub-order (each step demoable)

Each step ends green on `tsc` + `oxlint` + `oxfmt --check`.

1. **Model + CardStore cutover.** Add `cards/types.ts`, `createCard`,
   `storage/CardStore.ts`, `db.ts` cards store; wire `runtime.tsx`. Replace
   `HighlightList` with a minimal `CardPanel` and `HighlightStore` with
   `CardStore`. Add the Add Note button that creates an **empty-body** card from
   the pending highlight (no editor yet). Delete `HighlightStore.ts` and
   `HighlightList.tsx`.
   - Acceptance: select a passage, Add Note creates a card; panel lists cards by
     their quote; jump-to-passage and delete work; reload re-lists cards and the
     anchors re-locate/rebind exactly as Step 1 did.
2. **Lexical editor + body round-trip + renderer.** Add `cardBody.ts`,
   `renderCardBody.ts`, `CardEditor.tsx`, `CardBodyView.tsx`. Add Note now opens
   the editor; saving stores `body`; existing cards are editable; the panel
   renders bodies via `renderCardBody`.
   - Acceptance: write bold/italic/blockquote/paragraphs, save, reload — body
     round-trips faithfully and renders identically in read-only view; editing
     bumps `version` and sets `editedAt`.
3. **Replies.** Add `CardThread.tsx`; a Reply action under each card opens the
   editor inline; saving creates a child card (`parent` set, empty `highlights`);
   threads render nested in the panel.
   - Acceptance: reply to a card; reply renders nested; persists across reload;
     deleting a parent **orphans** its replies — the children are left in place
     untouched, and the panel renders any card whose `parent` does not resolve
     to an existing card as a top-level card. No cascade, no rewrite of children.

## Open sub-decisions for the implementer (resolve before coding the relevant step)

- Where the editor renders for a top-level note (inline at panel top vs. a
  dedicated compose slot) — keep it brutalist and in-panel; no modal.
- Whether empty-body cards show a placeholder ("(no note)") or just the quote in
  the panel.

## Conventions reminder

- Comments in sentence case.
- Effect imports as `import * as X from "effect/X"`.
- Run effects from React via `useRun`; services via `Context.Service` + `Layer`.
- Vocabulary: Source, Card, Highlight (the cfi+quote anchor), the painted
  highlight is the visual of a card's highlight. Note = card with highlight(s)
  and a body; reply = card with a parent.
