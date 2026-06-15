import { Agent } from "agents";
import type { Env } from "../env.ts";

export const REGISTRY_ID = "global";

export interface RegistryState {
  names: Record<string, string>;
}

export type ReserveResult = { ok: true } | { ok: false; reason: "taken" };

export class GroupRegistry extends Agent<Env, RegistryState> {
  initialState: RegistryState = { names: {} };

  reserve(key: string, groupId: string): ReserveResult {
    if (this.state.names[key] !== undefined) return { ok: false, reason: "taken" };
    this.setState({ names: { ...this.state.names, [key]: groupId } });
    return { ok: true };
  }

  resolve(key: string): string | null {
    return this.state.names[key] ?? null;
  }
}
