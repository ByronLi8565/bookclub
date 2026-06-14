# 1. Deriving caller identity inside a NoteAgent `@callable`

Date: 2026-06-13
Status: Accepted

## Context

Step 6 (Identity & Groups) requires the server — not the client — to stamp
`Note.author` and to enforce per-caller permissions (edit/delete own note, owner
moderation). Today every mutation is an `@callable` RPC method on `NoteAgent`,
and the method body has no obvious handle on _which_ connected client invoked
it. Trusting a client-supplied user id would let any connected client
impersonate anyone, so the identity must be derived server-side.

The open question this spike resolved: **can a `@callable` method, invoked over
the websocket, determine its originating connection (and thus a trusted
identity) without the client passing it as an argument?**

## Investigation

`agents@0.16.0`, read from `node_modules/agents/dist/index.js`:

- The websocket message handler dispatches RPC inside an `AsyncLocalStorage`
  context populated with `{ agent, connection, request, email }` and then calls
  `methodFn.apply(this, args)` for the callable (index.js ~768-825). So the
  callable body runs _within_ that context.
- `getCurrentAgent()` (exported from `agents`) returns that store:
  `{ agent, connection, request, email }`.
- `Connection` has server-managed `state` / `setState(...)`. The SDK wraps these
  (index.js ~1043-1063). The only client-driven state path is the _agent_ state
  update message (`cf_agent_state`, gated by `isConnectionReadonly`); there is no
  client message that writes a connection's own `state`. Therefore
  `connection.state` is **server-authoritative** and cannot be spoofed by the
  client.
- `onConnect(connection, ctx)` receives `ctx.request`, whose headers include the
  `Cookie` sent on the same-origin websocket handshake (which flows through the
  vite `/agents` proxy in dev and the worker directly in prod).

### Runtime confirmation

A temporary `@callable __whoami()` was added to `NoteAgent`, called twice over
`AgentClient` against `wrangler dev`:

```
call #1: {"hasConnection":true,"connectionId":"926704a6-…","state":{"stamped":"server-only"}}
call #2: {"hasConnection":true,"connectionId":"926704a6-…","state":{"stamped":"server-only"}}
```

i.e. inside the callable `getCurrentAgent().connection` is defined, the
connection id is stable across calls on the same socket, and a server-set
`connection.setState(...)` persists and is readable on later calls. The temp
method was reverted.

## Decision

Derive caller identity from the **connection**, established once at connect:

1. In `NoteAgent.onConnect(connection, ctx)`: read the session cookie from
   `ctx.request`, verify the stateless HMAC session token → `{ userId, name }`,
   look up the caller's group role, and `connection.setState({ userId, name,
role })`. Reject (close) the connection if the session is missing/invalid —
   this also gates reads, since unauthenticated sockets never receive broadcasts.
2. In each mutation `@callable`: read the trusted identity via
   `const { connection } = getCurrentAgent();` then `connection.state`. Stamp
   `author = { id: userId, name }` and enforce permissions (`editNote`
   author-only; `removeNote` author or owner).

`connection.state` is server-authoritative; no client-supplied identity is ever
trusted.

## Consequences

- No fallback (passing/re-verifying a token per mutation) is needed.
- Role is cached on the connection at connect time, so a role change mid-session
  is not seen until reconnect. Accepted for v1.
- `getCurrentAgent().connection` is `undefined` outside a client RPC (alarms,
  scheduled tasks, server-to-server stub calls). All mutations are client RPCs,
  but any future non-RPC writer must supply identity explicitly.
- The membership/session gate also belongs at the worker boundary before
  `routeAgentRequest` (Phase B); `onConnect` is the in-DO enforcement point where
  the connection identity is stamped.
