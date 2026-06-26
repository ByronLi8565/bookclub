interface RawInfoCard {
  path: string;
  raw: string;
}

export interface InfoCard {
  path: string;
  seq: number | null;
  page: InfoCardPage;
  title: string;
  author: string;
  date: string;
  body: string;
}

export type InfoCardPage = "info" | "release";

const rawInfoCards = import.meta.glob("../../../info_cards/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const infoCards: InfoCard[] = Object.entries(rawInfoCards)
  .map(([path, raw]) => parseInfoCard({ path, raw }))
  .toSorted((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));

function parseInfoCard({ path, raw }: RawInfoCard): InfoCard {
  const [headerBlock = "", ...bodyParts] = raw.replaceAll("\r\n", "\n").split(/\n\s*\n/u);
  const headers = new Map<string, string>();
  for (const line of headerBlock.split("\n")) {
    const match = /^(TITLE|AUTHOR|DATE|PAGE):\s*(.*)$/u.exec(line.trim());
    if (match) headers.set(match[1], match[2].trim());
  }

  return {
    path,
    seq: infoSeq(path),
    page: parsePage(headers.get("PAGE")),
    title: headers.get("TITLE") || "Untitled",
    author: headers.get("AUTHOR") || "Unknown",
    date: headers.get("DATE") || "Undated",
    body: unquoteBody(bodyParts.join("\n\n").trim()),
  };
}

function parsePage(value: string | undefined): InfoCardPage {
  return value === "info" ? "info" : "release";
}

function infoSeq(path: string): number | null {
  const match = /info_(\d+)\.md$/u.exec(path);
  return match ? Number(match[1]) : null;
}

function unquoteBody(body: string): string {
  if (body.startsWith('"') && body.endsWith('"') && body.length >= 2) {
    return body.slice(1, -1).trim();
  }
  return body;
}
