import { expect } from "vitest";
import { scenario } from "../src/scenario.ts";
import { UPLOAD_FILE_FIELD } from "../../src/shared/http/uploads.ts";

const ONE_PIXEL_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xff, 0xff, 0xff,
  0x7f, 0x00, 0x09, 0xfb, 0x03, 0xfd, 0x05, 0x43, 0x45, 0xca, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
  0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

scenario("Notes · an uploaded image is private to club members", {}, async (ctx) => {
  const api = ctx.need("api");
  const owner = await api.newIdentity({ label: "owner" });
  const reader = await api.newIdentity({ label: "reader" });
  const outsider = await api.newIdentity({ label: "outsider" });
  const group = await api.createGroup(owner, "Image Notes Club");
  const ref = api.refFor(group);
  const token = await api.inviteLink(owner, ref);
  await api.join(reader, ref, token);

  const imageForm = new FormData();
  imageForm.append(
    UPLOAD_FILE_FIELD,
    new Blob([ONE_PIXEL_PNG], { type: "image/png" }),
    "pixel.png",
  );
  const upload = await api.request(owner, `/groups/${ref}/images`, {
    method: "POST",
    body: imageForm,
  });
  expect(upload.status, "a club member can upload a note image").toBe(201);
  // SAFETY: the successful note-image upload response returns its persisted metadata.
  const image = (await upload.json()) as { id: string; contentType: string; size: number };
  expect(image.contentType, "the uploaded object keeps its image content type").toBe("image/png");
  expect(image.size, "the stored object records the uploaded byte size").toBe(
    ONE_PIXEL_PNG.byteLength,
  );

  const memberFetch = await api.request(reader, `/groups/${ref}/images/${image.id}`);
  expect(memberFetch.status, "another club member can fetch the uploaded note image").toBe(200);
  expect(memberFetch.headers.get("Content-Type"), "image responses are served as images").toBe(
    "image/png",
  );
  expect(
    new Uint8Array(await memberFetch.arrayBuffer()),
    "the fetched image bytes are the uploaded image bytes",
  ).toEqual(ONE_PIXEL_PNG);

  const outsiderFetch = await api.request(outsider, `/groups/${ref}/images/${image.id}`);
  expect(outsiderFetch.status, "non-members cannot fetch private note images").toBe(403);
});
