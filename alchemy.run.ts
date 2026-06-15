import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import type { AuthAgent } from "./src/server/agents/AuthAgent.ts";
import type { GroupAgent } from "./src/server/agents/GroupAgent.ts";
import type { GroupRegistry } from "./src/server/agents/GroupRegistry.ts";
import type { NoteAgent } from "./src/server/agents/NoteAgent.ts";

export default Alchemy.Stack(
  "bookclub",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const books = yield* Cloudflare.R2Bucket("BOOKS", { name: "bookclub-books" });

    const site = yield* Cloudflare.Vite("bookclub", {
      url: true,
      domain: "bookclub.byron.land",
      compatibility: { flags: ["nodejs_compat"] },
      assets: { htmlHandling: "auto-trailing-slash", notFoundHandling: "single-page-application" },
      env: {
        NoteAgent: Cloudflare.DurableObjectNamespace<NoteAgent>("NoteAgent"),
        AuthAgent: Cloudflare.DurableObjectNamespace<AuthAgent>("AuthAgent"),
        GroupAgent: Cloudflare.DurableObjectNamespace<GroupAgent>("GroupAgent"),
        GroupRegistry: Cloudflare.DurableObjectNamespace<GroupRegistry>("GroupRegistry"),
        BOOKS: books,
        SESSION_HMAC_SECRET: Config.redacted("SESSION_HMAC_SECRET"),
        EMAIL: Cloudflare.SendEmail("EMAIL"),
        EMAIL_FROM: Config.string("EMAIL_FROM"),
      },
    });

    return { url: site.url };
  }),
);
