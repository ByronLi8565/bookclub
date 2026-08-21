# AGENTS.md

Bookclub: a collaborative book-reading app. One Cloudflare Worker + a Foldkit SPA. `src/client`
(Foldkit/Vite: `foldkit/` is the application, `logic/` the framework-free modules it builds on,
`styles/` the stylesheets), `src/server` (HTTP + the `agents` SDK over Durable Objects),
`src/shared` (wire types). E2E specifics: `e2e/AGENTS.md`.

- The client is **Foldkit**, an Elm architecture: `Model`/`Message`/`Command`/`Subscription`/`Mount`.
  There is no React and no second UI framework — do not add one. State changes go through `update`;
  effects are Commands; the DOM is a `view`.
- Routes are URLs. `src/client/foldkit/routes.ts` owns the table, and every route change — clicked or
  programmatic — goes out as a URL and comes back through `onUrlChange`, so the address bar and the
  Model cannot disagree.
- `src/tests/parity/` holds the React client's rendered markup, recorded on the day it was deleted.
  A change to a file in `signatures/` is a change to the user interface: review it as one.

- Package manager is **bun**; run scripts as `bun run <script>`. Never `bun test`
  (not our runner) — use `bun run test` (Vitest).
- Full check gate: `bun run check` (oxfmt + oxlint + tsc). Other suites:
  `bun run e2e` (live worker), `bun run test:e2e` (Playwright).
- Version control is **Jujutsu (jj)**, colocated with git: use `jj`, not `git`.
- Match the surrounding comment style: say _why_, not _what_.
- The server HTTP architecture is Effect v4 HttpApi as specified in
  `docs/plans/effect-httpapi-migration.md`; read it before changing routes, authentication, or
  client transport.
- Structured HTTP routes belong in the shared HttpApi contract. Keep expected
  failures in the Effect error channel as shared tagged errors. The complete fetch path belongs in
  Effect `HttpRouter`; do not add a second web framework or dispatcher.
- Parse, don't validate: decode unknown HTTP/configuration input once at its I/O boundary into the
  type the application needs. Domain code accepts parsed values and does not repeat shape, format,
  or length checks. Stateful authorization, existence, uniqueness, and concurrency checks remain at
  the module that owns the state.
- HttpApi handlers are already Effects. Do not add Workflow wrappers, `{ ok, value }` result
  envelopes, settled-result matching, or `Effect.runPromise` below a platform entrypoint.
- Keep one Effect `HttpRouter` for structured routes, NoteAgent gating, Agents SDK fallback, native
  CORS, and assets. Do not reintroduce Hono, raw structured-route dispatch, or route modules.
- Raw handlers are limited to uploads, streaming/dynamic binary responses, Agent routing, and asset
  fallback. Preserve their byte, status, header, WebSocket, and error-body regression coverage.
