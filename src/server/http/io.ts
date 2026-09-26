import { getAgentByName } from "agents";
import { Effect } from "effect";
import { Conflict, Forbidden, InternalError, NotFound } from "../../shared/http/errors.ts";
import { GroupFailureReason } from "../../shared/types/groups.ts";
import { REGISTRY_ID } from "../state/registryId.ts";
import { CloudflareEnv } from "./cloudflare.ts";

/**
 * Crosses one I/O boundary: a Durable Object RPC, R2, or an email send. The
 * cause is logged here, where it is still known, and the caller sees only the
 * shared `InternalError`, never a platform exception.
 */
export const io = <F extends () => unknown>(
  evaluate: F,
): Effect.Effect<Awaited<ReturnType<F>>, InternalError> =>
  Effect.tryPromise({
    // SAFETY: awaiting the callback's result yields exactly its awaited return type.
    try: () => Promise.resolve(evaluate()) as Promise<Awaited<ReturnType<F>>>,
    catch: (cause) => cause,
  }).pipe(
    Effect.tapError((cause) => Effect.logError("bookclub I/O failed", cause)),
    Effect.mapError(() => new InternalError({ error: "internal_error" })),
  );

export const authAgent = (email: string) =>
  Effect.flatMap(CloudflareEnv, (env) => io(() => getAgentByName(env.AuthAgent, email)));
export const groupAgent = (groupId: string) =>
  Effect.flatMap(CloudflareEnv, (env) => io(() => getAgentByName(env.GroupAgent, groupId)));
export const noteAgent = (groupId: string) =>
  Effect.flatMap(CloudflareEnv, (env) => io(() => getAgentByName(env.NoteAgent, groupId)));
export const groupRegistry = Effect.flatMap(CloudflareEnv, (env) =>
  io(() => getAgentByName(env.GroupRegistry, REGISTRY_ID)),
);

export const groupFailure = (reason: GroupFailureReason) => {
  switch (reason) {
    case GroupFailureReason.Exists:
      return new Conflict({ error: reason });
    case GroupFailureReason.NotFound:
    case GroupFailureReason.BadSource:
    case GroupFailureReason.BadMember:
      return new NotFound({ error: reason });
    default:
      return new Forbidden({ error: reason });
  }
};

type GroupAnswer = { ok: true } | { ok: false; reason: GroupFailureReason };

/** Calls a Group Control Plane method and translates its refusal, once, into the wire failure. */
export const groupCall = <F extends () => unknown>(evaluate: F) =>
  Effect.flatMap(io(evaluate), (answer) => {
    // SAFETY: every Group Control Plane method answers with a GroupResult.
    const result = answer as GroupAnswer;
    if (!result.ok) return Effect.fail(groupFailure(result.reason));
    // SAFETY: `ok` was just checked, which selects the success arm of the answer.
    return Effect.succeed(answer as Extract<Awaited<ReturnType<F>>, { ok: true }>);
  });
