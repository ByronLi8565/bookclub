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
- Note composition runs through the Lexical Mount by paste, as React did.
- **Foldkit is the client.** React is deleted: `index.html` loads `src/client/foldkit/entry.ts`, and
  `react`, `react-dom`, `wouter`, `react-swipeable`, `@tanstack/react-hotkeys`, `@lexical/react`,
  `@vitejs/plugin-react` and the two `@types` packages are out of `package.json`. The client is
  349.59 kB gzip, against React's last 358.64 kB.
- **Routes are URLs.** `routes.ts` owns the table (`/` and `/clubs/:groupRef?invite=`), and every
  route change goes out as a URL and comes back through `onUrlChange` — the address bar and the
  Model cannot disagree. Deep links, reload, back and forward are covered in `foldkitApp.pw.ts`.
- `src/client/ui/` is gone. What Foldkit shared with React moved to `src/client/logic/reader/`,
  `logic/notes/`, `logic/visibility.ts`, and the stylesheets to `src/client/styles/`.

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

## Validation — 2026-08-20 (after cutover)

- `bun run check` passes (format, lint, typecheck).
- `bun run test` — 415 passed across 53 files, including the 18 parity comparisons.
- `bun run e2e` — 10 passed across 9 scenarios against a booted wrangler worker.
- `bun run build` — 349.59 kB gzip, against React's last 358.64 kB.
- `foldkitApp.pw.ts` — passes on Desktop Chrome at `/`, with a clean console, including the reload
  and back/forward assertions that only routing can satisfy.
- **Not run:** every WebKit project, and PWA/Capacitor builds. See the two notes in Phase 8.
- **The WebKit projects were not run.** See "Running the browser suite": they cannot start in a
  detached session. They passed 51/51 on 2026-08-18 and nothing since then touched the reader,
  gesture, or composer paths, but that is an inference and not a result.

Every defect in "What running the app turned up" slipped through the gates that existed at the time,
because they all live in the seam between the assembled client and a real server. `foldkitApp.pw.ts`
is that missing gate and now covers the whole journey — dev sign-in by code, sign out, sign in by
password, clubs, the club opening straight onto its book, the divider drag that expands a pane, and
each of the three header overlays — with an assertion at each stage that names the failure it
guards against.

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

  Confirmed under lldb on 2026-08-20, because "it just aborts" is not a diagnosis. The bundle is
  intact and is the right build (revision 2311, `browserVersion` 26.5 against macOS 26.5), and
  `DYLD_FRAMEWORK_PATH` does resolve to the bundled `WebKit.framework` — the abort is later, in
  process startup:

  ```
  frame #3: HIServices`___RegisterApplication_block_invoke + 12716
  frame #6: HIServices`_RegisterApplication + 164
  frame #12: AppKit`_NSInitializeAppContext + 52
  frame #14: AppKit`+[NSApplication sharedApplication] + 128
  frame #15: AppKit`NSApplicationMain + 384
  ```

  `--headless` does not avoid it: Playwright's macOS WebKit goes through `NSApplicationMain` either
  way, and even `--version` aborts. Rejoining the GUI session from inside the detached one is not
  possible either — `launchctl asuser` and `launchctl print gui/$UID` both answer `141: Reentrancy
  avoided`, and `sudo` reports the session has no passwd entry. Docker is not a way around it
  on this machine: the daemon is Docker Desktop, which needs the same GUI session to start.

So `PW_DETACHED_SESSION=1 bunx playwright test src/tests/playwright/foldkitApp.pw.ts` is what an
agent can verify by itself; the WebKit projects need the reader to run them.

Editing a source file and immediately running the suite flakes: the page can load while Vite is
mid-invalidation and render nothing, failing on the first assertion. Give the dev server a few
seconds to settle before re-running.

## Parity tests — how the migration is proven finished

`src/tests/parity/` renders the React component and the Foldkit view of the **same** surface into
jsdom and diffs their structure. A failure prints both trees, so it names the element that drifted.
`src/tests/parity/README.md` is the guide; `domSignature.ts` is the definition of "the same
interface" (tag, classes, and the attributes that change what a control is or how it is announced —
ids, keys, styles and values are a renderer's own business).

Covered today: the workspace header, the note panel (thread, empty, loading, unsynced, composing),
the info screen, the login modal (all four states), the settings modal (reader and account pages),
the presence modal (people and books pages), and the home card (signed out, club list, naming a
club). Both host compositions — the account page inside settings, the invite controls inside
presence — are compared as the host assembles them, not module by module.

Writing them found eight divergences that eyeballing had not, every one now fixed:

- an invented "Quote this passage" control, and quoted passages shown as chips, where React seeds
  the passage into the draft as a blockquote and keeps the highlight out of sight;
- an "Add image" file picker in the composer, where React uploads by paste only;
- a second presence indicator in the note panel's toolbar, left from before the workspace header
  existed;
- a panel-level sync status, where React marks the individual note;
- a panel-level error line, where React raises a toast;
- `aria-label`s on the panel, its list, the composer, and the club list that React does not have;
- a modal named by `aria-label` where React names it by `aria-labelledby` against its own heading;
- the club-name field always open, where React offers "create a new bookclub" first — which also
  meant no pending guard against a double submit and no inline name error.

A deliberate difference is written down at the call site as a `rewrite` that normalises both sides,
with a comment saying why. There is exactly one: React navigates by URL and uses `<a href>` where
Foldkit's route still lives in the Model and uses `<button>`. **When URL routing lands at cutover,
delete those rewrites — the tests should still pass.**

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

Restructuring the sign-in modal surfaced two more:

- **An extra element between `.app` and `.home` collapses the page.** `.app` is a column flex box
  of `100dvh` and `.home` claims `height: 100%`; a percentage height against an auto-height parent
  resolves to auto, so the card shrank to its contents and the whole screen shifted the moment the
  modal opened. React renders the modal as a *sibling* of `.home-card` inside `.home`, and so does
  Foldkit now. The jsdom test asserts `.app > .home > .home-card` and `.home > .modal-backdrop`;
  the browser test compares the card's bounding box before and after the modal opens.
- **Sign-in was password-only, which is the one way in the dev worker does not offer.** A dev
  worker signs a known email in outright from `/auth/start`; an account with no password had no
  path at all. The Foldkit modal now carries the whole React flow — see below.

### 3a. The sign-in flow, at parity

The Foldkit modal is now what React's is: an email step with an *optional* password, whose primary
action reads "send code" until a password is typed; a "use a passkey" button gated on
`passkeysSupported()`; a code step for what the server mailed; the `.modal-success` note that stays
up for a beat before the modal closes; and `.login-error` sentences under both forms.

Three things are shared rather than reimplemented, so the two clients cannot drift while both exist:

- `src/client/logic/auth/authMessages.ts` — the API-code-to-sentence table both modals read.
- `authClient.passkeyLogin` — the WebAuthn ceremony. `useSession` now calls it instead of carrying
  its own copy; the caller still owns what a returned session does next.
- `rememberSession` in `application.ts` stores the bearer token every login path returns, which the
  native app needs and the previous password-only Command dropped.

Signing out now returns to `Home` rather than `Login`: React leaves you on the clubs card as an
anonymous reader, not staring at the form you just left.

### 3b. The shell gaps, closed

Every item that stood on the gaps list is now built, and the shell is React's shape rather than an
approximation of it. What changed structurally:

- **Routes are React's two.** `Home` and `Club({ groupRef })`, nothing else. Signing in and the
  account are overlays over whichever page is showing, and **a club with a book *is* the workspace** —
  there is no catalog page in between, which is what React does. The `Login`, `AccountSettings` and
  `Reader` routes are gone, and with them the invented catalog.
- **One `Overlay` value** says which modal is up, where React keeps an `activeModal` per surface.
  Escape and a press outside `.modal-inner` close it, through a Subscription gated on one being
  open — snabbdom attaches real listeners, so React's `stopPropagation` on the modal body has no
  Foldkit equivalent.
- **The shell is React's `App`**: an offline banner, the page, and the toast viewport. The page owns
  its own full-screen chrome (`.app` for the workspace, `.home` for the card pages), so the shell
  adds none. Its root carries `.foldkit-root`, added to `base.css` beside `#root`, because the
  runtime replaces its mount point and the page needs a full-height ancestor.
- **Toasts are React's store as Model state** — several at once, each with a kind, a dwell time and
  an optional link — and each raises its own dismissal Command, so nothing can put one on screen and
  forget to take it off.
- **The desktop split has its divider.** Dragging it moves the share against the layout's own box
  through a pointer Subscription; past either shoulder it expands the other pane
  (`split--expanded-left`/`right`), and `Shift+Arrow` steps between those states. React keeps the
  reader out of pointer-move reconciliation by writing the pane's width imperatively; Foldkit's
  patch of one style attribute is cheap enough not to need that.
- **The reader bar is React's**: the book menu (switch, rename by double-click, add), page count with
  percentage, the fit-to-text button on a PDF, and `−` / size / `+`. The layout `<select>` is gone —
  page layout is a stored preference, and `d` writes that preference rather than reader-local state.
  Search is React's `.reader-search` row. `s` opens the book menu and `Mod+S` pushes the reading
  place, both of which React had and Foldkit did not.

Five modules were built to the same seam as `notes.ts` and `reader.ts` — own Model, own Messages,
own Commands, a view taking a context — and `application.ts` owns which one is on screen:

| Module | React counterpart |
| --- | --- |
| `settings.ts` | `SettingsModal` + `UserSettings` + `BackupControls` |
| `presence.ts` | `PresenceModal` and the header's presence indicator |
| `upload.ts` | `UploadModal` |
| `invite.ts` | `InviteModal` / `InviteControls` |
| `info.ts` | `InfoScreen` |

Shared rather than duplicated: `modal.ts` (React's `Modal`/`ModalPagerTabs` chrome plus the
dismissal streams), `noteBody.ts` (React's `NoteBodyView`, inline markup and all, now used by both
the notes panel and the info cards), `loading.ts` (React's `Loading`), and
`accountSectionView` in `application.ts` (React's `AccountSettings`, passed into the settings modal).

React composes one `InviteControls` into both the invite modal and the presence modal, and one
`BackupControls` into the presence modal. Foldkit does the same by composition: `invite.ts` owns the
invite state and `settings.ts` owns the backup state, and `presence.ts` takes both as rendered
children. This was not free — the first cut had three modules defining Messages with the same
`_tag`, which the host dispatches by tag guard, so they would have folded into each other's `update`.

**The notes panel is React's markup now.** It was the largest remaining unstyled surface: the panel,
the thread, the filter bar and the tag chips are `NotePanel`/`NoteThread`/`NoteFilterBar`'s own class
names, replies nest to React's `MAX_INDENT`, deleted notes render greyed instead of vanishing, and a
note body goes through `noteBody.ts` rather than rendering as plain blocks.

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

### 5. Phase 8 cutover — done, on the `foldkit-cutover` branch

Three commits, in this order deliberately:

1. **Route by URL, while React was still there to compare against.** Wiring routing changed the club
   list and the topbar back into `<a href>` — which is what React renders — so the parity suite went
   from one recorded deviation to none. Landing routing *before* the deletion is what let the suite
   prove it.
2. **Remove the React client** and make `index.html` the Foldkit entry.
3. **Move the shared modules** out of the emptied `ui/` tree.

What is still outstanding from this phase:

- **PWA, Capacitor iOS and Android builds are unverified.** `bun run build` passes and the service
  worker is generated, but no device or simulator build has been run against the Foldkit entry.
- `src/client/logic/net/api.ts` (`apiFetch`) survives: presence and account still call it. Folding
  the rest into `bookclubClient` is worth doing but is not cutover work.
- **The five `e2e/browser/*.pw.ts` suites have not been run** against the Foldkit client. They
  navigate by URL, which now works, and the markup they select is the markup the parity signatures
  pin — so they are expected to pass, but WebKit cannot start in a detached session and expectation
  is not evidence. **Run them first.**

### 6. Phase 9 — documentation, hardening, deployment

Replace the migration wording in `AGENTS.md` with steady-state rules, review OpenAPI and the Foldkit
Model for accidental secret or internal fields, and inspect both bundles for Node-only dependencies,
duplicate Effect copies, both renderers, and development DevTools. Deploy only when explicitly
authorized.

## Known gaps in the Foldkit shell

Every item that was on this list is built, URL routing included. What is left is a set of small
deliberate deviations, each recorded where it was made.

**Deliberate deviations, all small:**

- The upload modal's inspection progress bar stays at 0%. `Command.define` emits exactly one
  Message, so `inspectSource`'s `onProgress` has nowhere to go without a queue and a Subscription;
  the Model field and the message exist, nothing feeds them.
- No local object-URL preview of a picked avatar, and no client-side image compression before
  upload (the note-image upload already skipped compression).
- A downloaded backup is named `notes.bookclub`: the generated client does not expose
  `Content-Disposition`, so React's server-supplied filename is replaced by its own fallback.
- The book-menu and settings dropdowns have no ArrowUp/ArrowDown roving focus, and the modal pager
  has no Left/Right paging. All three are `useHotkey` behaviours that belong in Subscriptions.
- Choosing the same file twice in a row fires no second change: React clears `event.target.value`
  after a pick and `OnFileChange` has no equivalent.
- The presence modal's book metadata editor has no word-count refresh (it downloads the whole book
  and re-inspects it, which belongs to the reader's source slice).

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
- **Two modules must not define the same Message `_tag`.** The host dispatches by schema guard, so
  identical tags in two slices fold into whichever guard runs first. Where React shares a component
  between two surfaces, share the module and compose its rendered output — do not reimplement it.
- **A Foldkit view cannot stop propagation.** snabbdom attaches real listeners and events bubble, so
  React's "press inside the modal body does not reach the backdrop" has to be a document-level
  Subscription gated on the modal being open.
- **`Book.destroy()` in epub.js drops the deferred map its own `unpack` still resolves against.**
  Destroying a book while the display-options fetch is in flight throws inside the library; the
  teardown waits for the open to settle first.
- **A view may not wrap a page in an extra element.** `.app`/`.home` and the reader's split both
  size through direct-child relationships, so a wrapper div silently collapses the layout. Overlays
  go in as siblings — `homeView` takes an `overlay` argument for this.
- `client.auth.start` decodes to `void | { body, headers }`: the dev worker's outright sign-in and
  the real worker's 204 share one endpoint, and `result === undefined` is what tells them apart.

## Working agreements

1. Read `AGENTS.md`, `CONTEXT.md`, `e2e/AGENTS.md`, and the canonical migration plan first.
2. Confirm `jj status`, review `jj diff`, and run the gates above before changing anything.
3. Keep the generated client on the existing 45-operation contract; do not add transport wrappers.
4. Every upload caller sends its file as the `UPLOAD_FILE_FIELD` part and must **never** set
   `Content-Type` itself; the browser has to generate the multipart boundary.
5. One `jj` change per slice, and report gate results honestly — including the Playwright
   flakiness — rather than rounding up.
