import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import type { NoteAgent } from "./src/server/NoteAgent.ts";

export default Alchemy.Stack(
  "bookclub",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const site = yield* Cloudflare.Vite("bookclub", {
      url: true,
      compatibility: { flags: ["nodejs_compat"] },
      assets: { htmlHandling: "auto-trailing-slash", notFoundHandling: "single-page-application" },
      bindings: { NoteAgent: Cloudflare.DurableObjectNamespace<NoteAgent>("NoteAgent") },
    });

    return { url: site.url };
  }),
);
