# 2. Keying the NoteAgent by groupId with group-global numbering

Date: 2026-06-14
Status: Accepted

## Context

Before Step 6 the `NoteAgent` was keyed by `sourceId` (the EPUB content hash):
the agent route `/agents/note-agent/:name` used `name = sourceId`, so everyone
holding the same book bytes landed in the same notes room — no auth, no
membership, and the same book shared one global room across all readers.

Step 6 introduces groups as the unit of collaboration and access control. We had
to decide what a "notes room" is now keyed by, which in turn fixes the scope of
the per-room `seq` counter and the `[[n]]` cross-references built on it.

Options considered:

1. **Keep keying by `sourceId`.** Simplest, but a notes room would still be
   shared by anyone with the book, cutting against group-scoped membership; and
   the same book could not have independent discussions in two different groups.
2. **Key by `groupId + sourceId`** (one room per book _within_ a group). Keeps
   `seq` per-book, but fragments a group's discussion across rooms and blocks the
   future "all of a group's books on one screen" view.
3. **Key by `groupId`** (one room per group, all the group's books inside it).

## Decision

Key the `NoteAgent` by `groupId` (decision 6 in the Step 6 plan). One agent
instance per group holds the notes for **all** of that group's books; each note
is tagged with its `sourceId`. Consequences that follow directly:

- `seq` and `[[n]]` cross-references become **group-global** — sequential and
  shareable across every book the group reads, which is the behaviour we want for
  a single book club's running conversation.
- The same EPUB opened by two different groups yields two independent rooms (keyed
  by the two `groupId`s), each with its own membership and numbering.
- The agent route `/agents/note-agent/:name` now carries `name = groupId`. The
  worker gates that route (session + `GroupAgent.membership`) before
  `routeAgentRequest`, and `NoteAgent.onConnect` re-checks and stamps identity
  (ADR 0001). Non-members reach neither the socket nor its broadcasts.

## Consequences

- **Migration is a wipe** (decision 11): old `sourceId`-keyed rooms and their
  `seq` counters are abandoned. No migration code.
- A group's `seq` spans books, so note `[[n]]` references are unique within the
  group but not within a single book — acceptable and in fact desirable for the
  cross-book "one conversation" model.
- The book a note belongs to must be recoverable from the note's `sourceId` tag
  rather than from the room key; the reader filters/links by `sourceId`.
- All of a group's notes live in one durable object's state. At book-club scale
  this is fine; if a group's note volume ever grew pathological, sharding would
  mean revisiting this key.
