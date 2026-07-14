import { ulid } from "ulidx";
import { expect } from "vitest";
import { scenario } from "../src/scenario.ts";

scenario(
  "Notes · two members converge through reply, edit, replay, and delete",
  {},
  async (ctx) => {
    const api = ctx.need("api");
    const notes = ctx.need("notes");

    const owner = await api.newIdentity({ label: "owner" });
    const reader = await api.newIdentity({ label: "reader" });
    const group = await api.createGroup(owner, "Note Lifecycle Club");
    const ref = api.refFor(group);
    await api.join(reader, ref, await api.inviteLink(owner, ref));

    const ownerSession = await notes.connect(group.groupId, owner);
    ctx.onCleanup(() => ownerSession.close());
    const readerSession = await notes.connect(group.groupId, reader);
    ctx.onCleanup(() => readerSession.close());

    const { noteId: parentId } = await ownerSession.addNote("shared-book", "First draft");
    await readerSession.waitForNotes((all) => all.some((note) => note.id === parentId), {
      label: "the owner's note reaches the reader",
    });

    const replyId = ulid();
    const replyOp = {
      opId: ulid(),
      kind: "reply" as const,
      noteId: replyId,
      sourceId: "shared-book",
      parent: parentId,
      body: "Reader response",
      createdAt: new Date().toISOString(),
    };
    const replyResult = await readerSession.applyOperations([replyOp]);
    expect(replyResult, "the reader's reply is accepted").toEqual({
      appliedOpIds: [replyOp.opId],
      rejectedOps: [],
    });

    const deliveredReply = await ownerSession.waitForNotes(
      (all) => all.some((note) => note.id === replyId),
      { label: "the reply reaches the owner" },
    );
    expect(
      deliveredReply.find((note) => note.id === replyId),
      "the reply keeps its thread relationship and is stamped to the reader",
    ).toMatchObject({ parent: parentId, body: "Reader response", author: { id: reader.user.id } });

    const replayResult = await readerSession.applyOperations([replyOp]);
    expect(replayResult, "replaying an acknowledged operation is an idempotent success").toEqual({
      appliedOpIds: [replyOp.opId],
      rejectedOps: [],
    });
    expect(
      readerSession.notes().filter((note) => note.id === replyId),
      "the replay does not duplicate the reply",
    ).toHaveLength(1);

    const forbiddenEdit = {
      opId: ulid(),
      kind: "edit" as const,
      noteId: parentId,
      body: "Reader overwrote the owner",
      at: new Date(Date.now() + 1_000).toISOString(),
    };
    expect(
      await readerSession.applyOperations([forbiddenEdit]),
      "a member cannot edit another member's note",
    ).toEqual({
      appliedOpIds: [],
      rejectedOps: [{ opId: forbiddenEdit.opId, reason: "forbidden" }],
    });

    const ownerEdit = {
      opId: ulid(),
      kind: "edit" as const,
      noteId: parentId,
      body: "Owner revision",
      at: new Date(Date.now() + 2_000).toISOString(),
    };
    await ownerSession.applyOperations([ownerEdit]);
    const edited = await readerSession.waitForNotes(
      (all) => all.some((note) => note.id === parentId && note.body === "Owner revision"),
      { label: "the owner's edit reaches the reader" },
    );
    expect(
      edited.find((note) => note.id === parentId)?.version,
      "the shared note advances to its next revision",
    ).toBe(2);

    const removeOp = {
      opId: ulid(),
      kind: "remove" as const,
      noteId: parentId,
      at: new Date(Date.now() + 3_000).toISOString(),
    };
    await ownerSession.applyOperations([removeOp]);
    const afterDelete = await readerSession.waitForNotes(
      (all) => all.some((note) => note.id === parentId && note.deletedAt !== null),
      { label: "the deletion reaches the reader" },
    );
    expect(
      afterDelete.find((note) => note.id === parentId),
      "a parent with replies remains as a tombstone so the conversation stays intact",
    ).toMatchObject({ id: parentId, deletedAt: removeOp.at, version: 3 });
    expect(
      afterDelete.find((note) => note.id === replyId)?.body,
      "deleting the parent preserves the reader's reply",
    ).toBe("Reader response");
  },
);
