import { getAgentByName } from "agents";
import { Effect } from "effect";
import { HttpApi, HttpApiBuilder, HttpApiGroup } from "effect/unstable/httpapi";
import { AccountsHttp } from "../../shared/http/accounts.ts";
import { BadRequest, Forbidden, InternalError, NotFound } from "../../shared/http/errors.ts";
import { Authentication, CurrentIdentity } from "./authentication.ts";
import { CloudflareEnv } from "./cloudflare.ts";
import type { StoredReadingPosition } from "../../shared/types/readingPositions.ts";

const MigratedAccountsHttp = HttpApiGroup.make("migratedAccounts")
  .add(
    AccountsHttp.endpoints.prefs,
    AccountsHttp.endpoints.setPrefs,
    AccountsHttp.endpoints.readingPosition,
    AccountsHttp.endpoints.setReadingPosition,
  )
  .middleware(Authentication);

export const AccountsApi = HttpApi.make("bookclub-accounts").add(MigratedAccountsHttp);

const attempt = <A>(evaluate: () => Promise<A>) =>
  Effect.tryPromise({ try: evaluate, catch: () => new InternalError({ error: "internal_error" }) });

const sourceKind = Effect.fn("AccountHandlers.sourceKind")(function* (
  groupId: string,
  sourceId: string,
) {
  const env = yield* CloudflareEnv;
  const me = yield* CurrentIdentity;
  const group = yield* attempt(() => getAgentByName(env.GroupAgent, groupId));
  const membership = yield* attempt(() => group.membership(me.id));
  if (!membership.isMember) return yield* new Forbidden({ error: "not_member" });
  const summary = yield* attempt(() => group.getSummary());
  const meta = summary?.sourceMeta[sourceId];
  if (!summary || !summary.sources.includes(sourceId) || !meta) {
    return yield* new NotFound({ error: "bad_source" });
  }
  return meta.kind;
});

export const AccountHandlers = HttpApiBuilder.group(AccountsApi, "migratedAccounts", (handlers) =>
  handlers
    .handle("prefs", () =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        return { prefs: yield* attempt(() => auth.getPrefs()) };
      }),
    )
    .handle("setPrefs", ({ payload }) =>
      Effect.gen(function* () {
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        return { prefs: yield* attempt(() => auth.setPrefs(payload.prefs)) };
      }),
    )
    .handle("readingPosition", ({ query }) =>
      Effect.gen(function* () {
        yield* sourceKind(query.groupId, query.sourceId);
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        return {
          position: yield* attempt<StoredReadingPosition | null>(async () =>
            auth.getReadingPosition(query.groupId, query.sourceId),
          ),
        };
      }),
    )
    .handle("setReadingPosition", ({ payload }) =>
      Effect.gen(function* () {
        const { position } = payload;
        if (position.groupId !== payload.groupId || position.sourceId !== payload.sourceId) {
          return yield* new BadRequest({ error: "invalid_request" });
        }
        const kind = yield* sourceKind(position.groupId, position.sourceId);
        if (kind !== position.kind) return yield* new BadRequest({ error: "kind_mismatch" });
        const env = yield* CloudflareEnv;
        const me = yield* CurrentIdentity;
        const auth = yield* attempt(() => getAgentByName(env.AuthAgent, me.email));
        return {
          position: yield* attempt<StoredReadingPosition>(async () =>
            auth.setReadingPosition(position),
          ),
        };
      }),
    ),
);
