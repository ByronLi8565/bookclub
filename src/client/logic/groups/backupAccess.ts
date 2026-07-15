import { Directory, Filesystem } from "@capacitor/filesystem";
import {
  BookclubArchiveError,
  decodeBookclubArchive,
  MAX_BOOKCLUB_ARCHIVE_BYTES,
} from "../../../shared/backups/bookclubArchive.ts";
import { isNative } from "../net/api.ts";
import { downloadFile } from "../files/browserDownload.ts";
import type { ApiResult } from "./groupClient.ts";

function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => reject(reader.error), { once: true });
    reader.addEventListener("load", () => resolve(String(reader.result).split(",", 2)[1] ?? ""), {
      once: true,
    });
    reader.readAsDataURL(file);
  });
}

export async function saveGroupBackup(file: File): Promise<ApiResult<{ name: string }>> {
  if (isNative) {
    try {
      await Filesystem.writeFile({
        path: file.name,
        data: await base64(file),
        directory: Directory.Documents,
      });
    } catch {
      return { ok: false, error: "save_failed" };
    }
  } else {
    downloadFile(file);
  }
  return { ok: true, value: { name: file.name } };
}

export async function previewGroupBackup(file: File) {
  if (file.size > MAX_BOOKCLUB_ARCHIVE_BYTES) {
    return { ok: false, error: BookclubArchiveError.TooLarge } as const;
  }
  return decodeBookclubArchive(new Uint8Array(await file.arrayBuffer()));
}
