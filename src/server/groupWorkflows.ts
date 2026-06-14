import { getAgentByName } from "agents";
import { monotonicFactory } from "ulidx";
import { getBook, storeBook } from "./books.ts";
import { sendInvite } from "./email.ts";
import type { Env } from "./env.ts";
import type { GroupRole, GroupSummary, Identity, RosterEntry } from "./GroupAgent.ts";
import { REGISTRY_ID } from "./GroupRegistry.ts";
import { currentIdentity } from "./identity.ts";
import { normalizeEmail } from "./http.ts";
import { parseName } from "./names.ts";

const ulid = monotonicFactory();

export type WorkflowResult<T> = { ok: true; value: T } | WorkflowFailure;

export interface WorkflowFailure {
  ok: false;
  status: number;
  error: string;
  reason?: string;
}

type Membership = { isMember: boolean; role: GroupRole | null };

function fail(status: number, error: string, reason?: string): WorkflowFailure {
  return reason === undefined ? { ok: false, status, error } : { ok: false, status, error, reason };
}

async function requireIdentity(env: Env, request: Request): Promise<WorkflowResult<Identity>> {
  const me = await currentIdentity(request, env);
  return me ? { ok: true, value: me } : fail(401, "unauthenticated");
}

async function resolveGroup(env: Env, rawName: string) {
  const parsed = parseName(rawName);
  if (!parsed.ok) return null;
  const registry = await getAgentByName(env.GroupRegistry, REGISTRY_ID);
  const groupId = await registry.resolve(parsed.name.key);
  if (!groupId) return null;
  return getAgentByName(env.GroupAgent, groupId);
}

async function requireGroup(env: Env, rawName: string) {
  const group = await resolveGroup(env, rawName);
  if (!group) return fail(404, "not_found");
  const summary = await group.getSummary();
  if (!summary) return fail(404, "not_found");
  return { ok: true as const, group, summary };
}

function renameFailure(reason: string): WorkflowFailure {
  if (reason === "not_member") return fail(403, "not_member");
  if (reason === "empty") return fail(400, "empty");
  return fail(404, reason);
}

export async function listMyGroups(
  env: Env,
  request: Request,
): Promise<WorkflowResult<{ groups: GroupSummary[] }>> {
  const me = await requireIdentity(env, request);
  if (!me.ok) return me;
  const auth = await getAgentByName(env.AuthAgent, me.value.email);
  const groupIds = await auth.getGroupIds();
  const summaries = await Promise.all(
    groupIds.map(async (id) => (await getAgentByName(env.GroupAgent, id)).getSummary()),
  );
  return { ok: true, value: { groups: summaries.filter((s) => s !== null) } };
}

export async function createGroup(
  env: Env,
  request: Request,
  rawName: unknown,
): Promise<WorkflowResult<{ group: GroupSummary }>> {
  const me = await requireIdentity(env, request);
  if (!me.ok) return me;
  const parsed = parseName(rawName);
  if (!parsed.ok) return fail(400, "invalid_name", parsed.error);

  const group = await getAgentByName(env.GroupAgent, ulid());
  const result = await group.create(parsed.name, me.value);
  if (!result.ok) {
    if (result.reason === "name_taken") return fail(409, "name_taken");
    return fail(409, result.reason);
  }
  return { ok: true, value: { group: result.summary } };
}

export async function resolveGroupView(
  env: Env,
  request: Request,
  rawName: string,
): Promise<
  WorkflowResult<{ group: GroupSummary; membership: Membership; members: RosterEntry[] }>
> {
  const me = await requireIdentity(env, request);
  if (!me.ok) return me;
  const resolved = await requireGroup(env, rawName);
  if (!resolved.ok) return resolved;

  const membership = await resolved.group.membership(me.value.id);
  const members = membership.isMember ? await resolved.group.roster() : [];
  return { ok: true, value: { group: resolved.summary, membership, members } };
}

export async function inviteLink(
  env: Env,
  request: Request,
  rawName: string,
  rotate: boolean,
): Promise<WorkflowResult<{ token: string; link: string }>> {
  const me = await requireIdentity(env, request);
  if (!me.ok) return me;
  const resolved = await requireGroup(env, rawName);
  if (!resolved.ok) return resolved;

  const result = rotate
    ? await resolved.group.rotateOpenInvite(me.value.id)
    : await resolved.group.ensureOpenInvite(me.value.id);
  if (!result.ok) {
    if (result.reason === "not_owner") return fail(403, "not_owner");
    return fail(404, result.reason);
  }

  const origin = new URL(request.url).origin;
  return {
    ok: true,
    value: {
      token: result.token,
      link: `${origin}/${resolved.summary.name}?invite=${result.token}`,
    },
  };
}

export async function renameGroupTitle(
  env: Env,
  request: Request,
  rawName: string,
  title: unknown,
): Promise<WorkflowResult<{ group: GroupSummary }>> {
  const me = await requireIdentity(env, request);
  if (!me.ok) return me;
  if (typeof title !== "string") return fail(400, "invalid_request");
  const resolved = await requireGroup(env, rawName);
  if (!resolved.ok) return resolved;

  const result = await resolved.group.renameGroup(me.value.id, title);
  return result.ok ? { ok: true, value: { group: result.summary } } : renameFailure(result.reason);
}

export async function renameBookTitle(
  env: Env,
  request: Request,
  rawName: string,
  sourceId: unknown,
  title: unknown,
): Promise<WorkflowResult<{ group: GroupSummary }>> {
  const me = await requireIdentity(env, request);
  if (!me.ok) return me;
  if (typeof sourceId !== "string" || typeof title !== "string") {
    return fail(400, "invalid_request");
  }
  const resolved = await requireGroup(env, rawName);
  if (!resolved.ok) return resolved;

  const result = await resolved.group.renameBook(me.value.id, sourceId, title);
  return result.ok ? { ok: true, value: { group: result.summary } } : renameFailure(result.reason);
}

export async function inviteByEmail(
  env: Env,
  request: Request,
  rawName: string,
  rawEmail: unknown,
): Promise<WorkflowResult<null>> {
  const me = await requireIdentity(env, request);
  if (!me.ok) return me;
  const email = normalizeEmail(rawEmail);
  if (!email) return fail(400, "invalid_email");
  const resolved = await requireGroup(env, rawName);
  if (!resolved.ok) return resolved;

  const result = await resolved.group.invite(me.value.id, email);
  if (!result.ok) {
    if (result.reason === "not_owner") return fail(403, "not_owner");
    return fail(404, result.reason);
  }

  const origin = new URL(request.url).origin;
  const link = `${origin}/${resolved.summary.name}?invite=${result.token}`;
  await sendInvite(env, email, resolved.summary.displayName, link);
  return { ok: true, value: null };
}

export async function redeemInvite(
  env: Env,
  request: Request,
  rawName: string,
  token: unknown,
): Promise<WorkflowResult<{ group: GroupSummary }>> {
  const me = await requireIdentity(env, request);
  if (!me.ok) return me;
  if (typeof token !== "string" || token === "") return fail(400, "invalid_request");
  const resolved = await requireGroup(env, rawName);
  if (!resolved.ok) return resolved;

  const result = await resolved.group.redeem(token, me.value);
  if (!result.ok) {
    if (result.reason === "not_found") return fail(404, "not_found");
    return fail(403, result.reason);
  }
  return { ok: true, value: { group: result.summary } };
}

export async function uploadBook(
  env: Env,
  request: Request,
  rawName: string,
): Promise<WorkflowResult<{ hash: string }>> {
  const me = await requireIdentity(env, request);
  if (!me.ok) return me;
  const resolved = await requireGroup(env, rawName);
  if (!resolved.ok) return resolved;
  if (resolved.summary.ownerId !== me.value.id) return fail(403, "not_owner");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return fail(400, "empty");

  const hash = await storeBook(env, bytes);
  await resolved.group.addSource(me.value.id, hash);
  return { ok: true, value: { hash } };
}

export async function fetchBook(
  env: Env,
  request: Request,
  rawName: string,
): Promise<WorkflowResult<{ hash: string; object: R2ObjectBody }>> {
  const me = await requireIdentity(env, request);
  if (!me.ok) return me;
  const resolved = await requireGroup(env, rawName);
  if (!resolved.ok) return resolved;
  const { isMember } = await resolved.group.membership(me.value.id);
  if (!isMember) return fail(403, "forbidden");

  const hash = resolved.summary.sources[0];
  if (!hash) return fail(404, "no_book");
  const object = await getBook(env, hash);
  if (!object) return fail(404, "no_book");
  return { ok: true, value: { hash, object } };
}
