# Writing e2e scenarios

A scenario is ONE user-meaningful product journey, written once against the
`Target` interface and run on every deployment that supports its capabilities.
Tests are **black-box**: drive the product only through public surfaces (the
HTTP API, the NoteAgent websocket). Never import app internals, never poke the
Durable Object storage, never modify product code — if the product blocks you,
STOP and report the blocker instead of working around it.

**The test source is the review artifact.** A reviewer judges correctness by
reading the test; write it so it reads as a spec. Assertions are plain vitest
`expect` — use the message argument to state intent
(`expect(x, "why this matters").toBe(...)`).

This suite is modelled on [executor's e2e suite](https://github.com/UsefulSoftwareCo/executor/tree/main/e2e),
scaled to what this project is.

## What this exercises that unit tests can't

The reducer, op-log, and permission helpers have unit tests under `src/tests/`.
This suite covers the things that only exist when the real worker is running:
dev-auth login, group membership gating, and the **live collaborative path** —
one member's note reaching another over the NoteAgent websocket, server-stamped
identity (ADR 0001), one room per group (ADR 0002), presence.

## Anatomy

```ts
import { expect } from "vitest";
import { scenario } from "../src/scenario.ts";

scenario(
  "Notes · a member's note reaches another member live, server-stamped",
  {}, // { timeout?: number; skip?: string (reason — registers as skipped) }
  async (ctx) => {
    const api = ctx.need("api"); // HTTP surface
    const notes = ctx.need("notes"); // NoteAgent websocket surface

    const owner = await api.newIdentity({ label: "owner" });
    const group = await api.createGroup(owner, "Moby-Dick Club");
    // ...
    ctx.onCleanup(() => session.close()); // finalizer, runs on pass OR fail
  },
);
```

- A scenario declares what it needs by calling `ctx.need(<capability>)`. Asking
  for a capability the current target can't provide **skips** the test and records
  the reason in `skipped.json` — there is no `needs` list, the ask IS the
  declaration. Ask for surfaces at the top of the body, so a skip happens before
  any real work.
- Resources created in a test must be cleaned up with `ctx.onCleanup(...)` (a
  finalizer), not trailing statements — a mid-test failure must not leak state
  into the shared instance.

## Surfaces

- **`api`** (`src/surfaces/api.ts`): `newIdentity()` mints a fresh logged-in user
  via the e2e worker's explicit `DEV_AUTH=true`; plus
  `createGroup` / `inviteLink` / `join` / `refFor` and a raw `request()` escape
  hatch. NOTE: `/groups/:ref/*` routes take the URL ref (`slug-publicId`, via
  `refFor`), while the NoteAgent websocket takes the internal `group.groupId`.
- **`notes`** (`src/surfaces/notes.ts`): `connect(groupId, identity)` opens an
  authenticated NoteAgent socket and returns a session with `addNote`,
  `applyOperations`, `notes()`, `presence()`, and `waitForNotes` /
  `waitForPresence` (condition waiters — no sleeps).

## Targets

One target today: **`wrangler`** — the built worker under `wrangler dev` on the
e2e-only `wrangler.e2e.jsonc` (which adds the `new_sqlite_classes` migration the
agents SDK needs locally; it is NEVER deployed). Each run starts from a fresh
throwaway persist dir. Adding a target = a factory in `src/targets/registry.ts`

- a `setup/<name>.globalsetup.ts` + a project in `vitest.config.ts`.

> There is intentionally no `vite`/`dev` target yet. Vite local development now
> injects the SQLite migrations, but this harness still uses a fresh isolated
> Wrangler target so runs never share developer state.

## Running

```sh
bun run e2e            # boots wrangler dev on a derived port, runs all scenarios
bun run e2e:watch      # watch mode

# Fast iteration against an already-running instance:
bunx wrangler dev --config wrangler.e2e.jsonc --port 8842 --persist-to /tmp/bc-e2e
E2E_WRANGLER_URL=http://127.0.0.1:8842 bun run e2e
```

Ports are derived from the checkout path (`src/ports.ts`), so two worktrees
don't collide; `E2E_WRANGLER_PORT` pins one explicitly. Each run writes
`runs/<target>/<slug>/result.json` (or `skipped.json`); wrangler's own output
is captured to `runs/.wrangler/dev.log`.

## Discovering payload shapes

The public surface is the worker's routes. To see what an endpoint accepts and
returns, read the route + workflow definitions — READ ONLY, for shapes, not for
importing:

- HTTP routes: `src/server/{worker,routes/groupRoutes,routes/userRoutes}.ts`
- their result shapes: `src/server/workflows/*.ts`
- websocket RPC methods (the `@callable`s): `src/server/state/NoteAgent.ts`
- wire types shared with the client: `src/shared/types/*.ts`

## Isolation rules

- Each run boots a fresh worker on a throwaway persist dir, so state never
  leaks between runs. Within a run, scenarios share that one instance (files run
  serially), so isolate WITHIN a run too:
- Prefer a fresh `newIdentity()` per scenario — a new user+group is isolated for
  free; don't reuse a hard-coded email across scenarios.
- Don't assert on global counts (assert "contains mine", not "there is exactly
  one") so a parallel or later scenario can't break yours.

## Quality bar

- The scenario name reads like a product guarantee ("Notes · a member's note
  reaches another member live"), not a test id.
- The test reads as a spec top-to-bottom; a reviewer should understand the
  journey and the guarantee without running it.
- Assert outcomes the user cares about, not implementation details. No
  tautologies (don't assert what the setup already guarantees). Assert on
  values, not booleans — `expect(list).toContain(x)`, never
  `expect(list.includes(x)).toBe(true)` — so failures show the data.
- Keep it deterministic: no sleeps; wait on conditions (`waitForNotes` /
  `waitForPresence`).
