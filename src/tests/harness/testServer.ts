import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { Plugin } from "vite";

// Dev-only static server for test fixtures. The reader harness (and the bombadil
// reader spec) load a public-domain epub through `?book=/fixtures/<name>`; this
// maps that URL onto the real file in `assets/` so the fixture lives in exactly
// one place. Scoped to the dev server, so it never reaches the production build.
const TYPES: Record<string, string> = { ".epub": "application/epub+zip" };

export function fixtureServer(assetsDir: string): Plugin {
  return {
    name: "bookclub:fixture-server",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/fixtures", (req, res, next) => {
        // Strip any query string and prevent path traversal out of assetsDir.
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
