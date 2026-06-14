import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const dir = "info_cards";
const title = process.argv[2] ?? "Untitled";
const author = process.argv[3] ?? "Byron Li";

await mkdir(dir, { recursive: true });

const next =
  Math.max(
    0,
    ...(await readdir(dir))
      .map((name) => /^info_(\d+)\.md$/u.exec(name)?.[1])
      .filter(Boolean)
      .map(Number),
  ) + 1;
const path = join(dir, `info_${next}.md`);
const date = new Date().toISOString();

await writeFile(
  path,
  `TITLE: ${title}\nAUTHOR: ${author}\nDATE: ${date}\n\n"Write the info card content here."\n`,
  { flag: "wx" },
);

console.log(path);
