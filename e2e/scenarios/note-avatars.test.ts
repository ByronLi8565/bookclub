import { expect } from "vitest";
import { scenario } from "../src/scenario.ts";

const ONE_PIXEL_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0xff,
  0x7f, 0x00, 0x09, 0xfb, 0x03, 0xfd, 0x05, 0x43, 0x45, 0xca, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

scenario(
  "Notes · an author's uploaded picture is the avatar shown on their note",
  {},
  async (ctx) => {
    const api = ctx.need("api");
    const notes = ctx.need("notes");

    const author = await api.newIdentity({ label: "author" });
    const group = await api.createGroup(author, "Portrait Reading Club");
    const ref = api.refFor(group);

    const upload = await api.request(author, "/me/avatar", {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: ONE_PIXEL_PNG,
    });
    expect(upload.status, "a member can upload a profile picture").toBe(201);
    // SAFETY: the successful avatar upload response returns its persisted metadata.
    const avatar = (await upload.json()) as { id: string; contentType: string; size: number };

    const session = await notes.connect(group.groupId, author);
    ctx.onCleanup(() => session.close());
    const { noteId } = await session.addNote("portrait-book", "The opening chapter grabbed me.");
    const delivered = await session.waitForNotes((all) => all.some((n) => n.id === noteId), {
      label: "authored note is broadcast",
    });
    const note = delivered.find((n) => n.id === noteId)!;
    expect(note.author.id, "the note is server-stamped to its author").toBe(author.user.id);

    const view = await api.request(author, `/groups/${ref}`);
    expect(view.status, "a member can read the group roster").toBe(200);
    // SAFETY: the successful members response uses the scenario's asserted member envelope.
    const { members } = (await view.json()) as {
      members: { id: string; avatarImageId?: string }[];
    };
    const authorEntry = members.find((m) => m.id === note.author.id);
    expect(
      authorEntry?.avatarImageId,
      "the note author's roster entry points at their upload",
    ).toBe(avatar.id);

    const shown = await api.request(author, `/users/${note.author.id}/avatar/${avatar.id}`);
    expect(shown.status, "the note's avatar URL serves the image").toBe(200);
    expect(shown.headers.get("Content-Type"), "it is served as an image").toBe("image/png");
    expect(
      new Uint8Array(await shown.arrayBuffer()),
      "the displayed avatar bytes are the uploaded picture",
    ).toEqual(ONE_PIXEL_PNG);
  },
);
