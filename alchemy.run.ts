import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import type { AuthAgent } from "./src/server/state/AuthAgent";
import type { GroupAgent } from "./src/server/state/GroupAgent";
import type { GroupRegistry } from "./src/server/state/GroupRegistry";
import type { NoteAgent } from "./src/server/state/NoteAgent";

export default Alchemy.Stack(
  "bookclub",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const books = yield* Cloudflare.R2Bucket("BOOKS", { name: "bookclub-books" });
    const backups = yield* Cloudflare.R2Bucket("BACKUPS", { name: "bookclub-do-backups" });

    const site = yield* Cloudflare.Vite("bookclub", {
      url: true,
      domain: "bookclub.byron.land",
      compatibility: { flags: ["nodejs_compat"] },
      assets: { htmlHandling: "auto-trailing-slash", notFoundHandling: "single-page-application" },
      // Back up all Durable Object state to R2 every 6 hours.
      crons: ["0 */6 * * *"],
      env: {
        NoteAgent: Cloudflare.DurableObjectNamespace<NoteAgent>("NoteAgent"),
        AuthAgent: Cloudflare.DurableObjectNamespace<AuthAgent>("AuthAgent"),
        GroupAgent: Cloudflare.DurableObjectNamespace<GroupAgent>("GroupAgent"),
        GroupRegistry: Cloudflare.DurableObjectNamespace<GroupRegistry>("GroupRegistry"),
        BOOKS: books,
        BACKUPS: backups,
        SESSION_HMAC_SECRET: Config.redacted("SESSION_HMAC_SECRET"),
        ADMIN_EMAIL: Config.string("ADMIN_EMAIL").pipe(Config.withDefault("byron.li@yale.edu")),
        EMAIL: Cloudflare.SendEmail("EMAIL"),
        EMAIL_FROM: Config.string("EMAIL_FROM"),
      },
    });

    return { url: site.url };
  }),
);
