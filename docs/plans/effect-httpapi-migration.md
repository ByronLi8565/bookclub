# Effect HttpApi and Foldkit migration handoff

Status: Server Phases 1-7 implemented; Foldkit/client migration remains in progress  
Owner: next agent assigned to the migration  
Last reviewed: 2026-08-15

## Decision

Bookclub is committing its structured HTTP interface to Effect v4 `HttpApi`. The shared
`HttpApi` declaration will be the authoritative interface for request decoding, success values,
expected failures, generated clients, and OpenAPI output.

Bookclub is also replacing the React SPA with Foldkit. The target client is one Foldkit application
whose Schema model, Messages, update functions, Commands, Subscriptions, Managed Resources, and
Mounts make client state and resource lifetimes explicit. React remains only as the production
behavioral reference while the Foldkit application reaches parity; do not deepen React architecture
or build durable Promise adapters for code that Foldkit will replace.

Do not preserve or extend the intermediate `WorkflowResult` / `workflowResponse` design. Expected
failures stay in the `Effect` error channel until `HttpApi` encodes them. Do not pattern-match an
already-settled `{ ok, value }` union in a route.

Upgrade Effect from `4.0.0-beta.83` to `4.0.0-rc.108` before implementing HttpApi. Foldkit
`0.145.0` and `@foldkit/vite-plugin` `0.13.1` require that exact Effect version. Pin all three so a
dependency update cannot silently change both the client runtime and the unstable server APIs.
The project accepts the migration cost of using `effect/unstable/httpapi` and
`effect/unstable/http`.

Those three pins hold for the whole migration. Effect is at an RC and Foldkit is pre-1.0, so both
will move underneath a migration this long; bumping either is its own `jj` change with its own
gate — typecheck, unit, live-worker, and browser suites — and is never folded into a migration
phase. A phase that appears to need a newer Foldkit or Effect has found a stop condition, not a
dependency bump.

Use Effect for the complete fetch path. `HttpApiBuilder.layer` installs the structured contract in
`HttpRouter`; raw router handlers cover the Agents SDK and asset fallbacks; a small Effect
middleware preserves native CORS; `HttpRouter.toWebHandler` supplies the Web `Request` adapter.
Hono is therefore redundant and must be removed. Cloudflare's required exported `fetch` and
`scheduled` callbacks are platform entrypoints, not an application routing layer.

## Outcome

The migration is complete when:

- All 45 structured HTTP routes are declared once in a shared `HttpApi` contract.
- Payloads, path parameters, query parameters, headers, successes, and expected failures are
  schema-decoded and schema-encoded by `HttpApi`.
- Server handlers return `Effect` values directly; no workflow returns a Promise-wrapped result
  union.
- The SPA and native app call generated clients through one client adapter.
- The generated client remains Effect-native; Foldkit Commands use it without Promise/result
  wrappers.
- One Foldkit application replaces the React component tree, hooks, and Wouter routing.
- Lexical, epub.js, and PDF.js are owned through lifecycle-scoped Mounts, while NoteAgent and other
  long-lived browser connections are Managed Resources.
- Authentication and admin authorization are `HttpApiMiddleware` modules that provide typed
  request context.
- One Effect `HttpRouter` owns structured HTTP, native CORS, Agent routing, NoteAgent WebSocket
  gating, and the SPA asset fallback.
- Scheduled backups run as an Effect from the Cloudflare `scheduled` entrypoint.
- Hono, legacy route registration, `readJson`, duplicated response schemas, and obsolete client
  parsing are deleted.
- React, React DOM, Wouter, React-only libraries, and the temporary dual-runtime entry are deleted.
- Unit, contract, live-worker E2E, and browser suites pass.

## Architectural intent

The shared HTTP contract is a deep module. Its interface exposes each user-meaningful operation
once; its implementation supplies decoding, encoding, documented failure modes, generated client
types, OpenAPI metadata, and handler compatibility. This gives callers leverage and keeps transport
knowledge local.

The seams after migration are:

```text
Cloudflare Worker fetch ── HttpRouter.toWebHandler
├── native CORS middleware
├── structured HTTP paths ── HttpApi contract routes
│   ├── authentication middleware
│   ├── admin middleware
│   ├── Account Profile handlers
│   ├── Group Control Plane handlers
│   └── Group Data Plane handlers
├── /agents/note-agent/* ── authenticated agents SDK adapter
├── other agents SDK paths ── routeAgentRequest
└── everything else ── ASSETS adapter with hashed-asset 404 protection

Foldkit application ── generated HttpApi client
├── web ── same-origin FetchHttpClient with cookies
├── native ── deployed origin plus bearer token
├── Commands ── finite HTTP, persistence, and platform effects
├── Subscriptions ── browser events derived from Model requirements
├── Managed Resources ── NoteAgent and other long-lived handles
└── Mounts ── Lexical, epub.js, PDF.js, and imperative DOM ownership
```

Do not create repository interfaces around Durable Object or R2 bindings before two adapters
actually exist. Initially provide the concrete Cloudflare environment through one request-scoped
Effect context module. Existing Durable Object methods remain the interface exercised by handlers
and tests.

The router is ordered so typed HttpApi routes and the authenticated NoteAgent routes win before the
generic Agents SDK and asset fallbacks. Do not add another dispatcher around it.

## Current implementation inventory

All 45 structured routes are declared in `src/shared/http/BookclubHttp.ts` and implemented by
typed Effect handlers:

| Contract group                           | Count | Handler files                                                              |
| ---------------------------------------- | ----: | -------------------------------------------------------------------------- |
| Public authentication and session        |     7 | `src/server/http/authHandlers.ts`                                          |
| Protected account and profile            |    12 | `src/server/http/accountHandlers.ts`, `src/server/http/authHandlers.ts`    |
| Public avatar                            |     1 | `src/server/http/accountHandlers.ts`                                       |
| Group Control Plane and Group Data Plane |    21 | `src/server/http/groupHandlers.ts`, `src/server/http/groupDataHandlers.ts` |
| Administration                           |     4 | `src/server/http/adminHandlers.ts`, `src/server/backup.ts`                 |

Non-HttpApi Worker paths are raw Effect `HttpRouter` handlers in `src/server/http/live.ts`:

- `/agents/note-agent/:groupId/*` gates the NoteAgent
  WebSocket through current Group Control Plane membership.
- The generic `routeAgentRequest` fallback belongs to the `agents` SDK.
- The `ASSETS` fallback serves the SPA and forces missing hashed assets to return 404.
- The scheduled handler runs periodic backups through `ExecutionContext.waitUntil`.

Hono, legacy route modules, `src/server/http.ts`, and `src/server/workflows/` are deleted. The Worker
`fetch` export delegates directly to `HttpRouter.toWebHandler`; scheduled backup runs one Effect at
the platform entrypoint.

The current client has 32 TSX files and 42 modules importing React. Its main migration seams are:

- `App.tsx`, `Home.tsx`, and `GroupView.tsx` own routing, session state, and group loading.
- `Workspace.tsx` and the workspace hooks coordinate responsive panes, chrome, modals, hotkeys,
  reader state, notes, presence, and offline synchronization.
- `useEpubSourceView.ts` and `usePdfSourceView.ts` own imperative reader engines and DOM resources.
- `NoteEditor.tsx` owns Lexical through React bindings.
- `useNoteAgent.ts` owns the Agents SDK connection, offline `NoteStore`, retry, and presence through
  hooks and refs.

## Foldkit compatibility spike

The 2026-08-15 spike ran in an isolated `jj` workspace based on this working copy. It established:

- Effect `4.0.0-rc.108`, Foldkit `0.145.0`, and `@foldkit/vite-plugin` `0.13.1` install together.
- The Effect upgrade required four `Schema.TaggedErrorClass` to `Schema.TaggedError` changes and one
  bounded retry update to `Schedule.upTo`; the rest of the application typechecked unchanged.
- A real Foldkit runtime embedded under React and mounted Lexical, epub.js with `dorian.epub`, and
  PDF.js with `moby-dick.pdf`. All three acquired and released their live resources through
  Foldkit Mount scopes.
- A Foldkit Managed Resource constructed the non-React `AgentClient`, authenticated to a real group
  NoteAgent, awaited the identity handshake, and released the connection by closing its scope.
- `bun run typecheck`, all 184 unit tests, the Cloudflare/Vite production build, and a focused WebKit
  browser test passed.
- A Foldkit runtime container needs a stable DOM `id`; without one, HMR model preservation rejects
  runtime startup. Treat the id as part of every embedded-runtime boundary.
- Shipping React and Foldkit synchronously in one entry increased the main client bundle from
  356.12 kB to 414.28 kB gzip in the spike. The migration must keep the parallel Foldkit entry out
  of the production main bundle and delete React at cutover rather than shipping both indefinitely.

Decision: proceed with Foldkit. The spike proved the risky library and lifecycle seams. It is not
production code and should not be copied wholesale; carry forward the resource ownership patterns
and the focused browser scenario.

## Target source layout

Use this as a locality guide, not a mandate to create empty files early:

```text
src/shared/http/
  BookclubHttp.ts        # composed HttpApi
  errors.ts              # shared tagged failures and status annotations
  auth.ts                # /auth contract
  accounts.ts            # /me and /users contract
  groups.ts              # /groups contract
  admin.ts               # /admin contract

src/server/http/
  live.ts                # one HttpRouter layer and toWebHandler adapter
  cloudflare.ts          # request-scoped Env context
  authentication.ts      # session middleware adapter
  administration.ts      # admin middleware adapter
  authHandlers.ts
  accountHandlers.ts
  groupHandlers.ts
  adminHandlers.ts

src/client/logic/net/
  bookclubClient.ts      # generated-client adapter for web and native

src/client/foldkit/
  application.ts         # runtime, top-level Model, Message, update, view
  route.ts               # typed routes and URL conversion
  commands/              # finite generated-client, persistence, and platform effects
  resources/             # NoteAgent and other model-driven long-lived resources
  mounts/                # Lexical, EPUB, and PDF imperative adapters
  home/                   # home/account submodel
  group/                  # group management submodel
  workspace/              # reader and notes composition
  shared/                 # Foldkit-native UI shared by two or more submodels
```

Keep shared schemas in their current domain modules when they already exist. The HTTP declaration
should import `GroupSummary`, `UserPrefs`, `StoredReadingPosition`, `PasskeyInfo`, and other domain
schemas instead of copying them into `src/shared/http`.

## Contract rules

### Request and success schemas

- Every payload, path, query, and header value is decoded before a handler runs.
- Replace non-schema transport types such as `BookMetadataPatch` with schemas in the owning shared
  domain module.
- Preserve current HTTP methods, paths, success statuses, content types, and JSON envelope shapes
  unless a separately reviewed change intentionally breaks compatibility.
- Use `HttpApiSchema.NoContent` or an explicitly annotated empty schema for 204 responses.
- Use `HttpApiSchema.asUint8Array` for buffered binary bodies and
  `HttpApiSchema.StreamUint8Array` for R2-backed downloads when streaming is supported by workerd.
- Use `HttpApiBuilder.handleRaw` only when a handler must read a raw upload body or preserve a
  streaming response. A handler may return a raw `HttpServerResponse` only for response behavior
  the contract cannot encode, such as a dynamic content type or download filename. Record every
  exception here and test its bytes, status, and headers because it bypasses success encoding.
- Do not reproduce SimpleWebAuthn's large vendor-owned credential schemas. Decode the small
  Bookclub envelope (`response` and optional `label`), then let the installed verifier validate the
  credential at one typed adapter seam.
- `POST /auth/start` declares both current successes: production 204 and development 200 with its
  session payload and cookie. A single endpoint declaring two success statuses is the one contract
  shape this plan asserts without proof; prove it in the Phase 0 spikes before Phase 3 depends on
  it. If a status-annotated success union does not encode cleanly, the accepted fallbacks are
  `HttpApiBuilder.handleRaw` recorded as an escape hatch, or a development-only 204-with-empty-body
  normalization — chosen only after checking every `/auth/start` caller in `src/client` and `e2e`.
  Whichever shape wins, the development 200 branch must not leak into the production contract or
  generated OpenAPI; assert its absence.
- Keep `rotate=1` as the invite-link query contract; do not normalize it to a new boolean wire form.
- Name `/groups/:groupId` path parameters `groupRef` in declarations and handlers where they carry
  the public `slug-publicId` reference. Preserve the URL itself and use internal `groupId` only
  after resolution.

### Expected failures

- Define shared expected failures with `Schema.TaggedError` and
  `HttpApiSchema.annotations({ status })` in `src/shared/http/errors.ts`. There must be one wire-code
  vocabulary, not two: the tagged classes carry codes drawn from the existing
  `src/shared/types/errors.ts` union (including `GroupFailureReason`), whether that module is kept
  and imported or folded into `src/shared/http/errors.ts`. Do not let a second, drifting list of
  literal error strings appear alongside it.
- Declare each possible expected failure with `.addError(...)` on the endpoint or group.
- Yield tagged failures directly from handlers and Effect helpers. Use `Effect.catchTag` or
  `Effect.catchTags` only
  when a module genuinely recovers or translates a lower-level failure.
- Preserve the existing `error` and optional `reason` JSON fields for installed native clients.
  An added `_tag` field is acceptable only after a compatibility test proves old clients ignore it.
- HttpApi's own built-in failures must be re-encoded to that same envelope. A schema decode failure
  emits `HttpApiDecodeError` with an `issues` array, an unmatched route emits the router's default
  404, and an unhandled defect emits the default 500 — none of which carry an `error` field.
  `src/client/http.ts` `parseHttpError` reads `body.error` and degrades to `http_<status>`, and
  `Login.tsx` maps the literal codes `invalid_email` and `invalid_request` to user-visible copy. So
  a decode failure that today returns `{ "error": "invalid_email" }` would silently become generic
  copy. Install one API-level error encoding shim that maps decode failures, unmatched routes, and
  defects onto `{ error, reason? }`, and cover it with a test per affected endpoint.
- Because HttpApi decoding replaces hand-written validation branches, every endpoint whose current
  400 carries a specific code (`invalid_email`, `invalid_request`, `missing_key`, and the rest) needs
  that code chosen deliberately — either by annotating the endpoint's decode failure with it or by
  keeping a narrow pre-decode check. Record the choice per endpoint in the compatibility fixture
  table below.
- Start with nine status-tagged classes: `BadRequest`, `Unauthenticated`, `Forbidden`, `NotFound`,
  `Conflict`, `PayloadTooLarge`, `RateLimited`, `InternalError`, and `ServiceUnavailable`. Each
  carries the existing narrow `error` code and optional `reason`. This keeps failures matchable in
  Effect without creating a class for every wire string or accepting an arbitrary numeric status.
- Map rejected Durable Object, R2, email, asset, and Agents SDK calls to a typed infrastructure
  failure where each call crosses its I/O boundary. Log the cause there and expose only the shared
  `InternalError`. The router's defect handler is a last resort, not the normal error-mapping seam.

Initial status families to model are 400, 401, 403, 404, 409, 413, 429, 500, and 503. Confirm the
full code/status matrix from current routes and workflows before deleting their branches.

The code/status matrix is a Phase 1 deliverable, not a per-phase improvisation: a checked-in fixture
table of every current `(method, path, condition) -> (status, error, reason?)` triple, derived by
reading the routes and workflows, and asserted by a test. Phase 2 already deletes four exact routes,
so the table must exist before that deletion.

### Parse at I/O boundaries

- Treat HTTP payloads, parameters, queries, headers, cookies, and environment configuration as
  unknown input. Parse them once with Schema at the HttpApi or configuration boundary.
- Put normalization, refinement, branding, and cross-field structure checks in that parse. Handlers
  and domain functions accept the parsed type and must not repeat `typeof`, shape, length, or format
  checks.
- Durable Object, R2, email, and Agents SDK calls are I/O boundaries. Convert rejection/exception
  channels to typed Effect failures where each call enters the application. Translate a remote
  result union once at that same seam.
- Stateful facts are not input validation. Membership, authorization, existence, uniqueness, and
  current-version checks remain in the module that owns that state.
- Parse structural values again when they re-enter from Durable Objects, R2, email providers, or
  persisted archives. Opaque platform values such as an R2 body stream stay opaque; check only the
  metadata the application consumes.

### No Workflow abstraction

The current Workflow layer is a temporary half-conversion: it builds an Effect, immediately runs it
to a Promise, collapses its error channel into `{ ok, value }`, and makes the route unpack it again.
It also carries raw `Request`, `Env`, and `unknown` payloads past their I/O boundaries. It adds no
domain semantics.

Delete that abstraction. An HttpApi handler is already an Effect. It may call ordinary local helper
functions returning `Effect.Effect<Success, DeclaredError, Requirements>`. Keep orchestration next
to the handler unless it has a second caller; do not replace `workflows/` with an `operations/`
mirror. Use `Effect.fn("Domain.operation")` only when a named reusable function improves tracing or
composition.

`Effect.runPromise` belongs only in platform entrypoints, test adapters, and non-Effect framework
callbacks. The fetch path normally uses `HttpRouter.toWebHandler`; the scheduled entrypoint runs one
Effect under `ExecutionContext.waitUntil`. Delete `runWorkflow`, `WorkflowResult`, `WorkflowFailure`,
`WorkflowFailureError`, `workflowResponse`, and `fail` after their callers migrate.

### Cloudflare environment

- Provide the current `Env` as a request-scoped `Context.Tag` to the generated web handler.
- Provide `ExecutionContext` separately only for handlers that need `waitUntil`.
- Do not construct a global runtime that captures one request's `Env`.
- The adapter must work under `@cloudflare/vite-plugin`, `wrangler dev`, and deployed workerd.
- Create the web handler and reusable Layers once at module scope; supply request-specific context
  for every invocation.

### Authentication and authorization

- Authentication middleware accepts the existing web session cookie or native bearer token and
  provides `CurrentIdentity`.
- Query-string session tokens remain supported only by the NoteAgent WebSocket gate; structured
  HTTP routes must not accept them.
- Public authentication endpoints do not require the middleware.
- Protected `/me`, `/users`, and `/groups` operations declare authentication at the group or
  endpoint level.
- Standardize protected endpoints on authentication before payload decoding. A malformed request
  without valid credentials therefore returns 401. Record this intentional precedence change for
  the few current routes that decode first.
- Group Data Plane authorization continues to consult the current Group Control Plane role. Do not
  authorize from note presence or another projection.
- Admin middleware preserves both authorization modes: `ADMIN_API_TOKEN` bearer access and
  `ADMIN_EMAIL` session access. Admin routes are the documented exception to the 401 precedence
  above: every current failure mode — absent credentials, wrong bearer token, non-admin session,
  unset `ADMIN_EMAIL` — returns **403 `forbidden`**, never 401. `scripts/predeploy-backup.ts`
  depends on this, so the middleware's failure must be declared as `Forbidden`.
- Session and passkey challenge cookies use Effect HTTP cookie helpers or pre-response handlers,
  including the two `Set-Cookie` headers emitted by passkey login verification.

### Native CORS

Preserve the exact native-origin policy for `capacitor://localhost`, `https://localhost`, and
`http://localhost`. Allowed native responses include the origin and `Vary: Origin`; allowed
preflight requests return 204 with the current method/header/max-age policy. Web requests remain
same-origin and must not receive permissive credential headers. Implement this as Effect HTTP
middleware. The built-in `HttpRouter.cors` answers every OPTIONS request, whereas Bookclub currently
short-circuits only allowed native origins, so use a small predicate middleware unless a focused
compatibility test proves the built-in behavior equivalent.

Exactly one CORS implementation is active at any commit. Phases 1 through 6 run migrated handlers
_underneath_ the existing Hono `app.use("*")` middleware, so Hono keeps owning CORS for the whole
migration and the Effect sub-handler must return responses whose headers Hono can still mutate. The
Effect middleware arrives in Phase 7, and the Hono middleware is deleted in that same change —
never a commit where both run, which would emit duplicate `Access-Control-Allow-Origin` and a
doubled `Vary: Origin`.

Two details the current Hono middleware gets by accident and the Effect middleware must get on
purpose:

- The middleware wraps every path, including `/agents/note-agent/*`. A native WebSocket upgrade from
  `capacitor://localhost` produces a 101 response whose headers are immutable in workerd, so the
  middleware must pass responses carrying a `webSocket` or a 101 status through untouched rather
  than mutating them. Cover this with a native-origin WebSocket test, not only an HTTP one.
- `Vary` is appended, not set. Any response that already carries a `Vary` must keep its existing
  value alongside `Origin`.

`src/server/http/nativeCors.ts` implements this and is covered by `src/tests/httpapi/nativeCors.test.ts`.
Hono is gone, so this is now the single active CORS owner: `live.ts` applies it as
`NativeCorsLayer` (a `global` `HttpRouter.middleware`), and `e2e/scenarios/http-protocol.test.ts`
proves the preflight contract against a real booted worker.

One coverage gap survives: undici refuses to construct a status-101 `Response`, so the genuine-101
branch is proven only at middleware level and never through `toWebHandler`. A live-worker test
against a real native-origin WebSocket upgrade still owes this — the HTTP preflight scenario does
not cover it.

### Generated client adapter

- Generate the client from `BookclubHttp` with `HttpApiClient.make`.
- The adapter selects the empty same-origin base URL for web and
  `https://bookclub.byron.land` for native.
- The native adapter loads the Capacitor preference token and adds `Authorization: Bearer` before
  a request. Session responses continue storing or clearing that token.
- Keep the adapter Effect-native. Foldkit Commands yield the generated client Effect and translate
  declared transport failures once into domain Messages.
- Existing React callers may receive a temporary `Effect.runPromise` compatibility function while
  they remain the production reference. Keep that function in one file, add no React-facing result
  abstraction, and delete it at Foldkit cutover.
- Replace manual URL construction, `JSON.stringify`, response decoding, and duplicate response
  schemas only when the corresponding Foldkit slice replaces its React caller. Do not churn a
  React caller into the generated client shortly before deleting that caller. Keep client-side image
  compression and `File` construction outside the generated client.
- Use `responseMode: "response-only"` or `"decoded-and-response"` for the few operations whose
  callers need dynamic response headers. Direct image `src` URLs and NoteAgent WebSocket URLs stay
  manual.

### Foldkit client rules

- The top-level Model contains serializable product state, not live engines, DOM nodes, open files,
  sockets, fibers, or callbacks. Opaque handles belong in Mounts, Managed Resources, or Layers.
- Messages describe user or external facts. Commands describe finite effects and return Messages;
  expected failures also return domain Messages rather than disappearing through `Effect.ignore`.
- Use a Submodel when a child owns meaningful state and behavior. Do not reproduce the React file
  tree as one Submodel per component.
- Use Mounts for DOM-bound libraries. Construct the handle inside `Effect.acquireRelease`, register
  cleanup immediately, and publish only domain events back into the Message loop.
- `Mount.define` emits exactly one Message. Any Mount reporting ongoing state — location, page
  rendered, selection, load failure — must use `Mount.defineStream` with `Stream.callback` and
  `Queue.offerUnsafe`. A Mount built on `define` that publishes repeatedly silently delivers only
  its first event.
- Lexical uses the core `lexical` package, not `@lexical/react`. The editor state remains inside the
  editor; the Model carries the note draft/domain representation the application consumes.
- epub.js and PDF.js retain their existing parsing, pagination, anchoring, search, and rendering
  helpers where those helpers are renderer-independent. Mount adapters own live Book, Rendition,
  PDF document, page render tasks, canvases, and listeners.
- NoteAgent uses `AgentClient` from `agents/client` as a Managed Resource keyed by the authenticated
  group and session mode. Register close as a scope finalizer before awaiting the identity handshake.
- A Managed Resource can only push Messages through `onAcquired`, `onReleased`, and
  `onAcquireError`. Ongoing callbacks — presence, connection state, note updates, rejected
  operations — must flow through a resource-owned queue drained by a Subscription. Gate that
  Subscription on the _connection identity_ (null until acquired, changing with the resource key),
  never on a boolean derived from the requirements: a boolean gate starts the stream before
  acquisition, never restarts, and silently loses every event.
- IndexedDB and Capacitor Preferences are Effects invoked by Commands or provided services. Parse
  persisted unknown values once on read with the existing Schemas.
- Foldkit owns routing after cutover. Preserve `/` and `/clubs/:groupRef`; do not change public URLs
  as part of the framework migration.
- Every embedded runtime container has a stable unique `id`. The production target is one
  page-owning runtime, so embedding is migration scaffolding only.
- Keep the existing CSS and accessible DOM behavior initially. Visual redesign and component-kit
  adoption are separate changes.
- Put Foldkit model/update, Command, Mount, and Managed Resource checks under one
  `bun run test:foldkit` script. Keep those tests independent of React and run the same
  user-meaningful browser scenarios against the separate Foldkit entry; do not create a second
  product-level scenario DSL for the new renderer.

#### Runtime constraints proven while building the Phase 5/6 adapters

These were established by working adapters and tests, not by reading documentation. They contradict
some of the looser wording above and elsewhere in this plan; where they conflict, these win.

- **Mount args are Schema-only and captured at insert.** There is no channel for callbacks, `File`
  values, or Effect services — a Mount factory's requirement channel is `never`, so it cannot pull
  from a provided service. Injectable collaborators (source-byte loaders, library constructors,
  retry schedules) are closed over when the adapter is constructed. A Managed Resource's `acquire`
  is likewise `Scope`-only.
- **Changing what a Mount owns is a new element key, not changed args.** Source, layout, and zoom
  identity belong in the view's element key. This is as load-bearing as the runtime container `id`,
  and reader byte loading (`sourceId -> ArrayBuffer`) becomes an explicit environment dependency
  rather than a `File` in the Model.
- **Release is deterministic but not ordered before the next acquire.** Finalizers run on a forked
  interrupt and the DOM layer creates the replacement before destroying the old node, so a previous
  scope's release can land _after_ the next acquire. Any adapter holding a "current" reference needs
  an identity guard in the release closure; state confined to each `acquire` closure avoids the
  problem entirely and is preferred.
- **Effect interruption does not cancel an in-flight library promise.** A Mount awaiting epub.js or
  PDF.js must check a released flag and dispose of the handle when the promise finally resolves, or
  a fast source switch leaks a document and its worker.
- **A custom element is `display: inline` until told otherwise.** The widget replacing a decorator
  node must set its own `display: block`: with an inline host, `position: relative` does not
  establish the containing block its absolutely positioned chrome measures against, so the handle
  and the remove button land against a distant ancestor — off-screen, unhittable, and invisible to
  a test that only checks that the element exists.
- **jsdom has no `setPointerCapture`.** A drag implemented with pointer capture must treat it as
  optional or every jsdom test of the widget throws; the drag still tracks correctly over the
  handle without it, and the browser suite covers the captured path.
- **Resolving a Lexical node from a DOM node needs the editor active.**
  `$getNearestNodeFromDOMNode` inside `editor.getEditorState().read(...)` silently finds nothing;
  `editor.read(...)` (or `editor.update(...)`) is what makes it work.

- **epub.js reads `this` inside `display`.** Holding `rendition.display` in a local, as a Mount
  adapter naturally does, makes every call throw `undefined is not an object (evaluating
  'this.displaying')` — and the adapter's own fallback loop reports that as "no displayable section
  found in epub". Bind it. jsdom fakes never caught this; the first real browser render did.
- **Playwright's WebKit build cannot store a `Blob` or `File` in IndexedDB** (`UnknownError: Error
  preparing Blob/File data to be stored in object store`). The browser suite therefore cannot seed
  the production source cache for the Foldkit reader; its harness substitutes a byte loader that
  fetches the fixture URL instead. That substitution is only possible because the byte loader is
  the reader slice's one constructor-injected environment dependency.
- **A Foldkit reader needs real height before either library will paginate.** `.reader-surface` is
  `height: 100%`, so the reader's own shell has to be the flex column that gives it that height;
  without it epub.js resolves no displayable section and the failure looks like a corrupt book.

- **`test:foldkit` runs Node plus jsdom, which cannot render.** epub.js never settles `display()`
  (the srcdoc iframe never finishes loading and jsdom `Range` has no `getBoundingClientRect`), and
  there is no canvas backend for PDF.js rasterization. Parsing, lifecycle, cancellation, teardown,
  and DOM-free search are testable there; displayed content, real CFI/geometry reads, selection,
  spread relayout, and pagination measurement are browser-only and stay in the Playwright gate. Do
  not let Foldkit story tests be mistaken for coverage of rendering behavior.

#### Rendering a Foldkit runtime under jsdom

Three properties of `Runtime.embed` cost an afternoon to find because each one fails by rendering
nothing at all — no exception, no crash report, an untouched container. Any test that renders a view
must respect all three:

- **The container must carry an `id`.** An id-less container is never replaced and nothing mounts.
  `makeBookclubApplication` already sets `container.id = FOLDKIT_RUNTIME_ID`, so production is
  unaffected, but a test that builds a bare `document.createElement("div")` renders nothing.
- **`embed` replaces the container rather than filling it.** The rendered root lands in
  `document.body` and the original container is left detached, so assertions must read the document.
  Reading `container.innerHTML` always returns `""` and looks exactly like a render failure.
- **`dispose()` tears the rendered tree back down.** Capture the DOM before disposing, or assert
  before it runs. Disposing first also returns an empty document.

`vi.waitFor` did not reliably let the stubbed animation frame run in these tests; awaiting a short
`setTimeout` did. `src/tests/foldkit/notesView.test.ts` is the worked example.

## Route migration checklist

The path is part of the compatibility contract. Check off an endpoint only after its declaration,
handler, generated-client call, and tests have migrated. Paths below are the literal current URL
patterns; the `:groupId` segments on `/groups` and `/me/clubs` are the ones the contract rules
rename to `groupRef` in declarations and handlers. The URL does not change.

### Public authentication and session

- [x] `POST /auth/start`
- [x] `POST /auth/verify`
- [x] `POST /auth/signout`
- [x] `GET /auth/me`
- [x] `POST /auth/password`
- [x] `POST /auth/passkey/login/options`
- [x] `POST /auth/passkey/login/verify`

### Protected account and profile

- [x] `PUT /me/password`
- [x] `DELETE /me/password`
- [x] `POST /auth/passkey/register/options`
- [x] `POST /auth/passkey/register/verify`
- [x] `GET /me/passkeys`
- [x] `DELETE /me/passkeys/:id`
- [x] `GET /me/prefs`
- [x] `PUT /me/prefs`
- [x] `GET /me/reading-position`
- [x] `PUT /me/reading-position`
- [x] `PUT /me/avatar`
- [x] `PUT /me/clubs/:groupId/profile`

### Public avatar

- [x] `GET /users/:userId/avatar/:imageId`

### Group Control Plane and Group Data Plane

- [x] `GET /groups`
- [x] `POST /groups`
- [x] `GET /groups/:groupId`
- [x] `POST /groups/:groupId/invite-link`
- [x] `PUT /groups/:groupId/title`
- [x] `PUT /groups/:groupId/book/title`
- [x] `PUT /groups/:groupId/book/parsed-title`
- [x] `POST /groups/:groupId/invite`
- [x] `PUT /groups/:groupId/members/:memberId/role`
- [x] `POST /groups/:groupId/join`
- [x] `PUT /groups/:groupId/book`
- [x] `GET /groups/:groupId/book`
- [x] `DELETE /groups/:groupId/book/:sourceId`
- [x] `PUT /groups/:groupId/book/:sourceId/metadata`
- [x] `DELETE /groups/:groupId`
- [x] `POST /groups/:groupId/images`
- [x] `GET /groups/:groupId/images`
- [x] `DELETE /groups/:groupId/images/:imageId`
- [x] `GET /groups/:groupId/images/:imageId`
- [x] `GET /groups/:groupId/backup`
- [x] `PUT /groups/:groupId/backup`

### Administration

- [x] `POST /admin/backup`
- [x] `GET /admin/backups`
- [x] `POST /admin/prune`
- [x] `POST /admin/restore`

## Implementation phases

Each numbered phase is a milestone, not one giant commit. Make each independently reversible slice
one reviewable `jj` change; use `jj diff` and `jj status` before handing it off. Do not mix unrelated
cleanup or existing user changes into migration changes.

This migration spans many phases against a deployed application with installed native clients, so
every phase gate must leave `main` deployable. Concretely: deploy only from a passed gate, never
mid-phase; `scripts/predeploy-backup.ts` must keep working at every gate (it exercises the admin
routes, which do not migrate until Phase 7); and no gate may leave a route declared in the contract
but unserved by either an HttpApi handler or its legacy Hono registration. If a phase stalls, the
recovery is to abandon that phase's `jj` change and restore the exact legacy route, not to leave a
half-migrated route in place — the contract may stay ahead of the handlers, but the router must
never be ahead of both.

### Phase 0 — align Effect and restore the baseline

1. Remove only the unfinished working-copy `workflowResponse` / settled-result centralization
   without reverting unrelated reader/toast work. `WorkflowResult`, `runWorkflow`, and the current
   workflow modules already exist in the parent revision and stay until typed handlers replace
   their callers; Phase 7 owns their final deletion. Keep `src/shared/types/errors.ts` as the shared
   wire-code vocabulary that Phase 1 tagged errors and compatibility fixtures carry, but do not add
   another route helper around `WorkflowResult`.
2. Add `vitest` as a direct development dependency because package scripts and test imports use it;
   do not rely on a transitive lockfile entry.
3. Upgrade Effect to `4.0.0-rc.108`; add Foldkit `0.145.0` and `@foldkit/vite-plugin` `0.13.1` at
   their exact proven versions.
4. Apply the bounded Effect API migration proven by the spike: use `Schema.TaggedError`, replace the
   beta-only schedule composition with `Schedule.upTo`, and fix only additional compiler-reported
   RC changes. Migrate all four current `Schema.TaggedErrorClass` sites: `workflows/runtime.ts`,
   `client/logic/db.ts`, `client/logic/notes/useNoteAgent.ts`, and
   `client/logic/net/request.ts`.
5. Add `bun run test:foldkit` with the smallest runtime/update and scoped-resource tests that prove
   the installed Foldkit release works independently of React. Extend this harness with each
   Foldkit slice; use the existing Playwright scenarios for renderer-level behavior.
6. Record baseline results for `bun run typecheck`, `bun run test`, `bun run test:foldkit`,
   `bun run e2e`, `bun run test:e2e`, and `bun run test:visual`. `bun run check` is clean at the
   Phase 0 baseline, so every subsequent gate requires a clean exit; do not introduce an accepted
   lint backlog or weaken rules during the migration.
7. Add one temporary internal HttpApi health endpoint and expose its
   `HttpRouter.toWebHandler` handler through the current Hono app.
8. Exercise it through `@cloudflare/vite-plugin` and `wrangler dev`, including concurrent requests
   with distinct `Env` values in an adapter-level test.
9. Prove buffered bytes, streaming R2 bytes, dynamic headers, multiple `Set-Cookie` headers,
   appended `Vary`, OPTIONS/CORS, a native-origin WebSocket upgrade passing through the CORS
   middleware untouched, schema failures, unknown-route behavior, a single endpoint declaring two
   success statuses, and the built-in decode/404/defect error re-encoding in focused spikes.
   Anything on this list that cannot be expressed is a contract-shape decision, not an
   implementation detail: resolve it here and amend this document before Phase 1.
10. Delete the temporary endpoint. Capture the proven patterns as tests and small shared modules,
    not explanatory scaffolding.

Gate: the Effect RC passes the existing application suites, workerd serves a schema endpoint, and
all protocol spikes pass through the temporary Hono-to-Effect adapter.

#### Phase 0 record — 2026-08-15

- Pinned Effect `4.0.0-rc.108`, Foldkit `0.145.0`, and `@foldkit/vite-plugin` `0.13.1`; the lockfile
  resolves one Effect version. Added direct Vitest ownership and `bun run test:foldkit`.
- Removed the working-copy `workflowResponse` helper while retaining the parent revision's workflows
  and the shared wire-code vocabulary. Migrated all four RC tagged-error sites and the bounded retry
  schedule.
- `src/tests/httpapi/compatibility.test.ts` proves the Hono adapter, concurrent request context,
  buffered and streamed bytes, dynamic headers, appended `Vary`, native preflights, duplicate
  cookies, 200/204 successes, and the current decode/404/defect behavior. Decode, 404, and defect
  responses are empty in RC.108, so Phase 1 still requires the planned outer error-envelope shim.
  Duplicate `Set-Cookie` uses the recorded `handleRaw` escape hatch because declarative
  `WithHeaders` is a single-value record.
- A temporary probe, deleted after use, returned a real WebSocket 101 through both Wrangler workerd
  and a forced `@cloudflare/vite-plugin` run. `HttpServerResponse.raw(Response(101))` reports outer
  status 200, so native CORS must also detect `HttpBody.Raw` with an inner `Response.webSocket`
  before mutating headers.
- Passed: `bun run check`, `bun run test` (192 tests), `bun run test:foldkit`, `bun run e2e`
  (8 scenarios), `bun run test:visual`, and `bun run build`. The production React entry is
  358.77 kB gzip and contains no Foldkit import.
- The last full `bun run test:e2e` passed 28 of 29 tests after supplying the Vite serve-only HMAC
  secret. The remaining EPUB check used unchanged offscreen coordinates as a redraw proxy even
  though its direct DOM-replacement marker proved the annotation was recreated. The corrected
  focused PDF and EPUB redraw checks pass 2 of 2; rerun the full browser suite before Phase 1.

### Phase 1 — establish the shared contract and Worker seam

1. Create `BookclubHttp` and the four contract groups.
2. Define the shared failure schemas and exact compatibility fixtures.
3. Add request-scoped Cloudflare environment context.
4. Build authentication and admin middleware declarations and live adapters.
5. Build all endpoint declarations before moving handlers; compile-time missing-handler checks then
   become the migration ledger.
6. Generate OpenAPI in development and tests for inspection. Do not add a production documentation
   route unless it has a user.
7. After the exact legacy Hono routes, dispatch unmatched conventional HTTP prefixes (`/auth`,
   `/me`, `/users`, `/groups`, and `/admin`) to Effect before Agent and asset fallback. Existing
   exact routes win until deleted; unknown paths under those prefixes receive the HttpApi 404.
   This is an intentional behavior change: today an unmatched path under those prefixes falls
   through to the `ASSETS` binding, whose `single-page-application` not-found handling returns the
   SPA HTML with status 200. Confirm no client route, deep link, or `e2e` surface relies on that
   before switching, and re-encode the HttpApi 404 into the `{ error }` envelope.
8. Align the service worker with the same prefix list in the same change. `vite.config.ts` sets
   `navigateFallbackDenylist: [/^\/(auth|groups|me|agents|admin)\//u]`, which omits `/users` and
   requires a trailing slash, so a bare `/groups` navigation is still SPA-fallen-back by the
   installed service worker. The router prefix list, the denylist, and the contract must name the
   same set.

Hono is migration scaffolding in this phase, not part of the target architecture. Do not port
legacy structured routes to raw Effect routes merely to delete Hono earlier.

The generated client may call exact legacy Hono routes as soon as their response fixtures satisfy
the shared contract. This lets Foldkit consume the final client surface before each server handler
moves; do not create a temporary Foldkit HTTP client.

Gate: a contract completeness test lists all 45 method/path pairs and their critical success
statuses, generated OpenAPI is inspectable, and legacy routes still own every production path.

### Phase 2 — prove the end-to-end architecture

Use preferences and reading positions as the first complete server/client slice, while establishing
the Foldkit application boundary proven by the spike.

1. Move `GET/PUT /me/prefs` and `GET/PUT /me/reading-position` directly into typed Effect handlers
   without `Request`, `Env`, Promise, or result wrappers.
2. Move identity acquisition to HttpApi authentication middleware and delete only these four exact
   Hono routes.
3. Add the Effect-native generated client with same-origin cookie and native bearer transforms.
4. Create a separate Foldkit application entry for migration testing. Keep it out of the production
   main bundle; the React entry remains the production behavioral reference.
5. Establish the top-level Route, Session, Account, and error/toast Model states. The Foldkit shell
   may call still-legacy exact Hono routes through the generated client when their fixtures match.
6. Promote the spike patterns into focused adapters and tests: stable runtime id, Lexical Mount,
   EPUB Mount, PDF Mount, and authenticated NoteAgent Managed Resource. Do not yet port the full
   editor or reader behavior.
7. Implement Foldkit preference hydration and reading-position synchronization through Commands
   and existing IndexedDB helpers.

Gate: schema, unauthenticated, cookie, native bearer, offline, lifecycle cleanup, and browser
reading/settings scenarios pass; the Foldkit entry exercises generated calls through HttpApi while
the production React entry remains unchanged.

Also measure the production main bundle at this gate and record it. The spike's 356.12 kB to
414.28 kB figure covered shipping both renderers, and Effect core already ships to the client today
(22 `src/client` modules import it), so the untested delta here is specifically
`effect/unstable/http`, `effect/unstable/httpapi`, and the generated client landing inside the
production React entry via the temporary Promise runner. Waiting until Phase 8 to discover that
those unstable modules do not tree-shake means discovering it after six phases depend on them.
Re-measure at every subsequent gate.

### Phase 3 — migrate authentication, account, and the Foldkit shell

Migrate all authentication, password, passkey, and session endpoints as one server seam, then make
the Foldkit shell independently usable.

1. Move route orchestration directly into Effect handlers and keep expected failures in the
   declared error channel.
2. Preserve production email-code and development sign-in behavior, both `/auth/start` successes,
   rate limits, session cookie attributes, challenge expiry, RP/origin calculation, the two cookies
   on passkey login verification, 204 signout, and cookie clearing.
3. Decode only the Bookclub SimpleWebAuthn envelope; keep browser ceremony in a small client adapter
   and vendor validation at the server adapter.
4. Migrate protected password, passkey, and remaining Account Profile calls; preferences and
   reading positions already migrated in Phase 2 must stay on their generated-client path.
5. Implement Foldkit routing for `/`, session initialization, login, passkey flows, account settings,
   offline banner, and toast/crash reporting.
6. Keep the existing browser ceremony and Capacitor token storage as imperative Effect adapters;
   they do not belong in Model or update.
7. Delete each exact Hono authentication/account route only after both generated-client contract
   tests and the existing production browser scenarios pass through its HttpApi handler.

Gate: password, passkey, cookie, bearer, signout, expired challenge, wrong origin, account settings,
production verification handler, and rate-limit suites pass through a live worker; the Foldkit shell
can authenticate on web and native builds without React services.

### Phase 4 — migrate Group Control Plane and the Foldkit home

1. Migrate list/create/resolve groups, Public Group ID resolution, invites and invite redemption,
   group/book title changes, role changes, Group Member Name projection, Book Catalog metadata and
   deletion initiation, and Group deletion initiation.
2. Translate Durable Object result unions to tagged failures at the Durable Object boundary; do not
   let settled unions leak into handlers.
3. Keep authorization against the current Group Control Plane and preserve successful committed
   changes when later projection work fails.
4. Build Foldkit Home and Group Control Plane Submodels against the generated client: club list,
   creation, invitations, roster, roles, renaming, catalog, and deletion confirmation.
5. Preserve public URLs and current accessible DOM/CSS. Do not redesign the home or modals during
   the state-framework migration.
6. Delete migrated React network code only when the corresponding Foldkit behavior and black-box
   scenario exist; keep the React view itself until final cutover.

Gate: group membership, invitation, role, naming, catalog, reconciliation, browser management, and
native generated-client suites pass. Every migrated exact Hono route is gone.

### Phase 5 — migrate binary data and the Foldkit reader

1. Migrate source upload/download with size/content-type parsing and `X-Source-Id`.
2. Migrate image upload/list/fetch/delete with membership checks and cache headers.
3. Migrate Group backup export/restore with archive limits, dynamic filename, no-store headers, and
   exact restore error statuses.
4. Migrate account avatar and Group Member Name profile routes, preserving R2 streaming and public
   avatar caching. Prefer streaming R2 bodies; buffer only when the archive or SDK requires it.
5. [x] Build the Foldkit workspace and reader Model around domain state only: selected source,
   reading position, layout, search, selection, chrome, modal, and load/error states.
6. [x] Port epub.js and PDF.js as Mount adapters. Reuse renderer-independent anchor, search,
   pagination, health, and snapshot helpers. Mount scopes own live documents, renditions, render
   tasks, canvases, observers, and event listeners. Highlight painting and erasing, search-highlight
   painting, live spread relayout with annotation repaint, and pagination measurement are adapter
   operations acting on the live session, not Model state.
7. [x] Replace React hotkey and swipe libraries with Foldkit/browser event Subscriptions only after
   the existing keyboard, touch, reduced-motion, and accessibility behavior is captured in browser
   tests. Captured in `src/tests/playwright/readerKeyboard.pw.ts` and `readerGestures.pw.ts`;
   reproduced by `readerKeyMessage` and `readerSwipeStream` behind two gated Subscriptions.
8. Retain image compression and browser `File` construction as client implementation details. Add
   byte/status/header regressions for every raw HttpApi response mode.

Gate: source/image/backup byte-for-byte tests, authorization, EPUB/PDF reading, selection, search,
page-turn, mobile layout, offline opening, and browser book flows pass through the Foldkit entry and
HttpApi.

### Phase 6 — migrate notes and collaboration

1. Port `NoteStore` as a Foldkit service/owned domain object without changing its op-log semantics.
   Commands enqueue and settle finite work; Model carries only the view state the UI renders.
2. Implement NoteAgent as a Managed Resource keyed by group, identity, and native/web session mode.
   Register `close` before awaiting identity, map state/presence callbacks to Messages, and let scope
   release handle group changes and runtime shutdown.
3. Preserve persisted pending operations, retry bounds, conflict handling, presence, server-stamped
   identity, and reconnect-triggered flush behavior.
4. Port the note list, threads, tags, highlights, references, images, and compose/edit flows as
   Foldkit views and Submodels.
5. Replace `@lexical/react` with one Lexical Mount. The Mount publishes draft/domain events and owns
   editor registration, image nodes, selection listeners, and teardown. Two things `@lexical/react`
   was silently providing must be owned explicitly: `ContentEditable` sets `contenteditable`,
   `role`, and `spellcheck` (neither `createEditor` nor `setRootElement` does), and
   `LexicalErrorBoundary` owned error display, so `onError` becomes a domain Message.
6. Image upload cannot live in the Lexical Mount, because Mount args carry no callbacks or `File`
   values. The Mount publishes a paste _fact_; a Command dispatched from `update` performs the
   upload and applies the result. Paste handling, upload retry/discard, and unresolved-image gating
   are therefore Phase 6 update/Command work, not Mount work.
7. [x] `NoteImageNode` was the largest editor-parity risk: a `DecoratorNode<ReactNode>` whose
   resize, remove, and retry UI is React rendered inside `decorate()`, which is dead weight without
   a framework renderer. **Resolved by moving the widget out of the framework entirely.** The
   interactive chrome is a native custom element, `<note-image>`
   (`src/client/logic/notes/noteImageElement.ts`), which owns its own DOM and reports what the
   reader did as `CustomEvent`s. Lexical writes its properties from `createDOM`/`updateDOM` and
   `decorate()` returns nothing; the Mount listens for its events on the editor root; Foldkit views
   bind the same element declaratively through `CustomElement.define`
   (`src/client/foldkit/noteImage.ts`). This is the seam Foldkit documents for widgets with
   "typed JS properties going in, `CustomEvent`s coming out", and it makes the chrome testable
   under jsdom through `Scene.CustomElement.emit` and plain event dispatch — coverage the React
   decorator never had. React keeps its own `decorate()` until cutover; the element is
   framework-neutral and can be adopted there first if the two entries need identical DOM.
8. Add raw Effect router handlers for the authenticated NoteAgent paths and verify cookie plus query
   token gating before removing their Hono registrations. These handlers are outside the HttpApi
   contract and must keep their current `text/plain` bodies and statuses — `unauthenticated`/401,
   `forbidden`/403, `not found`/404 — rather than adopting the JSON error envelope.

Gate: all note reducer/store tests, editor behavior, image and tag tests, two-client collaboration,
presence, offline queue, reconnect, and authenticated WebSocket scenarios pass through Foldkit and
the Effect router.

### Phase 7 — migrate administration and finish the server

1. Implement admin middleware for token and email-session authorization.
2. Migrate backup/list/prune/restore endpoints, preserving the predeploy script's status/body
   expectations and current `restore_failed` compatibility mapping.
3. Delete every remaining legacy structured route and empty Hono route module.
4. Add raw Effect router handlers for generic `routeAgentRequest`, assets, hashed-asset 404
   protection, and the development no-assets response.
5. Add native CORS as Effect middleware and verify allowed and disallowed OPTIONS behavior.
6. Delete Hono and the Workflow abstraction: `readJson`, `workflowResponse`, `WorkflowResult`,
   `runWorkflow`, `WorkflowFailureError`, generic `fail`, and the empty `workflows/` directory after
   `rg` shows no callers.
7. Ensure scheduled backups still run one Effect under `ExecutionContext.waitUntil` independently
   of the HTTP runtime.

Gate: admin/predeploy backup drills and all server suites pass with one Effect router, no Hono,
legacy structured routes, settled-result plumbing, or Workflow abstraction.

#### Server Phases 1-7 record — 2026-08-15

- [x] Declared and implemented all 45 structured operations: auth 7, account/profile 13, groups 21,
  and administration 4. The route checklist above is the server migration ledger; Foldkit callers
  and client parity remain separate unfinished work.
- [x] Installed request-scoped Cloudflare context plus authentication and administration
  middleware. Expected failures use the nine shared status-tagged error classes.
- [x] Replaced every Hono registration with typed HttpApi handlers or raw Effect router handlers;
  deleted Hono, legacy route modules, `src/server/http.ts`, and `src/server/workflows/`.
- [x] Kept raw escape hatches only where the wire requires them: raw uploads, R2/Agents streaming,
  dynamic image/source content types, backup filename and headers, duplicate cookies, and WebSocket
  pass-through. Their compatibility checks cover exact bytes, statuses, headers, native CORS, and
  the JSON-vs-text error boundary.
- [x] Preserved NoteAgent cookie/query-token authentication and its text 401/403/404 responses;
  preserved generic Agents routing, SPA fallback, hashed-asset 404, no-assets development response,
  and scheduled backup under `ExecutionContext.waitUntil`.
- [x] Verified the 45-operation OpenAPI contract and found no environment secrets or Durable Object
  state fields. The focused compatibility, contract, native-CORS, and Worker-seam suites pass 24/24.
  `bun run build` passes; the Worker is 375.85 kB gzip and the React client remains 358.77 kB gzip.
  The lockfile resolves one Effect version (`4.0.0-rc.108`), and no source fixture or Foldkit
  DevTools marker appears in the Worker bundle. The Agents SDK still contributes its transitive
  `mimetext.node` chunk under the configured `nodejs_compat` flag; this is existing SDK packaging,
  not a Bookclub Node API import.

#### Client slice-composition record — 2026-08-16

- [x] Split the Foldkit application into concern-owning modules: `reader.ts` (Route, workspace,
  reader Messages, EPUB/PDF Mounts, reader Commands, `updateReader`, `readerView`) and `notes.ts`
  (`NotesModel`, note Messages, `EnqueueNoteOperation`, `updateNotes`). `application.ts` now owns
  only session, account, groups, and routing, and delegates the rest.
- [x] Dispatch by schema guard, not by tag string. `ReaderMessage` and `NotesMessage` are
  `Schema.Union`s; `isReaderMessage`/`isNotesMessage` are the derived guards `update` branches on
  before its own switch. `src/tests/foldkit/applicationSeams.test.ts` asserts the two unions share
  no tag, because a tag claimed by both would be silently swallowed by whichever guard runs first.
- [x] Rendered the Reader route. It was in the `Route` union but had no view branch, so the EPUB and
  PDF Mounts were never mounted by the application — only by their own tests.
- [x] Wired the NoteAgent Managed Resource and its event Subscription into `makeApplication`
  (`managedResources` + `subscriptions`), so note Commands typecheck against `NoteAgentService`
  rather than `never`.
- [x] Added `NotesModel.connectionKey`, set from `ConnectedNoteAgent` and cleared on release or
  connection failure. The Subscription gates on this. The first wiring gated on
  `status !== "offline" && currentGroup !== null`, which is a boolean derived from the requirements
  — the exact hazard the Managed Resource rule above names, since it starts the stream before the
  queue it reads exists. The model had no field recording acquisition; now it does.

- [x] Added `notesView`, rendered beside the reader on the Reader route, covering the authoritative
  list, nested replies, deleted-note hiding, presence, pending and failed markers, the sync-failure
  alert, and the new-versus-edit composer. `src/tests/foldkit/notesView.test.ts` renders it through a
  real Foldkit runtime rather than asserting on the returned tree.

Known gaps at this record: the reader view is a functional skeleton, not the React reader's chrome;
notes rendering is covered but note *composition* still goes through the plain textarea rather than
the Lexical Mount; and
`getAgentByName` remains a hard-wired module import across six server files, so
`src/tests/httpapi/workerSeam.test.ts` still substitutes the `agents` module behind a documented
lint suppression rather than an injection point.

#### Composer record — 2026-08-16

- [x] Phase 6 item 5: note composition now runs through the Lexical Mount. `notesView` renders the
  editor element instead of a textarea, and `ChangedNoteDraft`, `ExtractedNoteDraftTags`,
  `ChangedNoteDraftSelection`, and `FailedNoteEditor` are members of `NotesMessage` folded by
  `updateNotes`. `src/tests/foldkit/notesView.test.ts` asserts the mounted element carries
  `contenteditable`/`role=textbox`, is seeded from the draft, and that no textarea remains.
- [x] Added `NotesModel.composerGeneration`, and keyed the editor element on it. `OnMount` starts its
  stream on snabbdom `insert` and interrupts it on `destroy`, so changing a Mount's *args* never
  restarts it — only a new element does. Seeding the editor from `model.draft` therefore needs an
  explicit re-seed signal: the generation is bumped by `StartedNoteEdit` and by `clearComposer`, and
  by nothing the editor itself publishes. Keying on the draft would tear down the live editor on
  every keystroke; keying on nothing would leave a stale body when an edit starts.
- [x] Closed the reader-to-composer seam. `ReaderWorkspace.selection` was populated by the EPUB and
  PDF Mounts but reached nothing. `notesView` now takes the live selection through its context and
  offers "Quote this passage"; `AttachedNoteHighlight`/`DetachedNoteHighlight` fold it into
  `draftHighlights`, which `addNoteOp` already carries into the submitted operation. Attachment is
  deduplicated by anchor, not by id, because the reader mints a fresh highlight id for every
  selection it publishes.

#### Image paste record — 2026-08-17

Phase 6 item 6 is done as specified. The Lexical Mount registers a `paste` listener on its root
element and publishes `PastedNoteImage { groupRef, file }` — the paste *fact*, not the upload,
because a Mount factory has no requirement channel and cannot reach a Command. `updateNotes` folds
that message through the **same** case as the composer's file picker, so both dispatch one
`UploadNoteImage` Command; on success the `[[image:…]]` block is appended to the draft and
`composerGeneration` is bumped so the editor re-seeds and renders it.

Two behaviors are load-bearing and covered: the listener calls `preventDefault` only when the
clipboard actually carries an image, so ordinary text paste still reaches Lexical untouched; and the
listener is part of the Mount's teardown array, so a released editor stops reporting pastes.
`groupRef` is a Mount arg rather than parsed back out of `imageUrlBase`.

jsdom has no `ClipboardEvent`, so `src/tests/foldkit/lexicalMount.test.ts` dispatches a plain
cancelable `Event` with a defined `clipboardData` property. The Mount's own listener is typed
against `Event` and narrows with a documented assertion for the same reason.

#### Upload contract record — 2026-08-17

All four raw-byte uploads — `uploadBook`, `uploadImage`, `restoreBackup`, and `uploadAvatar` — now
declare a **multipart-stream payload** and are driven by the generated client. `apiFetch` no longer
does anything for them that `bookclubClient` cannot, so Phase 8 item 5 can delete it outright.

Two constraints ruled out the obvious design of a `Uint8Array` byte payload, and both were found by
reading the runtime rather than the docs:

- **The client would have to buffer.** `HttpApiClient.ts:1113` rejects any payload that is not an
  actual `Uint8Array`, and the generated method has no body override. Turning a `File` into one
  loads the whole file into memory — untenable for a 100 MB archive on a mobile webview, where the
  previous `body: file` let the browser stream from disk.
- **The server dispatches payload decoding on an exact content-type match.**
  `HttpApiBuilder.ts:695-701` looks the request's normalized content-type up in a map and answers
  **415 before the handler runs** on a miss; `internal/mediaType.ts` only lowercases and strips `;`
  parameters, so there is no wildcard. A byte payload therefore imposes a closed media-type
  allowlist. That is fatal for `uploadBook`, which deliberately sniffs the bytes
  (`sniffSourceKind(bytes) ?? sourceKindFor(contentType)`) and treats the caller's content-type as
  an untrusted fallback.

Multipart dissolves both. The client passes `FormData`; `HttpApiClient.ts:421` detects it ahead of
payload encoding and hands it to `fetch` untouched, so the browser still streams the file from disk.
The request's own content-type is the single constant `multipart/form-data`, so the allowlist always
matches, and the file's real media type rides in the part's headers where it belongs. The generated
method stays fully typed: `HttpApiEndpoint.ts:507` types a multipart payload as `FormData` for the
client and `HttpApiEndpoint.ts:114` types it as `Stream<Multipart.Part>` for the handler.

Buffered multipart is **not** usable here: `HttpServerRequest`'s `multipart` getter routes through
`Multipart.toPersisted`, which requires `FileSystem` and `Path` services a Worker cannot provide.
`asMultipartStream` uses `Multipart.makeChannel`, a pure-JS Channel parser with no such dependency.
Size limits are now declared on the contract (`src/shared/http/uploads.ts`) instead of being checked
ad hoc per service.

Wire change, deliberately accepted: these four routes take `multipart/form-data` rather than a raw
body, so every caller sends a part named by `UPLOAD_FILE_FIELD` and must **not** set `Content-Type`
itself — the browser has to generate the boundary. React, the Node e2e scenarios, and the Playwright
suites were all moved over together, and the four upload scenarios pass against a booted worker.

### Phase 8 — cut over to Foldkit and delete React

1. Run the complete browser suite against both entries using the same user-meaningful scenarios.
   Fix parity in Foldkit; do not preserve React implementation details that have no user effect.
2. Make Foldkit the production application entry and verify PWA, Capacitor iOS, and Capacitor Android
   builds before deleting the React entry.
3. Delete React components, hooks, test harnesses, and compatibility adapters after their last
   behavior is covered by Foldkit Story/Scene tests or existing Playwright tests.
4. Remove `react`, `react-dom`, `@vitejs/plugin-react`, Wouter, `@lexical/react`, React hotkeys,
   React swipe handling, and other React-only dependencies after `rg` shows no runtime callers.
5. Delete manual request schemas/parsers, obsolete `apiFetch` calls, the Promise generated-client
   runner, duplicate toast/modal state, and the embedded/parallel runtime entry.
6. Compare production bundles. Do not ship both renderers; investigate any final Foldkit bundle
   regression large enough to affect startup on a typical mobile connection.
7. **Done at cutover:** `src/tests/playwright/visual.pw.ts` and its snapshots were deleted with the
   React reader they were taken against. The markup contract now lives in
   `src/tests/parity/signatures/`, which pins the rendered tree rather than its pixels — a stronger
   check for this migration, since it names the element that drifted instead of showing a diff image.
   The original note follows.

   Its snapshots are taken against the
   React DOM and will not survive cutover. Since the plan keeps the existing CSS and accessible DOM,
   re-baselining with `bun run test:visual:update` is expected — but re-baseline deliberately, after
   the parity scenarios pass, and diff the old and new snapshots for unintended visual changes
   rather than accepting the new images blind.

Gate: the production build contains one Foldkit renderer and one Effect version; all checks and
native/browser smoke tests pass with no React runtime or compatibility layer.

### Phase 9 — documentation, hardening, and deployment

1. Update this status and check every migrated route and client surface.
2. Replace migration wording in `AGENTS.md` with steady-state HttpApi and Foldkit rules.
3. Add ADRs only for decisions future maintainers might reasonably reopen, especially raw binary
   responses, runtime/resource lifetime, or retained imperative library boundaries.
4. Review OpenAPI and the Foldkit Model/DevTools view for accidental secret or internal fields.
5. Inspect production Worker and client bundles for Node-only dependencies, duplicate Effect copies,
   both renderers, source fixtures, and development DevTools.
6. Deploy only when explicitly authorized. Verify the exact production Worker and SPA versions,
   cookie and native bearer login, group mutation, EPUB and PDF opening, source download, note edit
   and collaboration, NoteAgent connection, offline restart, PWA update, and asset fallback.

## Verification matrix

Run the smallest relevant checks during a phase and the complete gate before deleting legacy
routes.

| Concern              | Required verification                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Effect version       | One exact version; unit, worker, client, and Foldkit typechecks                                                                  |
| Schema contract      | 45 method/path completeness test, critical statuses, generated-client typecheck                                                  |
| Expected failures    | Status and JSON compatibility table for every declared tagged failure                                                            |
| Built-in failures    | Decode, unmatched-route, and defect responses carry the `{ error }` envelope                                                     |
| Authentication       | Cookie, bearer, invalid/expired token, signout, native origin                                                                    |
| Passkeys             | Registration/login options and verification, challenge cookies, RP/origin                                                        |
| Group authorization  | Current Group Control Plane role for every Group Data Plane mutation                                                             |
| Binary transport     | Exact bytes, content type, dynamic headers, large-body behavior                                                                  |
| Server isolation     | Concurrent requests do not share Env or identity context                                                                         |
| Worker routing       | HttpApi, Agent WebSocket, generic agent, SPA fallback, hashed-asset 404                                                          |
| Mount lifecycle      | Lexical, EPUB, and PDF acquire, update, source switch, failure, and teardown                                                     |
| Managed Resources    | NoteAgent auth, identity, group switch, reconnect, release, and runtime shutdown                                                 |
| Foldkit state        | `bun run test:foldkit` for meaningful transitions, Commands, Mounts, and Managed Resources; no opaque handles in Model           |
| Accessibility        | Existing keyboard, focus, dialog/menu, reduced-motion, and touch browser flows                                                   |
| Offline/native       | IndexedDB restart, pending notes, Capacitor bearer/preferences, iOS/Android build                                                |
| Client compatibility | Existing web and installed-native response/error shapes                                                                          |
| Bundle/cutover       | One renderer, one Effect, no source fixtures or development-only tooling; main bundle size recorded at every gate                |
| Service worker       | Navigation denylist matches the router prefixes; installed PWA updates to the new entry                                          |
| Regression           | `bun run test`, `bun run e2e`, `bun run test:e2e`, `bun run test:visual`, and `bun run check` against the recorded lint baseline |

### Running the Foldkit entry

`bun run dev` serves React at `/` and the Foldkit entry at `/foldkit` (`foldkit.html`), both against
the same local worker with `DEV_AUTH=true`. Any email signs in from the modal's "send code" button,
because a dev worker signs a known email in outright instead of mailing a code. The Foldkit entry
has no URL routing yet — it navigates in the Model — because `/clubs/…` in development belongs to
React; wiring `routing` into `makeApplication` is part of the cutover.

**Every gate in this matrix passed while sign-in, group loading, and opening a book were all broken
in the assembled application.** Slice tests and harnesses cover the pieces; nothing crossed the seam
between the whole client and a real server. Treat driving the running entry as a verification step
in its own right, not as a demo.

`bun run e2e` is the authoritative black-box structured HTTP and Agent integration suite. Keep its
surfaces independent of server modules. Add contract-level tests through the generated client, but
do not replace live-worker scenarios with implementation tests.

## Deletion ledger

Delete these only when their last caller has migrated:

- `src/server/routes/groupRoutes.ts`
- `src/server/routes/userRoutes.ts`
- `src/server/routes/authRoutes.ts`
- `src/server/http.ts`
- `runWorkflow`, `WorkflowResult`, `WorkflowFailure`, `WorkflowFailureError`, `fail`
- Manual request parsing and workflow `unknown` parameters covered by contract schemas
- Manual client `ErrorBody`, response-envelope schemas, `parseJson`, and migrated `apiFetch` calls
- The Hono app, route registrations, route modules, and dependency
- The `src/server/workflows/` abstraction after reusable logic has moved directly beside handlers
- `src/client/app`, React UI components/hooks, and React-specific test harness code after Foldkit
  parity tests pass
- `react`, `react-dom`, `@vitejs/plugin-react`, `@lexical/react`, Wouter, React hotkeys, and React
  swipe dependencies after `rg` shows no runtime imports
- The temporary Promise generated-client runner and parallel Foldkit/React entry
- Any spike-only fixtures, routes, credentials, DevTools configuration, and embedded runtime host

Do not delete `apiFetch` until all remaining non-generated calls are classified. Direct asset/data
URL fetches are not Bookclub HTTP client calls.

## Stop conditions

Stop a phase and leave its exact legacy Hono route in place when any of these occurs:

- The Effect handler cannot preserve a current status, body, cookie, header, or byte stream.
- workerd requires a Node-only module or runtime behavior not covered by the configured
  compatibility flags.
- A migrated handler weakens Group Control Plane authorization or projection invariants.
- A route deletion would split one authentication or transaction flow across incompatible cookie
  handling.
- The generated client cannot preserve native bearer behavior.
- The Foldkit runtime requires live library handles or credentials inside its serializable Model.
- A Lexical, EPUB, or PDF Mount cannot preserve current behavior and deterministic cleanup.
- NoteAgent cannot authenticate, reconnect, flush pending operations, or release cleanly as a
  Managed Resource.
- The Foldkit entry regresses an existing browser accessibility or offline guarantee without an
  equivalent supported mechanism.
- A cutover bundle contains both React and Foldkit or multiple incompatible Effect versions.
- An HttpApi built-in failure body cannot be re-encoded to the `{ error, reason? }` envelope, so an
  installed native client would receive a shape it cannot parse.
- The CORS middleware cannot leave a WebSocket upgrade response untouched.
- A phase gate would land with a contract route that neither an HttpApi handler nor a legacy Hono
  registration serves.

Resolve the issue in the contract or adapter; do not add a second settled-result abstraction around
HttpApi, hide live resources in global variables, or keep both client architectures indefinitely.

## References

- Effect v4 library guidance: <https://github.com/Effect-TS/effect/blob/main/LLMS.md>
- HttpApi guide and web-handler example:
  <https://github.com/Effect-TS/effect/blob/main/ai-docs/src/51_http-server/10_basics.ts>
- Tagged failure recovery:
  <https://github.com/Effect-TS/effect/blob/main/ai-docs/src/01_effect/04_errors/10_catch-tags.ts>
- Effect v4 router and HttpApi registration sources:
  <https://github.com/Effect-TS/effect/blob/main/packages/effect/src/unstable/http/HttpRouter.ts> and
  <https://github.com/Effect-TS/effect/blob/main/packages/effect/src/unstable/httpapi/HttpApiBuilder.ts>
- Installed implementation sources:
  `node_modules/effect/src/unstable/httpapi/` and `node_modules/effect/src/unstable/http/`
- Foldkit architecture and React migration guidance:
  <https://foldkit.dev/core-concepts/architecture> and
  <https://foldkit.dev/react/coming-from-react>
- Foldkit runtime seams:
  <https://foldkit.dev/core-concepts/mount>,
  <https://foldkit.dev/core-concepts/managed-resources>, and
  <https://foldkit.dev/core-concepts/embedding>
- Installed Foldkit implementation and type sources: `node_modules/foldkit/dist/`; use the exact
  installed release rather than examples from a moving `main` branch.

## Handoff protocol

The implementing agent must:

1. Read `AGENTS.md`, `CONTEXT.md`, `e2e/AGENTS.md`, and this document before editing.
2. Inspect `jj status` and preserve unrelated work.
3. Start at the first incomplete phase and update this document's status/checklists in the same
   `jj` change as the implementation.
4. Record exact checks and any accepted HttpApi escape hatches here.
5. Never check off a route until its raw legacy registration is gone and live-worker tests exercise
   the typed Effect handler.
6. Never check off a Foldkit surface until the React reference behavior is represented by a shared
   black-box scenario or an explicit Foldkit Story/Scene test.
7. Keep the migration Foldkit entry out of the production main bundle until cutover, and do not
   delete the React reference before the corresponding parity gate passes.
