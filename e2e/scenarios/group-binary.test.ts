import { expect } from "vitest";
import { scenario } from "../src/scenario.ts";
import { UPLOAD_FILE_FIELD } from "../../src/shared/http/uploads.ts";

const upload = (bytes: Uint8Array, type: string, name: string): FormData => {
  const form = new FormData();
  form.append(UPLOAD_FILE_FIELD, new Blob([bytes], { type }), name);
  return form;
};

const TINY_PDF = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

scenario(
  "Groups · book and backup downloads preserve bytes and transport headers",
  {},
  async (ctx) => {
    const api = ctx.need("api");
    const owner = await api.newIdentity({ label: "owner" });
    const group = await api.createGroup(owner, "Binary Compatibility Club");
    const ref = api.refFor(group);

    const uploaded = await api.request(owner, `/groups/${ref}/book`, {
      method: "PUT",
      headers: { "X-Source-Title": "Tiny PDF" },
      body: upload(TINY_PDF, "application/pdf", "tiny.pdf"),
    });
    expect(uploaded.status, "a PDF upload keeps its success status").toBe(200);
    // SAFETY: the successful upload response contains the content-addressed source id.
    const { hash: sourceId } = (await uploaded.json()) as { hash: string };

    const downloaded = await api.request(
      owner,
      `/groups/${ref}/book?sourceId=${encodeURIComponent(sourceId)}`,
    );
    expect(downloaded.status, "the selected source downloads successfully").toBe(200);
    expect(
      downloaded.headers.get("content-type"),
      "the source keeps its normalized media type",
    ).toBe("application/pdf");
    expect(
      downloaded.headers.get("x-source-id"),
      "the response identifies the selected source",
    ).toBe(sourceId);
    expect(
      new Uint8Array(await downloaded.arrayBuffer()),
      "the source bytes round-trip unchanged",
    ).toEqual(TINY_PDF);

    const backup = await api.request(owner, `/groups/${ref}/backup`);
    expect(backup.status, "the owner can export a club backup").toBe(200);
    expect(
      backup.headers.get("content-type"),
      "the backup uses its stable archive media type",
    ).toBe("application/vnd.bookclub.backup+zip");
    expect(backup.headers.get("content-disposition"), "the backup remains an attachment").toMatch(
      /^attachment; filename=".+\.bookclub"$/u,
    );
    expect(backup.headers.get("cache-control"), "backup bytes are never cached").toBe("no-store");
    expect(backup.headers.get("x-content-type-options"), "backup downloads disable sniffing").toBe(
      "nosniff",
    );
    const backupBytes = new Uint8Array(await backup.arrayBuffer());
    expect(backupBytes.byteLength, "the archive has a non-empty ZIP body").toBeGreaterThan(0);

    const restored = await api.request(owner, `/groups/${ref}/backup`, {
      method: "PUT",
      body: upload(backupBytes, "application/vnd.bookclub.backup+zip", "club.bookclub"),
    });
    expect(restored.status, "the exported bytes can be restored through the matching route").toBe(
      200,
    );
    expect(await restored.json(), "the restore response reports imported content").toMatchObject({
      notes: 0,
      images: 0,
    });

    const removed = await api.request(owner, `/groups/${ref}/book/${sourceId}`, {
      method: "DELETE",
    });
    expect(removed.status, "the uploaded source can be deleted").toBe(200);
    const missing = await api.request(
      owner,
      `/groups/${ref}/book?sourceId=${encodeURIComponent(sourceId)}`,
    );
    expect(missing.status, "deleted source bytes are no longer downloadable").toBe(404);
  },
);
