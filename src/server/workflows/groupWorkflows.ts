import { getAgentByName } from "agents";
import { Effect } from "effect";
import { monotonicFactory } from "ulidx";
import type { GroupSummary, Membership, RosterEntry } from "../../shared/types/groups.ts";
import { currentSource, sourceById } from "../../shared/sources.ts";
import { getSource, storeSource } from "../services/sources.ts";
import { sendInvite } from "../services/email.ts";
import type { Env } from "../env.ts";
import type {
  AddSourceResult,
  CreateResult,
  GroupAgent,
  Identity,
  InviteLinkResult,
  InviteResult,
  RedeemResult,
  RenameGroupResult,
  RenameResult,
} from "../agents/GroupAgent.ts";
import { REGISTRY_ID } from "../agents/GroupRegistry.ts";
import { currentIdentity } from "../auth/cookies.ts";
import { normalizeEmail } from "../util/http.ts";
import { parseName } from "../util/names.ts";

const ulid = monotonicFactory();

export type WorkflowResult<T> = { ok: true; value: T } | WorkflowFailure;

export interface WorkflowFailure {
  ok: false;
  status: number;
  error: string;
  reason?: string;
}

// The workflows talk to a GroupAgent over its Durable Object stub. The stub's
// own RPC types flatten discriminated-union results (every `{ ok }` branch is
// merged), so we instead derive the caller's view directly from GroupAgent:
// each method keeps its real signature and result union, only the return is
// promisified. GroupAgent stays the single source of truth for these shapes.
type Async<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K];
};
type Group = Async<GroupAgent>;
type ResolvedGroup = { group: Group; summary: GroupSummary };
type WorkflowEffect<T> = Effect.Effect<T, WorkflowFailure>;

function fail(status: number, error: string, reason?: string): WorkflowFailure {
  return reason === undefined ? { ok: false, status, error } : { ok: false, status, error, reason };
}

const succeed = <T>(value: T): WorkflowResult<T> => ({ ok: true, value });

const tryPromise = <T>(evaluate: () => T | PromiseLike<T>): Effect.Effect<Awaited<T>> =>
  Effect.promise(() => Promise.resolve(evaluate()));

const requireIdentity = (env: Env, request: Request): WorkflowEffect<Identity> =>
  Effect.gen(function* () {
    const me = yield* tryPromise(() => currentIdentity(request, env));
    if (!me) return yield* Effect.fail(fail(401, "unauthenticated"));
    return me;
  });

const resolveGroup = (env: Env, rawName: string): WorkflowEffect<Group> =>
  Effect.gen(function* () {
    const parsed = parseName(rawName);
    if (!parsed.ok) return yield* Effect.fail(fail(404, "not_found"));
    const registry = yield* tryPromise(() => getAgentByName(env.GroupRegistry, REGISTRY_ID));
    const groupId = yield* tryPromise(() => registry.resolve(parsed.name.key));
    if (!groupId) return yield* Effect.fail(fail(404, "not_found"));
    return (yield* tryPromise(() => getAgentByName(env.GroupAgent, groupId))) as unknown as Group;
  });

const requireGroup = (env: Env, rawName: string): WorkflowEffect<ResolvedGroup> =>
  Effect.gen(function* () {
    const group = yield* resolveGroup(env, rawName);
    const summary = yield* tryPromise(() => group.getSummary());
    if (!summary) return yield* Effect.fail(fail(404, "not_found"));
    return { group, summary };
  });

// Every failure `reason` a GroupAgent method can return. Extracted from the
// agent's own result types so a new reason forces an entry in REASON_STATUS.
type FailureReason = Extract<
  | CreateResult
  | InviteResult
  | InviteLinkResult
  | RedeemResult
  | AddSourceResult
  | RenameResult
  | RenameGroupResult,
  { ok: false }
>["reason"];

// The single home for "what HTTP status does this domain failure map to".
const REASON_STATUS: Record<FailureReason, number> = {
  exists: 409,
  name_taken: 409,
  not_member: 403,
  not_found: 404,
  empty: 400,
  bad_source: 404,
  bad_invite: 403,
  wrong_email: 403,
};

const failReason = (reason: FailureReason): WorkflowFailure => fail(REASON_STATUS[reason], reason);

const runWorkflow = <T>(workflow: WorkflowEffect<T>): Promise<WorkflowResult<T>> => {
  return Effect.runPromise(
    workflow.pipe(Effect.match({ onFailure: (failure) => failure, onSuccess: succeed })),
  );
};

export function listMyGroups(
  env: Env,
  request: Request,
): Promise<WorkflowResult<{ groups: GroupSummary[] }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const auth = yield* tryPromise(() => getAgentByName(env.AuthAgent, me.email));
      const groupIds = yield* tryPromise(() => auth.getGroupIds());
      const summaries = yield* Effect.forEach(
        groupIds,
        (id) =>
          Effect.gen(function* () {
            const group = (yield* tryPromise(() =>
              getAgentByName(env.GroupAgent, id),
            )) as unknown as Group;
            return yield* tryPromise(() => group.getSummary());
          }),
        { concurrency: "unbounded" },
      );
      return { groups: summaries.filter((summary) => summary !== null) };
    }),
  );
}

export function createGroup(
  env: Env,
  request: Request,
  rawName: unknown,
): Promise<WorkflowResult<{ group: GroupSummary }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const parsed = parseName(rawName);
      if (!parsed.ok) return yield* Effect.fail(fail(400, "invalid_name", parsed.error));
      const group = (yield* tryPromise(() =>
        getAgentByName(env.GroupAgent, ulid()),
      )) as unknown as Group;
      const result = yield* tryPromise(() => group.create(parsed.name, me));
      if (!result.ok) return yield* Effect.fail(failReason(result.reason));
      return { group: result.summary };
    }),
  );
}

export function resolveGroupView(
  env: Env,
  request: Request,
  rawName: string,
): Promise<
  WorkflowResult<{ group: GroupSummary; membership: Membership; members: RosterEntry[] }>
> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const { group, summary } = yield* requireGroup(env, rawName);
      const membership = yield* tryPromise(() => group.membership(me.id));
      const members = membership.isMember ? yield* tryPromise(() => group.roster()) : [];
      return { group: summary, membership, members };
    }),
  );
}

export function inviteLink(
  env: Env,
  request: Request,
  rawName: string,
  rotate: boolean,
): Promise<WorkflowResult<{ token: string; link: string }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const { group, summary } = yield* requireGroup(env, rawName);
      const result = yield* tryPromise(() =>
        rotate ? group.rotateOpenInvite(me.id) : group.ensureOpenInvite(me.id),
      );
      if (!result.ok) return yield* Effect.fail(failReason(result.reason));
      const origin = new URL(request.url).origin;
      return { token: result.token, link: `${origin}/${summary.name}?invite=${result.token}` };
    }),
  );
}

export function renameGroupTitle(
  env: Env,
  request: Request,
  rawName: string,
  title: unknown,
): Promise<WorkflowResult<{ group: GroupSummary }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      if (typeof title !== "string") return yield* Effect.fail(fail(400, "invalid_request"));
      const { group } = yield* requireGroup(env, rawName);
      const result = yield* tryPromise(() => group.renameGroup(me.id, title));
      if (!result.ok) return yield* Effect.fail(failReason(result.reason));
      return { group: result.summary };
    }),
  );
}

export function renameBookTitle(
  env: Env,
  request: Request,
  rawName: string,
  sourceId: unknown,
  title: unknown,
): Promise<WorkflowResult<{ group: GroupSummary }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      if (typeof sourceId !== "string" || typeof title !== "string") {
        return yield* Effect.fail(fail(400, "invalid_request"));
      }
      const { group } = yield* requireGroup(env, rawName);
      const result = yield* tryPromise(() => group.renameBook(me.id, sourceId, title));
      if (!result.ok) return yield* Effect.fail(failReason(result.reason));
      return { group: result.summary };
    }),
  );
}

export function resolveBookTitle(
  env: Env,
  request: Request,
  rawName: string,
  sourceId: unknown,
  title: unknown,
): Promise<WorkflowResult<{ group: GroupSummary }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      if (typeof sourceId !== "string" || typeof title !== "string") {
        return yield* Effect.fail(fail(400, "invalid_request"));
      }
      const { group } = yield* requireGroup(env, rawName);
      const result = yield* tryPromise(() => group.resolveBookTitle(me.id, sourceId, title));
      if (!result.ok) return yield* Effect.fail(failReason(result.reason));
      return { group: result.summary };
    }),
  );
}

export function inviteByEmail(
  env: Env,
  request: Request,
  rawName: string,
  rawEmail: unknown,
): Promise<WorkflowResult<null>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const email = normalizeEmail(rawEmail);
      if (!email) return yield* Effect.fail(fail(400, "invalid_email"));
      const { group, summary } = yield* requireGroup(env, rawName);
      const result = yield* tryPromise(() => group.invite(me.id, email));
      if (!result.ok) return yield* Effect.fail(failReason(result.reason));
      const origin = new URL(request.url).origin;
      yield* tryPromise(() =>
        sendInvite(
          env,
          email,
          summary.displayName,
          `${origin}/${summary.name}?invite=${result.token}`,
        ),
      );
      return null;
    }),
  );
}

export function redeemInvite(
  env: Env,
  request: Request,
  rawName: string,
  token: unknown,
): Promise<WorkflowResult<{ group: GroupSummary }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      if (typeof token !== "string" || token === "")
        return yield* Effect.fail(fail(400, "invalid_request"));
      const { group } = yield* requireGroup(env, rawName);
      const result = yield* tryPromise(() => group.redeem(token, me));
      if (!result.ok) return yield* Effect.fail(failReason(result.reason));
      return { group: result.summary };
    }),
  );
}

export function uploadSource(
  env: Env,
  request: Request,
  rawName: string,
): Promise<WorkflowResult<{ hash: string }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const { group } = yield* requireGroup(env, rawName);
      const { isMember } = yield* tryPromise(() => group.membership(me.id));
      if (!isMember) return yield* Effect.fail(fail(403, "not_member"));
      const bytes = yield* tryPromise(() => request.arrayBuffer());
      const contentType = request.headers.get("Content-Type");
      const stored = yield* tryPromise(() => storeSource(env, bytes, contentType));
      if (!stored.ok) {
        return yield* Effect.fail(
          stored.reason === "empty" ? fail(400, "empty") : fail(400, "unsupported_type"),
        );
      }
      const rawTitle = request.headers.get("X-Source-Title");
      const title = rawTitle ? decodeURIComponent(rawTitle).trim() || null : null;
      const rawAuthor = request.headers.get("X-Source-Author");
      const author = rawAuthor ? decodeURIComponent(rawAuthor).trim() || null : null;
      const { id, kind, contentType: storedType, size } = stored.source;
      yield* tryPromise(() =>
        group.addSource(me.id, id, { kind, contentType: storedType, size, title, author }),
      );
      return { hash: id };
    }),
  );
}

export function fetchSource(
  env: Env,
  request: Request,
  rawName: string,
  sourceId?: string | null,
): Promise<WorkflowResult<{ hash: string; contentType: string; object: R2ObjectBody }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const { group, summary } = yield* requireGroup(env, rawName);
      const { isMember } = yield* tryPromise(() => group.membership(me.id));
      if (!isMember) return yield* Effect.fail(fail(403, "forbidden"));
      const source = sourceId ? sourceById(summary, sourceId) : currentSource(summary);
      if (!source) return yield* Effect.fail(fail(404, "no_book"));
      const object = yield* tryPromise(() => getSource(env, source.id));
      if (!object) return yield* Effect.fail(fail(404, "no_book"));
      return { hash: source.id, contentType: source.contentType, object };
    }),
  );
}
