import { canonicalEmail } from "../shared/email.ts";
import type { Env } from "./env.ts";
import type { AuthState } from "./state/AuthAgent.ts";
import type { GroupState } from "./state/GroupAgent.ts";
import type { NoteState } from "./state/NoteAgent.ts";
import type { RegistryState } from "./state/GroupRegistry.ts";

// A full, self-contained snapshot of every Durable Object's state. Durable
// Objects are the only home for clubs, notes, memberships and user records, so
// this is the canonical thing to back up. Books live in R2 already.
export interface BackupSnapshot {
  version: 1;
  takenAt: string;
  registry: RegistryState;
  groups: Record<string, GroupState>;
  notes: Record<string, NoteState>;
  auth: Record<string, AuthState>;
}

export interface BackupResult {
  key: string;
  takenAt: string;
  groups: number;
  notes: number;
  auth: number;
  pruned: number;
}

const PREFIX = "snapshots/";
const LATEST_KEY = `${PREFIX}latest.json`;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// The registry maps slugs and public ids to group ids; the union of both is the
// set of all live groups.
function groupIdsFrom(registry: RegistryState): string[] {
  const ids = new Set<string>();
  for (const id of Object.values(registry.names ?? {})) ids.add(id);
  for (const id of Object.values(registry.publicIds ?? {})) ids.add(id);
  return [...ids];
}

export async function collectSnapshot(env: Env): Promise<BackupSnapshot> {
  // Lazy import keeps the cloudflare:-scheme `agents` module out of the
  // top-level graph so the pure retention helpers stay unit-testable.
  const { getAgentByName } = await import("agents");
  const { REGISTRY_ID } = await import("./state/GroupRegistry.ts");
  const registry = await (await getAgentByName(env.GroupRegistry, REGISTRY_ID)).exportState();

  const groups: Record<string, GroupState> = {};
  const notes: Record<string, NoteState> = {};
  const emails = new Set<string>();

  for (const id of groupIdsFrom(registry)) {
    const groupState = await (await getAgentByName(env.GroupAgent, id)).exportState();
    if (groupState.groupId === "") continue; // never-created / empty instance
    groups[id] = groupState;
    for (const member of Object.values(groupState.members)) {
      emails.add(canonicalEmail(member.email));
    }
    notes[id] = await (await getAgentByName(env.NoteAgent, id)).exportState();
  }

  const auth: Record<string, AuthState> = {};
  for (const email of emails) {
    auth[email] = await (await getAgentByName(env.AuthAgent, email)).exportState();
  }

  return { version: 1, takenAt: new Date().toISOString(), registry, groups, notes, auth };
}

export async function backupAll(env: Env): Promise<BackupResult> {
  const snapshot = await collectSnapshot(env);
  const body = JSON.stringify(snapshot);
  const metadata = { httpMetadata: { contentType: "application/json" } };
  // Timestamped key for history; `latest.json` always points at the newest.
  const key = `${PREFIX}${snapshot.takenAt.replaceAll(":", "-")}.json`;
  await env.BACKUPS.put(key, body, metadata);
  await env.BACKUPS.put(LATEST_KEY, body, metadata);
  // Best-effort retention sweep; a prune failure must never fail the backup.
  let pruned = 0;
  try {
    pruned = (await pruneBackups(env)).deleted;
  } catch (error) {
    console.error("backup prune failed", error);
  }
  return {
    key,
    takenAt: snapshot.takenAt,
    groups: Object.keys(snapshot.groups).length,
    notes: Object.keys(snapshot.notes).length,
    auth: Object.keys(snapshot.auth).length,
    pruned,
  };
}

// R2 list() truncates at 1000 objects per page; without pagination both
// listing and pruning would silently ignore everything past the first page.
async function listSnapshotObjects(env: Env): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.BACKUPS.list({ prefix: PREFIX, cursor });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects.filter((o) => o.key !== LATEST_KEY);
}

export interface BackupListing {
  key: string;
  size: number;
  uploaded: string;
}

export async function listBackups(env: Env): Promise<BackupListing[]> {
  return (await listSnapshotObjects(env))
    .map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded.toISOString() }))
    .toSorted((a, b) => b.key.localeCompare(a.key));
}

export interface RetainableBackup {
  key: string;
  uploaded: number;
}

// Tiered retention: keep every snapshot from the last 24h, then one per
// calendar-day bucket for the past week, one per 7-day bucket for the past
// month, and discard anything older. Returns the keys that should be deleted.
export function selectStaleBackups(backups: RetainableBackup[], now: number): string[] {
  const newestFirst = backups.toSorted((a, b) => b.uploaded - a.uploaded);
  const seenDailyBuckets = new Set<number>();
  const seenWeeklyBuckets = new Set<number>();
  const stale: string[] = [];

  for (const backup of newestFirst) {
    const age = now - backup.uploaded;
    if (age < DAY_MS) continue; // recent: keep all
    if (age < 7 * DAY_MS) {
      // Keep the newest snapshot in each day bucket, drop the rest.
      const bucket = Math.floor(backup.uploaded / DAY_MS);
      if (seenDailyBuckets.has(bucket)) stale.push(backup.key);
      else seenDailyBuckets.add(bucket);
    } else if (age < 30 * DAY_MS) {
      // Keep the newest snapshot in each week bucket, drop the rest.
      const bucket = Math.floor(backup.uploaded / (7 * DAY_MS));
      if (seenWeeklyBuckets.has(bucket)) stale.push(backup.key);
      else seenWeeklyBuckets.add(bucket);
    } else {
      stale.push(backup.key); // older than 30 days
    }
  }
  return stale;
}

export interface PruneResult {
  deleted: number;
  kept: number;
}

export async function pruneBackups(env: Env): Promise<PruneResult> {
  const objects = await listSnapshotObjects(env);
  const stale = selectStaleBackups(
    objects.map((o) => ({ key: o.key, uploaded: o.uploaded.getTime() })),
    Date.now(),
  );
  if (stale.length > 0) await env.BACKUPS.delete(stale);
  return { deleted: stale.length, kept: objects.length - stale.length };
}

export interface RestoreResult {
  key: string;
  takenAt: string;
  groups: number;
  notes: number;
  auth: number;
}

// Writes a snapshot back into the Durable Objects. This overwrites current
// state for every key present in the snapshot, so callers must gate it.
export async function restoreFrom(env: Env, key: string): Promise<RestoreResult> {
  const object = await env.BACKUPS.get(key);
  if (!object) throw new Error(`backup not found: ${key}`);
  const snapshot = (await object.json()) as BackupSnapshot;

  const { getAgentByName } = await import("agents");
  const { REGISTRY_ID } = await import("./state/GroupRegistry.ts");
  await (await getAgentByName(env.GroupRegistry, REGISTRY_ID)).importState(snapshot.registry);
  for (const [id, state] of Object.entries(snapshot.groups)) {
    await (await getAgentByName(env.GroupAgent, id)).importState(state);
  }
  for (const [id, state] of Object.entries(snapshot.notes)) {
    await (await getAgentByName(env.NoteAgent, id)).importState(state);
  }
  for (const [email, state] of Object.entries(snapshot.auth)) {
    await (await getAgentByName(env.AuthAgent, email)).importState(state);
  }

  return {
    key,
    takenAt: snapshot.takenAt,
    groups: Object.keys(snapshot.groups).length,
    notes: Object.keys(snapshot.notes).length,
    auth: Object.keys(snapshot.auth).length,
  };
}
