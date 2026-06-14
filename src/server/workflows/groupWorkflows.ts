import { getAgentByName } from "agents";
import { Effect } from "effect";
import { monotonicFactory } from "ulidx";
import type {
  GroupRole,
  GroupSummary,
  RosterEntry,
  SourceMeta,
} from "../../shared/types/groups.ts";
import { currentSource } from "../../shared/sources.ts";
import { getSource, storeSource } from "../services/sources.ts";
import { sendInvite } from "../services/email.ts";
import type { Env } from "../env.ts";
import type { Identity } from "../agents/GroupAgent.ts";
import { REGISTRY_ID } from "../agents/GroupRegistry.ts";
import { currentIdentity } from "../auth/cookies.ts";
import { normalizeEmail } from "../util/http.ts";
import { parseName, type NormalizedName } from "../util/names.ts";

const ulid = monotonicFactory();

export type WorkflowResult<T> = { ok: true; value: T } | WorkflowFailure;

export interface WorkflowFailure {
  ok: false;
  status: number;
  error: string;
  reason?: string;
}

type Membership = { isMember: boolean; role: GroupRole | null };

type Group = {
  getSummary(): GroupSummary | null | Promise<GroupSummary | null>;
  membership(userId: string): Membership | Promise<Membership>;
  roster(): RosterEntry[] | Promise<RosterEntry[]>;
  create(
    name: NormalizedName,
    owner: Identity,
  ):
    | { ok: true; summary: GroupSummary }
    | { ok: false; reason: "exists" | "name_taken" }
    | Promise<{ ok: true; summary: GroupSummary } | { ok: false; reason: "exists" | "name_taken" }>;
  ensureOpenInvite(
    callerId: string,
  ):
    | { ok: true; token: string }
    | { ok: false; reason: "not_owner" | "not_found" }
    | Promise<{ ok: true; token: string } | { ok: false; reason: "not_owner" | "not_found" }>;
  rotateOpenInvite(callerId: string): ReturnType<Group["ensureOpenInvite"]>;
  renameGroup(
    callerId: string,
    title: string,
  ):
    | { ok: true; summary: GroupSummary }
    | { ok: false; reason: "not_member" | "not_found" | "empty" }
    | Promise<
        | { ok: true; summary: GroupSummary }
        | { ok: false; reason: "not_member" | "not_found" | "empty" }
      >;
  renameBook(
    callerId: string,
    sourceId: string,
    title: string,
  ):
    | { ok: true; summary: GroupSummary }
    | { ok: false; reason: "not_member" | "not_found" | "bad_source" | "empty" }
    | Promise<
        | { ok: true; summary: GroupSummary }
        | { ok: false; reason: "not_member" | "not_found" | "bad_source" | "empty" }
      >;
  invite(
    callerId: string,
    email: string,
  ):
    | { ok: true; token: string }
    | { ok: false; reason: "not_owner" | "not_found" }
    | Promise<{ ok: true; token: string } | { ok: false; reason: "not_owner" | "not_found" }>;
  redeem(
    token: string,
    user: Identity,
  ):
    | { ok: true; summary: GroupSummary }
    | { ok: false; reason: "not_found" | "bad_invite" | "wrong_email" }
    | Promise<
        | { ok: true; summary: GroupSummary }
        | { ok: false; reason: "not_found" | "bad_invite" | "wrong_email" }
      >;
  addSource(
    callerId: string,
    sourceId: string,
    meta: SourceMeta,
  ):
    | { ok: true; summary: GroupSummary }
    | { ok: false; reason: "not_owner" | "not_found" }
    | Promise<
        { ok: true; summary: GroupSummary } | { ok: false; reason: "not_owner" | "not_found" }
      >;
};
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
    return (yield* tryPromise(() => getAgentByName(env.GroupAgent, groupId))) as Group;
  });

const requireGroup = (env: Env, rawName: string): WorkflowEffect<ResolvedGroup> =>
  Effect.gen(function* () {
    const group = yield* resolveGroup(env, rawName);
    const summary = yield* tryPromise(() => group.getSummary());
    if (!summary) return yield* Effect.fail(fail(404, "not_found"));
    return { group, summary };
  });

function renameFailure(reason: string): WorkflowFailure {
  if (reason === "not_member") return fail(403, "not_member");
  if (reason === "empty") return fail(400, "empty");
  return fail(404, reason);
}

const runWorkflow = async <T>(workflow: WorkflowEffect<T>): Promise<WorkflowResult<T>> => {
  return Effect.runPromise(
    workflow.pipe(Effect.match({ onFailure: (failure) => failure, onSuccess: succeed })),
  );
};

export async function listMyGroups(
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
            const group = (yield* tryPromise(() => getAgentByName(env.GroupAgent, id))) as Group;
            return yield* tryPromise(() => group.getSummary());
          }),
        { concurrency: "unbounded" },
      );
      return { groups: summaries.filter((summary) => summary !== null) };
    }),
  );
}

export async function createGroup(
  env: Env,
  request: Request,
  rawName: unknown,
): Promise<WorkflowResult<{ group: GroupSummary }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const parsed = parseName(rawName);
      if (!parsed.ok) return yield* Effect.fail(fail(400, "invalid_name", parsed.error));
      const group = (yield* tryPromise(() => getAgentByName(env.GroupAgent, ulid()))) as Group;
      const result = yield* tryPromise(() => group.create(parsed.name, me));
      if (!result.ok) return yield* Effect.fail(fail(409, result.reason));
      return { group: result.summary };
    }),
  );
}

export async function resolveGroupView(
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
      const membership = yield* tryPromise(async () => group.membership(me.id));
      const members = membership.isMember ? yield* tryPromise(async () => group.roster()) : [];
      return { group: summary, membership, members };
    }),
  );
}

export async function inviteLink(
  env: Env,
  request: Request,
  rawName: string,
  rotate: boolean,
): Promise<WorkflowResult<{ token: string; link: string }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const { group, summary } = yield* requireGroup(env, rawName);
      const result = yield* tryPromise(async () =>
        rotate ? group.rotateOpenInvite(me.id) : group.ensureOpenInvite(me.id),
      );
      if (!result.ok) {
        return yield* Effect.fail(
          result.reason === "not_owner" ? fail(403, "not_owner") : fail(404, result.reason),
        );
      }
      const origin = new URL(request.url).origin;
      return { token: result.token, link: `${origin}/${summary.name}?invite=${result.token}` };
    }),
  );
}

export async function renameGroupTitle(
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
      const result = yield* tryPromise(async () => group.renameGroup(me.id, title));
      if (!result.ok) return yield* Effect.fail(renameFailure(result.reason));
      return { group: result.summary };
    }),
  );
}

export async function renameBookTitle(
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
      const result = yield* tryPromise(async () => group.renameBook(me.id, sourceId, title));
      if (!result.ok) return yield* Effect.fail(renameFailure(result.reason));
      return { group: result.summary };
    }),
  );
}

export async function inviteByEmail(
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
      const result = yield* tryPromise(async () => group.invite(me.id, email));
      if (!result.ok) {
        return yield* Effect.fail(
          result.reason === "not_owner" ? fail(403, "not_owner") : fail(404, result.reason),
        );
      }
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

export async function redeemInvite(
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
      if (!result.ok) {
        return yield* Effect.fail(
          result.reason === "not_found" ? fail(404, "not_found") : fail(403, result.reason),
        );
      }
      return { group: result.summary };
    }),
  );
}

export async function uploadSource(
  env: Env,
  request: Request,
  rawName: string,
): Promise<WorkflowResult<{ hash: string }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const { group, summary } = yield* requireGroup(env, rawName);
      if (summary.ownerId !== me.id) return yield* Effect.fail(fail(403, "not_owner"));
      const bytes = yield* tryPromise(() => request.arrayBuffer());
      const contentType = request.headers.get("Content-Type");
      const stored = yield* tryPromise(() => storeSource(env, bytes, contentType));
      if (!stored.ok) {
        return yield* Effect.fail(
          stored.reason === "empty" ? fail(400, "empty") : fail(400, "unsupported_type"),
        );
      }
      const { id, kind, contentType: storedType, size } = stored.source;
      yield* tryPromise(async () =>
        group.addSource(me.id, id, { kind, contentType: storedType, size }),
      );
      return { hash: id };
    }),
  );
}

export async function fetchSource(
  env: Env,
  request: Request,
  rawName: string,
): Promise<WorkflowResult<{ hash: string; contentType: string; object: R2ObjectBody }>> {
  return runWorkflow(
    Effect.gen(function* () {
      const me = yield* requireIdentity(env, request);
      const { group, summary } = yield* requireGroup(env, rawName);
      const { isMember } = yield* tryPromise(async () => group.membership(me.id));
      if (!isMember) return yield* Effect.fail(fail(403, "forbidden"));
      const source = currentSource(summary);
      if (!source) return yield* Effect.fail(fail(404, "no_book"));
      const object = yield* tryPromise(() => getSource(env, source.id));
      if (!object) return yield* Effect.fail(fail(404, "no_book"));
      return { hash: source.id, contentType: source.contentType, object };
    }),
  );
}
