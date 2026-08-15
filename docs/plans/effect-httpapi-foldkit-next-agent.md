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
  payload on the contract and run through the generated client. See the plan's "Upload contract
  record". No raw-body upload path remains.
- **The Foldkit client is split by concern**: `application.ts` (session, account, groups, routing),
  `reader.ts`, `notes.ts`. `update` dispatches to the reader and notes slices by schema guard.
- Note composition runs through the Lexical Mount, including image paste and a file picker; both
  reach one `UploadNoteImage` Command.
- The reader's live text selection reaches the composer ("Quote this passage").
- **React is still the production client.** The Foldkit entry stays out of the production bundle.

## Validation — 2026-08-17

Run on `jj` change `syoypktp`:

- `bun run check` passes (format, lint, typecheck).
- `bun run test` — 274 passed across 46 files.
- `bun run test:foldkit` — 66 passed across 9 files.
- `bun run e2e` — 10 passed across 9 scenarios against a booted wrangler worker, including all four
  upload scenarios.
- `bun run build` passes; the React client is 358.83 kB gzip, so Foldkit stays out of it.
- `bun run test:e2e` (Playwright) — 27/29. See "Known flakiness" before treating this as red.

## Known flakiness — read before debugging

Desktop Safari fails **one or two tests per full run, a different pair each time**, and every one of
them passes in isolation in a couple of seconds. Observed across four full runs; one run was 29/29
with no code change between. This is WebKit under full-suite load, not a regression. Re-run the
named tests in isolation before investigating:

```
bun run test:e2e -- --project="Desktop Safari" -g "<test name>"
```

If a *specific* test fails in isolation, that is a real failure and is worth chasing.

## Remaining plan

### 1. Reader chrome (Phase 5 items 5-7) — the largest piece

`readerView` is a functional skeleton. The EPUB and PDF Mounts render and publish position,
selection, and search events, but the surrounding behavior is unbuilt:

- highlight painting and erasing
- search-highlight painting
- live spread change with annotation repaint
- pagination measurement
- keyboard and swipe Subscriptions replacing the React hotkey and swipe libraries

Plan item 7 is explicit that the Subscriptions come **after** the existing keyboard, touch,
reduced-motion, and accessibility behavior is captured in browser tests. Do that first — those
behaviors are currently pinned only for the React reader, and those tests are what make the Foldkit
version checkable.

jsdom cannot render either library (see "Proven runtime constraints"), so this work is verified in
Playwright, not in `test:foldkit`.

### 2. `NoteImageNode` interactive UI (Phase 6 item 7) — needs a decision, not code

Static rendering and markdown round-tripping already work: the node renders read-only through
`createDOM`, so pasted images display and survive a round trip. What has no Foldkit equivalent is
the interactive resize / remove / retry UI, which in React is rendered inside `decorate()`.

The plan records this as a **candidate stop condition**, not a deferral. Decide it deliberately:
reproduce it through `createDOM`/`updateDOM` plus domain Messages, or accept the parity loss and
record that. Do not let it lapse into an unmentioned gap.

### 3. Phase 8 cutover — delete React

In plan order: run the browser suite against both entries on the same user-meaningful scenarios and
fix parity in Foldkit; make Foldkit the production entry and verify PWA, Capacitor iOS, and Android
builds *before* deleting anything; then delete React components, hooks, harnesses, and the
React-only dependencies once `rg` shows no runtime callers.

Two specifics worth planning for:

- `src/client/logic/net/api.ts` (`apiFetch`) can now be deleted outright. It survives only for React
  callers; `bookclubClient` already reproduces everything it does (native origin, bearer token), and
  uploads no longer need it.
- `src/tests/playwright/visual.pw.ts` snapshots are taken against the React DOM and will not survive
  cutover. Re-baseline **after** the parity scenarios pass, and diff old against new for unintended
  visual changes rather than accepting the new images blind.

### 4. Phase 9 — documentation, hardening, deployment

Replace the migration wording in `AGENTS.md` with steady-state rules, review OpenAPI and the Foldkit
Model for accidental secret or internal fields, and inspect both bundles for Node-only dependencies,
duplicate Effect copies, both renderers, and development DevTools. Deploy only when explicitly
authorized.

## Carried gaps

- `getAgentByName` is a hard-wired module import across six server files, so
  `src/tests/httpapi/workerSeam.test.ts` substitutes the `agents` module behind a documented
  `anti-slop/no-module-mocking` suppression. Replacing it with an injectable locator is a
  server-wide refactor, deliberately not bundled into the migration.
- The genuine-101 WebSocket CORS branch is proven only at middleware level; undici refuses to
  construct a status-101 `Response`, so it needs a live-worker test.
- `jj` history is mixed. Change `spmlmwxr` absorbed the Lexical/EPUB/NoteAgent/CORS adapters, and
  `syoypktp` now carries the PDF Mount, the client slice split, the composer, the upload contract
  change, and image paste — five slices under a description that names only the first. This is
  against the plan's one-slice-per-change rule. Nothing is pushed (`main@origin` is behind), so
  `jj split` is still safe and is the recommended first act of the next session.

## Proven runtime constraints

Found by building against the runtime; these contradict what a reading of the plan alone would
suggest, and where they conflict, these win. The plan carries the full list.

- `Mount.define` emits exactly one Message. Anything reporting ongoing state needs
  `Mount.defineStream`.
- **A Mount restarts on a new element, never on changed args.** `OnMount` starts its stream on
  snabbdom `insert` and interrupts on `destroy`. Anything that must re-seed a Mount from the Model
  needs an explicit generation counter in the element key — see `NotesModel.composerGeneration`.
- Managed Resources can only push Messages through `onAcquired`, `onReleased`, and `onAcquireError`.
  Everything else flows through a resource-owned queue drained by a Subscription gated on the
  connection identity — never on a boolean derived from the requirements.
- Scope release is deterministic but not ordered before the next acquire, so identity guards are
  required rather than optional.
- Rendering a Foldkit runtime under jsdom has three silent failure modes: the container must have an
  `id`, `embed` replaces the container instead of filling it, and `dispose()` tears the tree down.
  All three render nothing, with no error.
- `test:foldkit` runs Node plus jsdom, which cannot render library content. epub.js `display()`
  never settles and PDF.js has no canvas backend. These tests cover lifecycle, cancellation,
  teardown, and parsing — **not** rendering. Do not read them as browser coverage.
- HttpApi payload declarations dispatch on an **exact** content-type match and answer 415 on a miss,
  with no wildcard. Endpoints whose media type the caller chooses cannot take a byte payload; that
  is why uploads are multipart. Buffered multipart needs `FileSystem`/`Path` services a Worker
  cannot provide — use `asMultipartStream`.

## Working agreements

1. Read `AGENTS.md`, `CONTEXT.md`, `e2e/AGENTS.md`, and the canonical migration plan first.
2. Confirm `jj status`, review `jj diff`, and run the gates above before changing anything.
3. Keep the generated client on the existing 45-operation contract; do not add transport wrappers.
   Uploads have multipart payloads on that same contract — they are not an exception.
4. Every upload caller sends its file as the `UPLOAD_FILE_FIELD` part and must **never** set
   `Content-Type` itself; the browser has to generate the multipart boundary.
5. Report gate results honestly, including the Playwright flakiness, rather than rounding up.
