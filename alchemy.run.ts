import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import type { AuthAgent } from "./src/server/AuthAgent.ts";
import type { NoteAgent } from "./src/server/NoteAgent.ts";

export default Alchemy.Stack(
  "bookclub",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const site = yield* Cloudflare.Vite("bookclub", {
      url: true,
      domain: "bookclub.byron.land",
      compatibility: { flags: ["nodejs_compat"] },
      assets: { htmlHandling: "auto-trailing-slash", notFoundHandling: "single-page-application" },
      // `env` is alchemy's binding map for the worker (the build only reads
      // props.env; a `bindings` key is silently ignored).
      env: {
        NoteAgent: Cloudflare.DurableObjectNamespace<NoteAgent>("NoteAgent"),
        AuthAgent: Cloudflare.DurableObjectNamespace<AuthAgent>("AuthAgent"),
        // Resolved from the deploy environment; never committed in plaintext.
        SESSION_HMAC_SECRET: Config.redacted("SESSION_HMAC_SECRET"),
        // Login-code delivery. EMAIL_FROM must be a verified Email Routing
        // sender on a zone you control (see the onboarding notes in the handoff).
        EMAIL: Cloudflare.SendEmail("EMAIL"),
        EMAIL_FROM: Config.string("EMAIL_FROM"),
      },
    });

    return { url: site.url };
  }),
);
