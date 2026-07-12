import { Directory, Filesystem } from "@capacitor/filesystem";
import {
  BookclubArchiveError,
  decodeBookclubArchive,
  MAX_BOOKCLUB_ARCHIVE_BYTES,
} from "../../../shared/backups/bookclubArchive.ts";
import { isNative } from "../net/api.ts";
import type { ApiResult } from "./groupClient.ts";

function triggerBrowserDownload(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

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
    triggerBrowserDownload(file);
  }
  return { ok: true, value: { name: file.name } };
}

export async function previewGroupBackup(file: File) {
  if (file.size > MAX_BOOKCLUB_ARCHIVE_BYTES) {
    return { ok: false, error: BookclubArchiveError.TooLarge } as const;
  }
  return decodeBookclubArchive(new Uint8Array(await file.arrayBuffer()));
}
