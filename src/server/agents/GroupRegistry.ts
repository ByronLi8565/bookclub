import { Agent } from "agents";
import type { Env } from "../env.ts";

// The global, single-instance directory of group names. There is exactly one
// instance (keyed by the well-known id below); its single-threaded execution
// gives us atomic name reservation without a lock. The map is append-only:
// names are write-once, never renamed and never reused (decision 12).
export const REGISTRY_ID = "global";

export interface RegistryState {
  // Normalized name key -> groupId.
  names: Record<string, string>;
}

export type ReserveResult = { ok: true } | { ok: false; reason: "taken" };

export class GroupRegistry extends Agent<Env, RegistryState> {
  initialState: RegistryState = { names: {} };

  // Atomically claim a normalized name for a group. Fails if already taken.
  // Callers must have validated the name shape (see names.ts) first.
  reserve(key: string, groupId: string): ReserveResult {
    if (this.state.names[key] !== undefined) return { ok: false, reason: "taken" };
    this.setState({ names: { ...this.state.names, [key]: groupId } });
    return { ok: true };
  }

  // Resolve a normalized name to its groupId, or null if unclaimed.
  resolve(key: string): string | null {
    return this.state.names[key] ?? null;
  }
}
