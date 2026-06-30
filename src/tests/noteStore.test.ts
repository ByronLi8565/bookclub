import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import type { NoteOp } from "../shared/types/notes.ts";
import { applyOperations, emptyNoteState } from "../shared/notes/noteState.ts";
import { NoteStore } from "../client/logic/notes/noteStore.ts";

const author = { id: "u1", name: "Alice" };
const run = <A>(e: Effect.Effect<A>) => Effect.runPromise(e);

function addOp(opId: string, noteId: string, body: string): NoteOp {
  return {
    opId,
    kind: "add",
    noteId,
    sourceId: "src",
    body,
    highlights: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("NoteStore", () => {
  it("renders an enqueued op optimistically", async () => {
    const store = new NoteStore("g1", author, false);
    await run(store.enqueue(addOp("op1", "n1", "hi")));
    const view = store.getView();
    expect(view.notes.map((n) => n.body)).toEqual(["hi"]);
    expect(view.pendingCount).toBe(1);
    expect(view.pendingNoteIds.has("n1")).toBe(true);
  });

  it("preserves unsynced pending ops when a foreign server snapshot arrives", async () => {
    const store = new NoteStore("g1", author, false);
    await run(store.enqueue(addOp("op1", "mine", "my note")));

    // Another user's note arrives; it does NOT contain my still-unsynced op.
    const theirs = applyOperations(emptyNoteState(), [addOp("opX", "theirs", "their note")], {
      author: { id: "u2", name: "Bob" },
      isOwner: false,
    }).state;
    await run(store.ingestServer(theirs));

    const view = store.getView();
    // Both my optimistic note and theirs are visible; nothing dropped.
    expect(view.notes.map((n) => n.body).toSorted()).toEqual(["my note", "their note"]);
    expect(view.pendingCount).toBe(1);
  });

  it("prunes pending ops the server reports as applied", async () => {
    const store = new NoteStore("g1", author, false);
    await run(store.enqueue(addOp("op1", "n1", "hi")));

    const confirmed = applyOperations(emptyNoteState(), [addOp("op1", "n1", "hi")], {
      author,
      isOwner: false,
    }).state;
    await run(store.ingestServer(confirmed));

    expect(store.getView().pendingCount).toBe(0);
    expect(store.hasPending()).toBe(false);
    expect(store.getView().notes.map((n) => n.body)).toEqual(["hi"]);
  });

  it("moves rejected ops to the failed set instead of dropping them", async () => {
    const store = new NoteStore("g1", author, false);
    await run(store.enqueue(addOp("op1", "n1", "ok")));
    await run(store.enqueue(addOp("op2", "n2", "bad")));

    await run(
      store.settle({ appliedOpIds: ["op1"], rejectedOps: [{ opId: "op2", reason: "forbidden" }] }),
    );

    const view = store.getView();
    expect(view.pendingCount).toBe(0);
    expect(view.failedNoteIds.has("n2")).toBe(true);
  });

  it("merges a sibling tab's queue by opId without duplication", async () => {
    const store = new NoteStore("g1", author, false);
    await run(store.enqueue(addOp("op1", "n1", "a")));
    await run(store.mergeForeign([addOp("op1", "n1", "a"), addOp("op2", "n2", "b")]));

    const view = store.getView();
    expect(view.pendingCount).toBe(2);
    expect(view.notes.map((n) => n.body).toSorted()).toEqual(["a", "b"]);
  });
});
