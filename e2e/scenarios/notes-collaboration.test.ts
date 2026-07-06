import { expect } from "vitest";
import { scenario } from "../src/scenario.ts";

// A book club's whole point: a note one member writes shows up, live, for the
// others reading the same group — with the author stamped by the server, not the
// client (ADR 0001), in one room per group (ADR 0002). This drives that promise
// end to end through the public surfaces only: dev-auth login, group + invite +
// join over HTTP, then two authenticated NoteAgent sockets.

scenario("Notes · a member's note reaches another member live, server-stamped", {}, async (ctx) => {
  const api = ctx.need("api");
  const notes = ctx.need("notes");

  // Two real, isolated users; the owner creates a club and the other joins it
  // via an open invite link.
  const owner = await api.newIdentity({ label: "owner" });
  const reader = await api.newIdentity({ label: "reader" });
  const group = await api.createGroup(owner, "Moby-Dick Club");
  const ref = api.refFor(group);
  const token = await api.inviteLink(owner, ref);
  const joined = await api.join(reader, ref, token);
  expect(joined.memberCount, "both users are members after the join").toBe(2);

  // Both open the group's notes room. The reader is listening; the owner writes.
  const readerSession = await notes.connect(group.groupId, reader);
  ctx.onCleanup(() => readerSession.close());
  const ownerSession = await notes.connect(group.groupId, owner);
  ctx.onCleanup(() => ownerSession.close());

  // Presence reflects who is connected, with server-assigned roles.
  const peers = await readerSession.waitForPresence((p) => p.length === 2, {
    label: "both members present",
  });
  expect(
    [...peers].map((p) => p.role).toSorted(),
    "presence carries one owner and one member",
  ).toEqual(["member", "owner"]);

  const { noteId } = await ownerSession.addNote("moby-dick", "Call me Ishmael.");

  // The reader receives the note over its own socket — the live broadcast, not
  // a refetch — with the author stamped from the owner's session, never the payload.
  const delivered = await readerSession.waitForNotes((all) => all.some((n) => n.id === noteId), {
    label: "owner's note delivered to the reader",
  });
  const note = delivered.find((n) => n.id === noteId)!;
  expect(note.body).toBe("Call me Ishmael.");
  expect(note.author.id, "author is stamped server-side to the owner").toBe(owner.user.id);
  expect(note.sourceId, "the note is tagged with its book").toBe("moby-dick");
  expect(note.seq, "the group-global sequence starts at 1").toBe(1);
});
