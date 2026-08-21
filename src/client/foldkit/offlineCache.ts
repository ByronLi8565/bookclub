import { Schema } from "effect";
import { PublicUser } from "../../shared/http/compatibility.ts";
import { decode } from "../../shared/schema.ts";
import { GroupSummary, Membership, RosterEntry } from "../../shared/types/groups.ts";
import { readLocal, removeLocal, writeLocal } from "../logic/storage.ts";

/**
 * What the server last told this device, under the keys the React client wrote,
 * so a reader's cache survives the cutover rather than starting empty.
 *
 * Every entry is a copy of a server answer and never the source of truth: a
 * server that answers overwrites it, and only a server that never answered is
 * answered from here. That is what lets the app open on a train showing the
 * clubs you have, instead of the sign-in page it would show with no cache.
 *
 * Anything that fails to decode is treated as absent. A cache written by an
 * older release must never be able to crash the app that reads it.
 */

const SESSION_KEY = "bookclub.session.user";
const groupsKey = (userId: string): string => `bookclub.groups.${userId}`;
const groupViewKey = (userId: string, groupRef: string): string =>
  `bookclub.groupview.${userId}.${groupRef}`;

export type CachedUser = typeof PublicUser.Type;

export const cachedSessionUser = (): CachedUser | null =>
  decode(PublicUser, readLocal<unknown>(SESSION_KEY));

export const rememberSessionUser = (user: CachedUser): void => {
  writeLocal(SESSION_KEY, user);
};

export const forgetSessionUser = (): void => {
  removeLocal(SESSION_KEY);
};

const CachedGroups = Schema.Array(GroupSummary);

export const cachedGroups = (userId: string): readonly GroupSummary[] =>
  decode(CachedGroups, readLocal<unknown>(groupsKey(userId))) ?? [];

export const rememberGroups = (userId: string, groups: readonly GroupSummary[]): void => {
  writeLocal(groupsKey(userId), groups);
};

export const CachedGroupView = Schema.Struct({
  group: GroupSummary,
  membership: Membership,
  members: Schema.Array(RosterEntry),
});
export type CachedGroupView = typeof CachedGroupView.Type;

export const cachedGroupView = (userId: string, groupRef: string): CachedGroupView | null =>
  decode(CachedGroupView, readLocal<unknown>(groupViewKey(userId, groupRef)));

export const rememberGroupView = (
  userId: string,
  groupRef: string,
  view: CachedGroupView,
): void => {
  writeLocal(groupViewKey(userId, groupRef), view);
};
