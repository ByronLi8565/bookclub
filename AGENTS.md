# AGENTS.md

Bookclub: a collaborative book-reading app. One Cloudflare Worker + React SPA. `src/client` (React/Vite), `src/server` (Hono + the `agents` SDK over
Durable Objects), `src/shared` (wire types). E2E specifics: `e2e/AGENTS.md`.

- Package manager is **bun**; run scripts as `bun run <script>`. Never `bun test`
  (not our runner) — use `bun run test` (Vitest).
- Full check gate: `bun run check` (oxfmt + oxlint + tsc). Other suites:
  `bun run e2e` (live worker), `bun run test:e2e` (Playwright).
- Version control is **Jujutsu (jj)**, colocated with git: use `jj`, not `git`.
- Match the surrounding comment style: say _why_, not _what_.
