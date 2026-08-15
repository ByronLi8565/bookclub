# AGENTS.md

Bookclub: a collaborative book-reading app. One Cloudflare Worker + React SPA. `src/client` (React/Vite), `src/server` (HTTP + the `agents` SDK over
Durable Objects), `src/shared` (wire types). E2E specifics: `e2e/AGENTS.md`.

- Package manager is **bun**; run scripts as `bun run <script>`. Never `bun test`
  (not our runner) — use `bun run test` (Vitest).
- Full check gate: `bun run check` (oxfmt + oxlint + tsc). Other suites:
  `bun run e2e` (live worker), `bun run test:e2e` (Playwright).
- Version control is **Jujutsu (jj)**, colocated with git: use `jj`, not `git`.
- Match the surrounding comment style: say _why_, not _what_.
- The Effect v4 HttpApi migration is committed and specified in
  `docs/plans/effect-httpapi-migration.md`; read it before changing structured HTTP routes,
  workflows, authentication, or client transport.
- New or migrated structured HTTP routes belong in the shared HttpApi contract. Keep expected
  failures in the Effect error channel as shared tagged errors. The complete fetch path belongs in
  Effect `HttpRouter`; do not add a second web framework or dispatcher.
- Parse, don't validate: decode unknown HTTP/configuration input once at its I/O boundary into the
  type the application needs. Domain code accepts parsed values and does not repeat shape, format,
  or length checks. Stateful authorization, existence, uniqueness, and concurrency checks remain at
  the module that owns the state.
- HttpApi handlers are already Effects. Do not add Workflow wrappers, `{ ok, value }` result
  envelopes, settled-result matching, or `Effect.runPromise` below a platform entrypoint.
