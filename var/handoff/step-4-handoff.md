# Step 4 handoff — networking: Agent of record (live multi-client sync)

This document is the implementation brief for Step 4 of bookclub: moving notes
off local-only IndexedDB and onto a Cloudflare Durable Object, with live
multi-client sync. Steps 1–3 (single-user notes, Lexical editor, threaded
replies) are complete and on disk. No networking code has been written yet.

## What changed from the original 4–7 roadmap

The original plan split networking into Step 4 (DO + `seq` + WebSocket sync),
Steps 5–6 (resilience/offline), and Step 7 (auth/groups). After evaluating sync
wrappers, we adopted the **Cloudflare Agents SDK** (`agents`), which provides a
Durable Object with built-in state persistence and real-time WebSocket sync.
This **collapses original Steps 4+5+6** into one data-layer swap and **removes
`seq` and all hand-rolled WebSocket / reconnect / delta code** from the plan.

Revised sequence:

- **Step 4 (this doc):** Agent of record — live sync, drop IndexedDB.
- **Step 5:** Polish & resilience UX (optimistic apply, connection/loading/empty
  states, error surfaces; move bodies to Agent SQL only if `{notes}` state
  measurably grows).
- **Step 6 (was 7):** Identity — real auth + groups, replacing the `"local"`
  author; membership / access control gated at connect/routing.

## Working principles (unchanged from Step 2)

- **Testable at every step.** No automated suite; the maintainer verifies
  manually. Each sub-step lands in a working, demoable state with explicit
  acceptance criteria. Never leave the tree half-migrated.
- **Polish the first time.** Carry the reader discipline forward (font reflow,
  two-page spread, split-pane drag, recompute on `relocated` + rAF resize, stable
  empty states).
- **Minimal, understandable code.** Small modules, clear seams, no speculative
  abstraction. Prefer deleting code to adding flags.
- **Idiomatic Effect** at the React boundary (`useRun`); do not force Effect into
  the Agents SDK internals — wrap it at the boundary like we did with Lexical.
- **Hard cutover, no fallbacks.** When a thing is replaced, delete the old thing
  outright. IndexedDB is removed, not kept as a dual path.
- **House style.** Sentence-case comments. `oxfmt --check`, `oxlint`, and
  `tsc --noEmit` all clean before a sub-step is done. Tooling: bun, Alchemy v2
  (`alchemy@next`), Effect 4 beta, epub.js, Lexical, and now `agents`.

## Decisions (settled with the maintainer)

1. **Sync layer: Cloudflare Agents SDK** (`agents`), built on PartyServer. Use
   `this.setState` for auto-persist + auto-broadcast; `useAgent` on the client.
   Write as little sync code as possible.
2. **Mutations are callable server methods**, not client whole-array `setState`.
   Each method does a read-modify-write of `this.state.notes` inside the
   single-threaded DO, then `setState`. This serializes concurrent writes and
   avoids lost-write clobbering. **Clients render broadcast state only.**
3. **Drop `seq`.** Whole-state broadcast needs no delta/ordering protocol;
   `createdAt` orders the list and `version`/`editedAt` carry edit semantics. The
   model never actually had `seq`, so this just means we don't add it.
4. **DO granularity: per Source (book hash).** Agent `name = sourceId`. Anyone
   with the book annotates together. Group routing is deferred to Step 6.
5. **No pre-spike.** Build Step 4 straight through; resolve the Alchemy + Worker
   + DO wiring in-step (it is the main integration risk — see below).
6. **Keep client-built notes.** `createNote` / `createReply` still build the
   `Note` client-side (uuid, `author:"local"`, `createdAt`). The Agent stores and
   orders; server-assigned ULIDs stay deferred.

## Biggest integration risk

Today `alchemy.run.ts` publishes assets only (`Cloudflare.Vite`, SPA, no Worker
or DO). Step 4 needs a Worker that serves **both** the Vite assets **and** hosts
the `NoteAgent` Durable Object (SQLite-backed → `new_sqlite_classes` migration)
with its namespace binding. Whether that is one Worker (extend the Vite worker's
`fetch` with `routeAgentRequest`) or a separate Worker, and how Alchemy v2
declares the DO namespace + migration, is the thing most likely to bite. Resolve
this first within the step.

## Server (new `src/server/`)

```
src/server/
  NoteAgent.ts     Agent<Env, { notes: Note[] }>, keyed by sourceId
  worker.ts        fetch: routeAgentRequest(request, env) -> else assets
```

- `NoteAgent extends Agent<Env, NoteState>` where `NoteState = { notes: Note[] }`,
  `initialState = { notes: [] }`.
- Callable methods (server-authoritative read-modify-write + `setState`):
  - `addNote(note: Note)`
  - `addReply(reply: Note)`
  - `editNote(id: string, body: string)` — bumps `version`, sets `editedAt`.
  - `removeNote(id: string)` — single-note delete; replies orphan (no cascade),
    consistent with the Step 3 panel rendering.
  - `rebindHighlight(noteId, highlightId, cfi)` — for the locate-rebind path.
- Confirm the exact `agents` callable API during build (decorator vs. method
  invocation via the client). Validate inputs minimally (`validateStateChange`
  or in-method guards).

## Client deltas

```
src/client/
  storage/NoteStore.ts   DELETED (Agent is the store)
  storage/db.ts          DELETED (IndexedDB gone)
  storage/hashFile.ts    UNCHANGED (still used to compute sourceId)
  runtime.tsx            keep useRun for pure effects; layer no longer provides NoteStore
  App.tsx                read notes from useAgent; mutations call Agent methods
  notes.ts               UNCHANGED (createNote/createReply still build the Note)
  highlights.ts          UNCHANGED (capture/locate)
  ui/*                   UNCHANGED (render-only; props already flow from App)
```

- `useAgent({ agent: "note-agent", name: sourceId, onStateUpdate })` supplies
  `notes`; App renders them (no local list mutation).
- Mutations: `onComposeSave` → `addNote`; `onReplySave` → `addReply`;
  `onEditSave` → `editNote`; `onDelete` → `removeNote`.
- The `locateHighlight` rebind on load stays client-side (operating on the
  Agent-provided notes), painting highlights and writing drifted cfis back via
  `rebindHighlight`.
- `runtime.tsx`: `captureHighlight`, `locateHighlight`, `hashFile` are pure
  Effects with no requirements; `useRun` stays, but `AppServices` no longer
  includes `NoteStore`.

## Acceptance criteria

- Two browsers open the same book (same `sourceId`): creating, replying to,
  editing, and deleting a note in one appears live in the other with **no
  reload**.
- State survives a refresh (persisted in the DO).
- No IndexedDB usage remains.
- Highlights still locate/rebind on load and persist their (possibly rebound)
  cfis through the Agent.
- `oxfmt --check`, `oxlint`, `tsc --noEmit` clean; `vite build` succeeds.

## Committing with jj (workflow for this step and onward)

We use **Jujutsu (`jj`)**, not plain git. Land Step 4 as several small,
logically-scoped commits rather than one mega-commit (see the prior
"Restructure files and polish" commit for the anti-pattern to avoid). Suggested
split:

1. Server: `NoteAgent` + `worker.ts`.
2. Alchemy wiring: Worker + DO namespace + migration + assets.
3. Client cutover: `useAgent`, mutation calls, delete `NoteStore`/`db.ts`.
4. Highlight rebind path through the Agent.

jj mechanics:

- Describe the current change as you finish a logical unit:
  `jj describe -m "step 4: NoteAgent + callable mutations"`.
- Start the next logical unit on top: `jj new`.
- Inspect: `jj status`, `jj log`, `jj diff`.
- If work for two units landed in one change, split it: `jj split -i` (pick hunks
  in the diff editor). Note: already-pushed commits are immutable — rewriting
  them needs `--ignore-immutable`, and avoid that unless intentionally
  rewriting shared history.
- Push: bookmark stays on `@-` after `jj new`; update and push with
  `jj bookmark set main -r @-` then `jj git push`. (Remote `origin` is
  `https://github.com/ByronLi8565/bookclub.git`.)
- Keep each commit green (`oxfmt --check && oxlint && tsc --noEmit`).
