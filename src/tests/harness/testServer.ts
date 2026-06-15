import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { Plugin } from "vite";

const TYPES: Record<string, string> = {
  ".epub": "application/epub+zip",
  ".pdf": "application/pdf",
};

export function fixtureServer(assetsDir: string): Plugin {
  return {
    name: "bookclub:fixture-server",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/fixtures", (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url ?? "").split("?")[0]!)).replace(
          /^(\.\.[/\\])+/u,
          "",
        );
        const file = join(assetsDir, rel);
        void stat(file)
          .then((s) => {
            if (!s.isFile()) return next();
            res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
            createReadStream(file).pipe(res);
          })
          .catch(() => next());
      });
    },
  };
}
