# Effect HttpApi and Foldkit next-agent handoff

Start from jj change `lupyvsmw` (`Implement Effect HttpApi and Foldkit Phase 0`). The canonical
design and phase ledger remain in `docs/plans/effect-httpapi-migration.md`; do not duplicate or
reinterpret them here.

## Current state

- Phase 0 is implemented: Effect `4.0.0-rc.108`, Foldkit `0.145.0`, and
  `@foldkit/vite-plugin` `0.13.1` are pinned.
- The retained HttpApi compatibility tests cover the Hono adapter, request-context isolation,
  success/error statuses, binary bodies, cookies, native CORS, and raw WebSocket pass-through.
- `bun run test:foldkit` covers a real Foldkit update and Mount acquire/release without React.
- The EPUB browser test now checks direct annotation DOM replacement; it no longer assumes an
  offscreen text range must change coordinates when the spread preference changes.
- No production route has migrated. React remains the production client.

## Validation at handoff

- `bun run check` passes.
- Focused PDF and EPUB highlight redraw browser checks pass 2 of 2.
- The previous full browser run passed every other test (28 of 29); rerun `bun run test:e2e` once
  before starting Phase 1.

## Next change

1. Read `AGENTS.md`, `CONTEXT.md`, `e2e/AGENTS.md`, and the canonical migration plan.
2. Confirm `jj status`, review `jj diff`, and run `bun run check`, `bun run test`,
   `bun run test:foldkit`, and the smallest relevant browser/live-worker checks.
3. After Phase 0 is reviewed, start a new jj change for Phase 1.
4. Build the shared `BookclubHttp` contract, four groups, shared tagged failures, and the exact
   method/path plus error-compatibility fixtures before moving a handler.
5. Add request-scoped Cloudflare context and authentication/admin middleware declarations. Keep
   every legacy Hono route active until its typed handler and black-box scenario pass.
6. Stop before Phase 2 unless the 45-route completeness test, OpenAPI inspection, service-worker
   prefix alignment, unit tests, and live-worker gate all pass.

## Proven constraints

- RC.108 decode, unknown-route, and defect responses are empty; Phase 1 needs one outer
  `{ error, reason? }` encoding shim.
- Duplicate `Set-Cookie` requires the recorded `handleRaw` escape hatch.
- Native CORS must detect `HttpBody.Raw` containing an inner `Response.webSocket`; its outer Effect
  response reports status 200 even though workerd sends 101.
- Keep the separate Foldkit entry out of the production bundle until cutover.
