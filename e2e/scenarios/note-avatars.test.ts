import { expect } from "vitest";
import { scenario } from "../src/scenario.ts";

// A note's author picture is displayed by joining three public surfaces the
// client already relies on: the avatar the member uploads (PUT /me/avatar), the
// note they post (NoteAgent websocket, server-stamped to their id), and the
// group roster that carries each member's avatarImageId. The UI resolves an
// author's picture as avatar-of(roster[note.author.id].avatarImageId). This
// drives that whole chain and proves the resolved URL serves the exact image
// the author uploaded — i.e. the picture that will render on their note.

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

    // 1. The member uploads a profile picture.
    const upload = await api.request(author, "/me/avatar", {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: ONE_PIXEL_PNG,
    });
    expect(upload.status, "a member can upload a profile picture").toBe(201);
    const avatar = (await upload.json()) as { id: string; contentType: string; size: number };

    // 2. They post a note; the server stamps it to their identity.
    const session = await notes.connect(group.groupId, author);
    ctx.onCleanup(() => session.close());
    const { noteId } = await session.addNote("portrait-book", "The opening chapter grabbed me.");
    const delivered = await session.waitForNotes((all) => all.some((n) => n.id === noteId), {
      label: "authored note is broadcast",
    });
    const note = delivered.find((n) => n.id === noteId)!;
    expect(note.author.id, "the note is server-stamped to its author").toBe(author.user.id);

    // 3. The roster the client renders from carries that author's avatar id —
    //    this is the join the UI uses to pick a picture for the note.
    const view = await api.request(author, `/groups/${ref}`);
    expect(view.status, "a member can read the group roster").toBe(200);
    const { members } = (await view.json()) as {
      members: { id: string; avatarImageId?: string }[];
    };
    const authorEntry = members.find((m) => m.id === note.author.id);
    expect(
      authorEntry?.avatarImageId,
      "the note author's roster entry points at their upload",
    ).toBe(avatar.id);

    // 4. The avatar URL the UI builds for that note (/users/:id/avatar/:imageId)
    //    serves exactly the picture that was uploaded.
    const shown = await api.request(author, `/users/${note.author.id}/avatar/${avatar.id}`);
    expect(shown.status, "the note's avatar URL serves the image").toBe(200);
    expect(shown.headers.get("Content-Type"), "it is served as an image").toBe("image/png");
    expect(
      new Uint8Array(await shown.arrayBuffer()),
      "the displayed avatar bytes are the uploaded picture",
    ).toEqual(ONE_PIXEL_PNG);
  },
);
