# Effect HttpApi and Foldkit next-agent handoff

The canonical design and phase ledger are in `docs/plans/effect-httpapi-migration.md`; do not
duplicate or reinterpret them here. This file records only what is true right now, and what to do
next.

## Current state

- **Server Phases 1-7 are done.** All 45 structured routes go through the shared HttpApi contract
  and typed handlers. Hono, the legacy route modules, `src/server/http.ts`, and
  `src/server/workflows/` are deleted; `src/server/worker.ts` is 26 lines.
- `nativeCors` is the single CORS owner: `live.ts` applies `NativeCorsLayer` globally, and
  `e2e/scenarios/http-protocol.test.ts` proves the preflight contract against a booted worker.
- **All four byte uploads** — book, note image, backup restore, avatar — declare a multipart-stream
  payload on the contract and run through the generated client. No raw-body upload path remains.
- **The Foldkit client is split by concern**: `application.ts` (session, account, groups, routing),
  `reader.ts`, `notes.ts`. `update` dispatches to the reader and notes slices by schema guard.
- **The reader is a slice factory.** `makeReaderSlice({ loadSource, positions, snapshotFor })` owns
  the EPUB and PDF Mounts, the Commands that act on the live document, `update`, and `view`. Its
  collaborators are constructor-injected, which is what lets the browser harness open a book with no
  account and no source cache; production passes `browserReaderEnvironment`.
- **Phase 5 items 5-7 are done** (see below for what that covers and what it does not).
- Note composition runs through the Lexical Mount, including image paste and a file picker; both
  reach one `UploadNoteImage` Command.
- **React is still the production client.** The Foldkit entry stays out of the production bundle
  (359.00 kB gzip).
- **The Foldkit entry is reachable in development** at `/foldkit` (`foldkit.html`), served by the
  same dev worker as React at `/`. Vite's build input is `index.html` alone, so the extra page costs
  the production bundle nothing. `@foldkit/vite-plugin` is registered for `serve` only — in a build
  it adds ~9 kB gzip to the React bundle for HMR machinery nothing ships.

## What the reader now does

- **Highlights.** Notes own them; `updateNotesSlice` feeds the reader the desired set as
  `ShowedReaderHighlights`, and one `PaintReaderHighlights` Command reconciles them through the
  adapter. EPUB painting goes through epub.js annotations keyed by CFI; PDF painting goes into the
  pane's `.pdf-highlights` layer. Erasing is the same reconciliation with a smaller set.
- **Search-highlight painting.** Standing on a match navigates to it and paints it in `bc-search`
  (`.pdf-underlines` for a PDF), independent of committed highlights; closing search clears it.
- **Live spread change with repaint.** An EPUB relayouts in place — `setSpread` redisplays the
  current CFI and repaints the annotations the relayout dropped — so the reader keeps its place. A
  PDF layout or zoom change is a new Mount element key, and `PdfSpreadRendered` repaints into the
  rebuilt panes.
- **Pagination measurement.** `measureEpubPagination`/`epubPageCount` moved out of
  `useEpubSourceView.ts` into `src/client/ui/reader/engine/epubPagination.ts` and are now shared by
  both readers. The EPUB Mount measures on open, on zoom, and after a spread change; the count
  rides on `EpubPlace.count` so the Model stays serializable.
- **Keyboard and swipe Subscriptions** replace `@tanstack/react-hotkeys` and `react-swipeable` for
  the Foldkit entry: `readerKeyMessage` (Mod+F, Escape, arrows, `d`, `z`, Shift+arrows, and
  deference to typing targets) and `readerSwipeStream` (the same 50px/80px/500ms thresholds and the
  same horizontal-scroller lock). Both are gated on a reader being open.
- **PDF zoom** is in the toolbar and in the Mount element key; EPUB text size restyles in place.
- **Selection, notes, and place** as described under "Reader parity" below.

React still owns those libraries — this replaces them only for the Foldkit entry. They can be
deleted at cutover, not before.

## How the Foldkit reader is verified

`src/tests/harness/foldkitReader.html` runs the reader slice alone against a fixture book, the way
`TestHarness.tsx` does for React. `src/tests/playwright/foldkitReader.pw.ts` (Desktop Safari) and
`foldkitReaderGestures.pw.ts` (Mobile Safari) drive it. `foldkitComposer.html` does the same for the
note composer, so the image widget's pointer drag runs against a real Lexical editor. jsdom renders neither library, so
`test:foldkit` covers the Model, the key mapping, and lifecycle only — never rendering.

The harness cannot use the production source cache: Playwright's WebKit build refuses to store a
`Blob` in IndexedDB. It substitutes a byte loader that fetches the fixture URL, which is only
possible because the loader is injected when the slice is constructed.

## Validation — 2026-08-19 (after the shell restructure)

- `bun run check` passes (format, lint, typecheck).
- `bun run test` — 313 passed across 49 files.
- `bun run test:foldkit` — 105 passed across 12 files.
- `bun run e2e` — 10 passed across 9 scenarios against a booted wrangler worker.
- `bun run build` passes; the React client is 359.00 kB gzip, so Foldkit stays out of it.
- `foldkitApp.pw.ts` — passes on Desktop Chrome, run repeatedly.
- **The WebKit projects were not run.** See "Running the browser suite": they cannot start in a
  detached session. They passed 51/51 on 2026-08-18 and nothing since then touched the reader,
  gesture, or composer paths, but that is an inference and not a result.

Every defect in "What running the app turned up" slipped through the gates that existed at the time,
because they all live in the seam between the assembled client and a real server. `foldkitApp.pw.ts`
is that missing gate and now covers the whole journey — sign in, clubs, club, book, split reader —
with an assertion at each stage that names the failure it guards against.

## Running the browser suite

`bun run test:e2e` needs a launchd session attached to the user's GUI session. In a detached one —
an agent session parented to a daemon rather than to a terminal — `launchctl managername` fails with
`141`, and a browser that registers a mach service or an `NSApplication` aborts on startup:

- **Chromium** dies in `mach_port_rendezvous` registering its `MachPortRendezvousServer`. Setting
  `PW_DETACHED_SESSION=1` starts it with `--single-process --no-zygote`, which skips that
  registration. Only **one browser context** survives per launch there, which is why
  `foldkitApp.pw.ts` is a single journey rather than several tests.
- **WebKit** dies in AppKit's `_RegisterApplication`, and there is no equivalent flag. Everything on
  the Desktop/Mobile Safari projects — the reader, gesture, and composer suites — **cannot run in a
  detached session at all** and has to be run from a terminal.

So `PW_DETACHED_SESSION=1 bunx playwright test src/tests/playwright/foldkitApp.pw.ts` is what an
agent can verify by itself; the WebKit projects need the reader to run them.

Editing a source file and immediately running the suite flakes: the page can load while Vite is
mid-invalidation and render nothing, failing on the first assertion. Give the dev server a few
seconds to settle before re-running.

## Known flakiness — read before debugging

Desktop Safari fails **one or two tests per full run, a different pair each time**, and every one of
them passes in isolation in a couple of seconds. This is WebKit under full-suite load, not a
regression. Re-run the named tests in isolation before investigating:

```
bun run test:e2e -- --project="Desktop Safari" -g "<test name>"
```

If a *specific* test fails in isolation, that is a real failure and is worth chasing.

## Remaining plan

### 1. Reader parity — what is left

The reader parity gaps recorded in the previous handoff are now closed:

- **Selection popup.** The Mounts publish the selection's viewport point and its full
  `TextQuoteSelector` (exact, prefix, suffix) rather than a bare string, so the popup can be placed
  and a committed highlight can be re-anchored after reflow. "Highlight" posts the marked quote as a
  tagged note; "Add Note" carries the passage into the composer. A press outside the popup lets the
  selection go, through a Subscription gated on there being one.
- **Highlight-click navigation, both ways.** Clicking a painted highlight focuses the note that
  carries it; a note's "Show passage" sends the reader back to its anchor.
- **Reading position.** `ReaderPositions` is injected into the slice: the local record answers
  opening (offline, no round trip), the server copy is merged when it arrives, every reported place
  is recorded, and a 3-second Subscription pushes what the server has not seen. A place that lands
  after the book opened re-seeds the Mount through `mountGeneration`, since Mount args are captured
  at insert.
- **Snapshot placeholder, empty state, fit-to-text, page-turn zones.** The reader shows the last
  rendered page while the next open loads, the workspace shows "Open a book to begin." with no book,
  `F` fits a PDF's text to the viewport, and the invisible edge zones turn pages and disappear at
  the ends — all with the React reader's own class names, so its CSS and chrome collapse carry over.
- **Mobile pager.** Reader and notes are two pages of a swipeable track with the tab bar, and the
  layout follows the same `(max-width: 720px)` breakpoint the React workspace uses, through a
  media-query Subscription.

Still not reproduced in Foldkit, deliberately:

- The book menu: switching, renaming, and adding a book from the reader bar. That chrome belongs to
  the workspace shell rather than the reader, and the Foldkit group view has its own catalog.
- PDF highlights are painted non-interactive, matching what React effectively does — its
  `.pdf-highlights` layer is `pointer-events: none`, so its per-rect click handler never fires.
  Clickable PDF highlights would be a new behaviour for both entries, not parity.
- The snapshot placeholder is proven at the Model level only: showing it needs a *second* open of a
  book whose render was captured, which the single-book harness cannot stage.

### 2. Note images — done

`NoteImageNode`'s interactive UI is no longer a stop condition. The widget is a native custom
element, `<note-image>`, and each client meets it at the seam that suits it:

- **Lexical** builds it in `createDOM` and writes its properties in `updateDOM`, which returns
  `false` — the element diffs its own properties. `decorate()` returns nothing, so no framework
  renderer is involved.
- **The Mount** listens for the element's `CustomEvent`s on the editor root. Resize and remove are
  edits to the document the editor already owns, so they are applied to the node and reach the
  Model through the draft publisher, exactly like typing. Retry is a domain fact and becomes a
  Message.
- **Foldkit views** bind the same element with `CustomElement.define` (`src/client/foldkit/noteImage.ts`),
  which is how a posted note's body now renders its images instead of showing the raw
  `[[image:…]]` block.

An upload is now visible while it happens: `ShowPendingNoteImage` puts the picture in the document
against a token, `ResolveNoteImage` / `MarkNoteImageFailed` settle it in place, and a failed one
keeps its preview and its file so `Retry` can send it again. The editor holds the file — the Model
never does. Settling an upload no longer bumps `composerGeneration`, so the reader keeps their undo
history and cursor. Removing an image discards the upload behind it, as does abandoning or posting
a draft that dropped one, and the composer refuses to post while any image is unresolved.

React keeps its own `decorate()` implementation until cutover. The element is framework-neutral, so
adopting it there first is available if the two entries need identical DOM for a parity diff.

Not carried over: the widget's chrome is the editor's, so a posted note renders it read-only, and
note bodies still render as plain blocks otherwise — inline formatting, quotes, and references in
posted notes are a separate parity item.

### 3. What running the app turned up

Driving the Foldkit entry against the dev worker found four defects that no test covered, because
every existing test drives a slice or a harness rather than the whole application:

- **`set-cookie` is a forbidden response header.** The contract declared it required on every
  session response, and the browser hides it from `fetch`, so *every* sign-in failed client-side
  with `SchemaError(Missing key at ["headers"]["set-cookie"])` — while the cookie itself was stored
  correctly. It is `Schema.optionalKey` now. The server still sends it; only the client's decode
  stopped insisting on seeing it. React never hit this because `apiFetch` decodes nothing.
- **A successful sign-in left the reader on the login form.** `LoadedSession` set the session but
  not the route.
- **Group references were built from the bare `publicId`.** The server resolves a `groupRef` by
  taking the segment after the last `-`, so every `/groups/:groupRef` call from Foldkit answered
  404. React builds the same references with `groupUrlName(group)`, which Foldkit now uses too.
- **The reader could only open a book already in the local cache.** `loadCachedBytes` threw "This
  book is not available offline yet" for every first open, because nothing downloaded the source.
  The loader now falls back to `groups.book` through the generated client and fills the cache, which
  needed `groupRef` threaded into both Mounts' args.

Two smaller things came with them: the catalog listed books as inert text, so nothing in the UI
could open the reader at all, and the shell was a bare `<main>` without `.app`, so the workspace
split had no height and the notes pane stacked under the reader instead of beside it.

Restructuring the shell (below) surfaced two more of the same kind:

- **A `<dialog>` without `open` is hidden by the UA stylesheet.** The sign-in modal rendered into
  the DOM and was invisible, so clicking "sign in" appeared to do nothing at all. `querySelector`
  finds a hidden dialog perfectly well, which is why the first jsdom test missed it; it now asserts
  `dialog.modal[open]`.
- **Two inputs reporting one message overwrite each other.** Both login fields sent
  `ChangedLogin({ email, password })`, each filling in the other field from the model its handler
  had closed over. Editing the second field wrote a stale value back over the first, so the form
  could never hold both at once and the submit button stayed disabled forever. They are
  `ChangedLoginEmail` and `ChangedLoginPassword` now. **One message per field is the rule** — a
  message carrying a sibling field's value is a stale write waiting to happen.

### 4. The shell, restructured

Home, login, club, and account render React's own card markup — `.home > .home-card` with
`.home-corner--login`, `.home-main`, `.home-title`, `.home-create`, `.home-club-list`, and the
credit corner — so `home.css` and `shared.css` apply unchanged. Signing in is a modal over the card
(`.modal-backdrop > dialog.modal[open]`), matching how React presents it. The scaffold `<h1>` and
nav row are gone; React has no such chrome. Error toasts render as `.toast-viewport`.

The stylesheet was never the problem — it loads through `entry.ts`. Class names were: every
`h.Class` in `application.ts` was a workspace or pager class, so element selectors styled the page
and every `home-*` rule matched nothing.

`src/tests/foldkit/shellView.test.ts` renders each route through the real runtime under jsdom and
asserts that structure, because a view with the right elements and the wrong classes is unstyled
markup that no Model-level test can see.

### 5. Phase 8 cutover — delete React

In plan order: run the browser suite against both entries on the same user-meaningful scenarios and
fix parity in Foldkit; make Foldkit the production entry and verify PWA, Capacitor iOS, and Android
builds *before* deleting anything; then delete React components, hooks, harnesses, and the
React-only dependencies once `rg` shows no runtime callers.

Two specifics worth planning for:

- `src/client/logic/net/api.ts` (`apiFetch`) can now be deleted outright. It survives only for React
  callers; `bookclubClient` already reproduces everything it does.
- `src/tests/playwright/visual.pw.ts` snapshots are taken against the React DOM and will not survive
  cutover. Re-baseline **after** the parity scenarios pass, and diff old against new for unintended
  visual changes rather than accepting the new images blind.

### 6. Phase 9 — documentation, hardening, deployment

Replace the migration wording in `AGENTS.md` with steady-state rules, review OpenAPI and the Foldkit
Model for accidental secret or internal fields, and inspect both bundles for Node-only dependencies,
duplicate Effect copies, both renderers, and development DevTools. Deploy only when explicitly
authorized.

## Known gaps in the Foldkit shell

The reader, the composer, the notes list, and the card pages are at parity. What is still missing:

- No settings modal, info screen, presence indicator, avatar, or upload flow. A club with no book
  has no way to add one from the Foldkit entry.
- The desktop split opens at React's default 62% and has no divider to drag; the expand-a-pane
  states (`split--expanded-left`/`right`) have no trigger.
- Sign-in is password-only. The email-code flow, passkey sign-in, and dev sign-in have no view.
- A posted note renders its images and its text as plain blocks — inline formatting, quotes, and
  references are still unrendered.
- Opening a book logs one epub.js `TypeError: ... reading 'displayOptions'` that does not stop the
  book from rendering. Unchased.

## Carried gaps

- `getAgentByName` is a hard-wired module import across six server files, so
  `src/tests/httpapi/workerSeam.test.ts` substitutes the `agents` module behind a documented
  `anti-slop/no-module-mocking` suppression. Replacing it with an injectable locator is a
  server-wide refactor, deliberately not bundled into the migration.
- The genuine-101 WebSocket CORS branch is proven only at middleware level; undici refuses to
  construct a status-101 `Response`, so it needs a live-worker test.

## Proven runtime constraints

Found by building against the runtime; these contradict what a reading of the plan alone would
suggest, and where they conflict, these win. The plan carries the full list, including the three
found while building the reader chrome (epub.js `display` must stay bound, Playwright WebKit cannot
put a `Blob` in IndexedDB, and the reader shell must supply its surface's height).

- `Mount.define` emits exactly one Message. Anything reporting ongoing state needs
  `Mount.defineStream`.
- **A Mount restarts on a new element, never on changed args.** Anything that must re-seed a Mount
  from the Model needs an explicit generation counter or identity in the element key — the PDF
  source, layout, and zoom all live in that key for exactly this reason.
- Managed Resources can only push Messages through `onAcquired`, `onReleased`, and
  `onAcquireError`. Everything else flows through a resource-owned queue drained by a Subscription
  gated on the connection identity — never on a boolean derived from the requirements.
- Scope release is deterministic but not ordered before the next acquire, so identity guards are
  required rather than optional. Both reader adapters clear their `live` handle only when the
  releasing session is still the current one.
- Rendering a Foldkit runtime under jsdom has three silent failure modes: the container must have an
  `id`, `embed` replaces the container instead of filling it, and `dispose()` tears the tree down.
- `test:foldkit` runs Node plus jsdom, which cannot render library content. These tests cover
  lifecycle, cancellation, teardown, and parsing — **not** rendering.
- HttpApi payload declarations dispatch on an **exact** content-type match and answer 415 on a miss,
  with no wildcard, which is why uploads are multipart with `asMultipartStream`.
- **A generated client decodes response headers, and the browser hides the forbidden ones.**
  `set-cookie` can be declared on a response, but only as an optional key, or every call to that
  endpoint fails to decode in a browser while succeeding everywhere else.
- A `groupRef` is `slug-publicId`, never a bare `publicId`: the server resolves it by taking the
  segment after the last `-`. Build one with `groupUrlName(group)`.
- A `<dialog>` needs `h.Open(true)`, or the UA stylesheet hides it and the route silently renders
  nothing the reader can see.
- **One message per input.** A message carrying a sibling field reads that field from the model its
  handler closed over, and writes a stale value back over it on the next edit.

## Working agreements

1. Read `AGENTS.md`, `CONTEXT.md`, `e2e/AGENTS.md`, and the canonical migration plan first.
2. Confirm `jj status`, review `jj diff`, and run the gates above before changing anything.
3. Keep the generated client on the existing 45-operation contract; do not add transport wrappers.
4. Every upload caller sends its file as the `UPLOAD_FILE_FIELD` part and must **never** set
   `Content-Type` itself; the browser has to generate the multipart boundary.
5. One `jj` change per slice, and report gate results honestly — including the Playwright
   flakiness — rather than rounding up.
