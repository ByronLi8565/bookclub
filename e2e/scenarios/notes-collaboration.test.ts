import { expect } from "vitest";
import { scenario } from "../src/scenario.ts";

scenario("Notes · a member's note reaches another member live, server-stamped", {}, async (ctx) => {
  const api = ctx.need("api");
  const notes = ctx.need("notes");

  const owner = await api.newIdentity({ label: "owner" });
  const reader = await api.newIdentity({ label: "reader" });
  const group = await api.createGroup(owner, "Moby-Dick Club");
  const ref = api.refFor(group);
  const token = await api.inviteLink(owner, ref);
  const joined = await api.join(reader, ref, token);
  expect(joined.memberCount, "both users are members after the join").toBe(2);

  const readerSession = await notes.connect(group.groupId, reader);
  ctx.onCleanup(() => readerSession.close());
  const ownerSession = await notes.connect(group.groupId, owner);
  ctx.onCleanup(() => ownerSession.close());

  const peers = await readerSession.waitForPresence((p) => p.length === 2, {
    label: "both members present",
  });
  expect(
    [...peers].map((p) => p.role).toSorted(),
    "presence carries one owner and one member",
  ).toEqual(["member", "owner"]);

  const { noteId } = await ownerSession.addNote("moby-dick", "Call me Ishmael.");

  const delivered = await readerSession.waitForNotes((all) => all.some((n) => n.id === noteId), {
    label: "owner's note delivered to the reader",
  });
  const note = delivered.find((n) => n.id === noteId)!;
  expect(note.body).toBe("Call me Ishmael.");
  expect(note.author.id, "author is stamped server-side to the owner").toBe(owner.user.id);
  expect(note.sourceId, "the note is tagged with its book").toBe("moby-dick");
  expect(note.seq, "the group-global sequence starts at 1").toBe(1);
});
