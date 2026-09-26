import { Effect } from "effect";
import { randomId } from "../../shared/crypto.ts";
import { publicIdFromGroupUrl } from "../../shared/groupUrls.ts";
import { NotFound, ServiceUnavailable } from "../../shared/http/errors.ts";
import type { GroupSummary } from "../../shared/types/groups.ts";
import type { GroupAgent } from "../state/GroupAgent.ts";
import { groupAgent, groupRegistry, io } from "./io.ts";

const PUBLIC_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export const reservePublicId = Effect.fn("reservePublicId")(function* (groupId: string) {
  const registry = yield* groupRegistry;
  for (let tries = 0; tries < 10; tries++) {
    const publicId = randomId(6, PUBLIC_ID_ALPHABET);
    const result = yield* io(() => registry.reservePublicId(publicId, groupId));
    if (result.ok) return publicId;
  }
  return yield* new ServiceUnavailable({ error: "id_exhausted" });
});

/** A club URL's `slug-publicId` ref, resolved to the Group behind it. */
export const resolveGroup = Effect.fn("resolveGroup")(function* (groupRef: string) {
  const publicId = publicIdFromGroupUrl(groupRef);
  if (!publicId) return yield* new NotFound({ error: "not_found" });
  const registry = yield* groupRegistry;
  const groupId = yield* io(() => registry.resolvePublicId(publicId));
  if (!groupId) return yield* new NotFound({ error: "not_found" });
  const group = yield* groupAgent(groupId);
  const summary = yield* io(() => group.getSummary());
  if (!summary) return yield* new NotFound({ error: "not_found" });
  return { group, summary };
});

/** Clubs created before public URLs existed receive one the first time they are listed. */
export const ensurePublicUrl = Effect.fn("ensurePublicUrl")(function* (
  group: DurableObjectStub<GroupAgent>,
  summary: GroupSummary,
) {
  if (summary.publicId !== "") return summary;
  const publicId = yield* reservePublicId(summary.groupId);
  return (yield* io(() => group.assignPublicUrl(publicId))) ?? summary;
});
