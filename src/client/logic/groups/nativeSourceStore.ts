import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

// Native uses app-container storage plus metadata sidecars; WKWebView IndexedDB is evictable.
const DIR = Directory.Data;
const FOLDER = "books";

const blobPath = (sourceId: string): string => `${FOLDER}/${encodeURIComponent(sourceId)}`;
const metaPath = (sourceId: string): string => `${blobPath(sourceId)}.meta`;

interface SourceMeta {
  name: string;
  type: string;
  size: number;
}

async function ensureFolder(): Promise<void> {
  try {
    await Filesystem.mkdir({ path: FOLDER, directory: DIR, recursive: true });
  } catch {}
}

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    });
    reader.addEventListener("error", () => reject(reader.error ?? new Error("read_failed")));
    reader.readAsDataURL(file);
  });
}

async function base64ToBlob(base64: string, type: string): Promise<Blob> {
  const res = await fetch(`data:${type || "application/octet-stream"};base64,${base64}`);
  return res.blob();
}

export async function putNativeSource(sourceId: string, file: File): Promise<void> {
  await ensureFolder();
  const data = await fileToBase64(file);
  await Filesystem.writeFile({ path: blobPath(sourceId), data, directory: DIR });
  const meta: SourceMeta = { name: file.name, type: file.type, size: file.size };
  await Filesystem.writeFile({
    path: metaPath(sourceId),
    data: JSON.stringify(meta),
    directory: DIR,
    encoding: Encoding.UTF8,
  });
}

export async function getNativeSource(sourceId: string): Promise<File | null> {
  let base64: string;
  try {
    base64 = (await Filesystem.readFile({ path: blobPath(sourceId), directory: DIR }))
      .data as string;
  } catch {
    return null;
  }
  const raw = (
    await Filesystem.readFile({ path: metaPath(sourceId), directory: DIR, encoding: Encoding.UTF8 })
  ).data as string;
  const meta = JSON.parse(raw) as SourceMeta;
  const blob = await base64ToBlob(base64, meta.type);
  return new File([blob], meta.name, { type: meta.type });
}

export async function deleteNativeSource(sourceId: string): Promise<void> {
  for (const path of [blobPath(sourceId), metaPath(sourceId)]) {
    try {
      await Filesystem.deleteFile({ path, directory: DIR });
    } catch {}
  }
}

export async function nativeSourceSize(sourceId: string): Promise<number | null> {
  try {
    const raw = (
      await Filesystem.readFile({
        path: metaPath(sourceId),
        directory: DIR,
        encoding: Encoding.UTF8,
      })
    ).data as string;
    return (JSON.parse(raw) as SourceMeta).size;
  } catch {
    try {
      return (await Filesystem.stat({ path: blobPath(sourceId), directory: DIR })).size;
    } catch {
      return null;
    }
  }
}
